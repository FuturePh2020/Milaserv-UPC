import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statfsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config.ts';
import { deriveKey, encryptSecret, totpAad } from '../auth/encryption.ts';
import { checkPasswordPolicy, PASSWORD_POLICY, PasswordHasher } from '../auth/passwords.ts';
import { base32Encode, generateTotpSecret, otpauthUri, verifyTotp } from '../auth/totp.ts';
import { appSecretId, backupStatus, BackupError, filesystemError, createBackup, decryptBackup, keyId, listBackups, openStaging, markVerified, parseBackupKey, pruneBackups, readHeader, readKeyFile, restoreBackup, verifyDatabaseFile, writeNewKeyFile } from '../backup/backup.ts';
import { openDatabase } from '../database/connection.ts';
import { loadJobSettings, readJobStatus, runBackupJob, type JobContext, type JobSettings } from '../ops/backup-job.ts';
import { nextRun } from '../ops/schedule.ts';
import { alertDue, buildPayload, checkWebhookUrl, deliver, fingerprint, readState, writeState, type StatusReport } from '../ops/alerting.ts';
import { S3Client, S3Error } from '../ops/s3.ts';
import { readSecretFile } from '../config.ts';
import { verifyConsistency } from '../database/consistency.ts';
import { readSystemState } from '../http/write-gate.ts';
import { RecoveryModeError, reopenWrites } from '../services/recovery-mode.ts';
import { DatabaseError } from '../database/errors.ts';
import { acquireInstanceLock } from '../database/instance-lock.ts';
import { inspectSchema, loadMigrations, type Migration } from '../database/migrations.ts';
import { OPERATOR_COMMANDS } from '../database/runtime.ts';
import { BootstrapError, assertUsernameAvailable } from '../services/admin-bootstrap.ts';
import { createAdditionalAdministrator, findAccount, RecoveryError, replaceTotp, resetPassword, revokeSessions, type AccountSummary } from '../services/account-recovery.ts';
import { merchantProfileSchema, usernameSchema, type MerchantProfile } from '../../shared/schemas.ts';
import { CancelledError, InputTooLongError, type Prompter } from './prompt.ts';
import { rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Trusted-operator commands added in stage 15 (account provisioning/recovery and encrypted backups).
 * Host shell access is the recovery authority: these commands run only on the server host, never over
 * HTTP. Secrets (passwords, codes, backup keys) are read with hidden terminal input or — for backup keys
 * only — from a permission-checked key file; never from arguments or the server environment.
 */

export interface OperatorContext {
  config: AppConfig;
  migrationsDir: string;
  out(line: string): void;
  err(line: string): void;
  /** Lazily created interactive prompter (throws NotInteractiveError without a TTY). */
  prompter: () => Prompter;
  hasher?: PasswordHasher;
  now?: () => number;
}

class UsageError extends Error {}
class AttemptsExhaustedError extends Error {}

// ------------------------------------------------------------------ argument parsing

interface Parsed {
  positionals: string[];
  flags: Set<string>;
  options: Map<string, string>;
}

/** Strict parsing: only the listed flags/options; no "--x=value"; nothing that looks like a secret. */
export function parseArgs(args: readonly string[], allowed: { flags?: string[]; options?: string[]; positionals?: number }): Parsed {
  const r: Parsed = { positionals: [], flags: new Set(), options: new Map() };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      if (a.includes('=')) throw new UsageError(`Use "${a.split('=')[0]} <value>" (no "=").`);
      if (allowed.flags?.includes(a)) r.flags.add(a);
      else if (allowed.options?.includes(a)) {
        const v = args[++i];
        if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value.`);
        r.options.set(a, v);
      } else throw new UsageError(`Unknown option ${a}. Secrets are never accepted as arguments.`);
    } else r.positionals.push(a);
  }
  if (r.positionals.length !== (allowed.positionals ?? 0)) throw new UsageError(`Expected ${allowed.positionals ?? 0} argument(s).`);
  return r;
}

// ------------------------------------------------------------------ interactive helpers

async function askValid<T>(p: Prompter, ask: () => Promise<string>, parse: (raw: string) => { ok: true; value: T } | { ok: false; message: string }): Promise<T> {
  for (let i = 0; i < 3; i++) {
    const r = parse(await ask());
    if (r.ok) return r.value;
    p.say(`  ✗ ${r.message}`);
  }
  throw new AttemptsExhaustedError('Too many invalid attempts.');
}

async function askReason(p: Prompter): Promise<string> {
  return askValid(p, () => p.ask('Reason for this action (recorded in the audit log, 3–200 characters): '), (raw) => {
    const s = raw.normalize('NFC').trim();
    if (s.length < 3 || s.length > 200 || /[\u0000-\u001f\u007f]/.test(s)) return { ok: false, message: 'Give a short reason of 3–200 characters.' };
    return { ok: true, value: s };
  });
}

async function askNewPassword(p: Prompter, role: 'admin' | 'trader'): Promise<string> {
  const min = PASSWORD_POLICY.minChars[role];
  // Not phrased like a prompt: an operator must not start typing before the hidden prompt appears.
  p.say(`\nPassword rules: ${min}–${PASSWORD_POLICY.maxChars} characters. Wait for the hidden prompt below; nothing is echoed.`);
  for (let i = 0; i < 3; i++) {
    let first: string;
    try {
      first = await p.askHidden('New password: ');
    } catch (err) {
      if (err instanceof InputTooLongError) {
        p.say('  ✗ The password is too long.');
        continue;
      }
      throw err;
    }
    const issues = checkPasswordPolicy(first, role);
    if (issues.length) {
      p.say(`  ✗ The password does not meet the policy (${issues.join(', ')}).`);
      continue;
    }
    if ((await p.askHidden('Confirm password: ')) !== first) {
      p.say('  ✗ The passwords do not match.');
      continue;
    }
    return first;
  }
  throw new AttemptsExhaustedError('Too many invalid password attempts.');
}

/** Shows a NEW secret once (terminal only) and requires a current code from it. */
async function enrollTotp(p: Prompter, username: string, now: () => number): Promise<{ secret: Buffer; step: number }> {
  const secret = generateTotpSecret();
  p.say('\nAdd this account to an authenticator app (manual key entry, TOTP / SHA1 / 6 digits / 30 s):');
  p.say(`  Secret: ${base32Encode(secret).replace(/(.{4})/g, '$1 ').trim()}`);
  p.say(`  URI:    ${otpauthUri(secret, username)}`);
  p.say('Keep this secret private. Do NOT paste it into online QR-code generators or any third-party service.');
  try {
    const step = await askValid(p, () => p.ask('Enter the current 6-digit code to confirm enrollment: '), (code) => {
      const v = verifyTotp(secret, code.trim(), now());
      return v.ok ? { ok: true, value: v.step } : { ok: false, message: 'Code not accepted. Check the device clock and try again.' };
    });
    return { secret, step };
  } catch (err) {
    secret.fill(0);
    throw err;
  }
}

/** Shows the target and requires typing its username again. */
async function confirmTarget(p: Prompter, a: AccountSummary): Promise<void> {
  p.say(`\nAccount: ${a.username}  (id ${a.id})`);
  p.say(`  role: ${a.role} · profile: ${a.businessName ?? '—'} · status: ${a.merchantStatus ?? '—'} · active sessions: ${a.sessions}`);
  const typed = await p.ask('Type the username again to confirm this account: ');
  if (typed.trim().toLowerCase() !== a.username) throw new CancelledError();
}

// ------------------------------------------------------------------ maintenance database access

/**
 * Opens the EXISTING database for a maintenance command: instance lock (the server must be stopped),
 * private permissions, local disk, schema exactly current (no silent migration). Normal runtime
 * restrictions are not weakened: this is a separate, short-lived operator connection.
 */
async function withMaintenanceDb(ctx: OperatorContext, purpose: string, fn: (db: DatabaseSync) => Promise<number>): Promise<number> {
  if (!existsSync(ctx.config.databasePath)) {
    ctx.err(`Error [DATABASE_MISSING]: No database found. Initialize it first with: ${OPERATOR_COMMANDS.init}`);
    return 1;
  }
  const lock = acquireInstanceLock(ctx.config.dataDir, `${purpose} (stop the server first)`);
  try {
    const db = openDatabase(ctx.config.databasePath, { mustExist: true });
    try {
      const state = inspectSchema(db, loadMigrations(ctx.migrationsDir));
      if (state.kind !== 'current') {
        ctx.err(state.kind === 'pending' ? `Error [MIGRATIONS_PENDING]: Apply pending migrations first: ${OPERATOR_COMMANDS.migrate}` : `Error [DATABASE_UNINITIALIZED]: Run ${OPERATOR_COMMANDS.init}`);
        return 1;
      }
      return await fn(db);
    } finally {
      db.close();
    }
  } finally {
    lock.release();
  }
}

function requireAppSecret(ctx: OperatorContext): Buffer | null {
  if (!ctx.config.appSecret) {
    ctx.err('Error [APP_SECRET_REQUIRED]: APP_SECRET must be configured (the same one the server uses) to encrypt or check administrator MFA secrets.');
    return null;
  }
  return ctx.config.appSecret;
}

async function lookup(ctx: OperatorContext, db: DatabaseSync, p: Prompter): Promise<AccountSummary> {
  const username = await askValid(p, () => p.ask('Username of the account: '), (raw) => {
    const r = usernameSchema.safeParse(raw.trim().toLowerCase());
    if (!r.success) return { ok: false, message: 'Not a valid username.' };
    const a = findAccount(db, r.data);
    return a ? { ok: true, value: a } : { ok: false, message: 'No account with that username.' };
  });
  void ctx;
  return username;
}

function handleKnown(ctx: OperatorContext, err: unknown): number {
  if (err instanceof CancelledError) {
    ctx.err('Cancelled. Nothing was saved.');
    return 1;
  }
  if (err instanceof AttemptsExhaustedError) {
    ctx.err(`${err.message} Nothing was saved.`);
    return 1;
  }
  if (err instanceof RecoveryError || err instanceof BootstrapError || err instanceof BackupError || err instanceof DatabaseError) {
    ctx.err(`Error [${err.code}]: ${err.message}`);
    return 1;
  }
  if (err instanceof UsageError) {
    ctx.err(`Usage error: ${err.message}`);
    return 2;
  }
  // Stage 17: filesystem refusals anywhere in a command (e.g. a backup directory owned by another user)
  // are reported with a generic code instead of a raw exception with paths.
  const mapped = filesystemError(err, 'Nothing was changed.');
  if (mapped instanceof BackupError) {
    ctx.err(`Error [${mapped.code}]: ${mapped.message}`);
    return 1;
  }
  throw err;
}

// ------------------------------------------------------------------ account commands

export async function adminCreate(ctx: OperatorContext, args: readonly string[]): Promise<number> {
  const now = ctx.now ?? Date.now;
  try {
    parseArgs(args, {});
    const appSecret = requireAppSecret(ctx);
    if (!appSecret) return 1;
    return await withMaintenanceDb(ctx, 'admin:create', async (db) => {
      const p = ctx.prompter();
      try {
        p.say('ALKHAYR — create an ADDITIONAL administrator (local operator only). Existing accounts are never promoted.');
        p.say('Nothing is saved until every step succeeds. Press Ctrl-C at any time to cancel.\n');
        const username = await askValid(p, () => p.ask('New administrator username: '), (raw) => {
          const r = usernameSchema.safeParse(raw);
          if (!r.success) return { ok: false, message: 'Use 3–32 lowercase letters, digits, ".", "_" or "-", starting with a letter or digit.' };
          try {
            assertUsernameAvailable(db, r.data);
          } catch (err) {
            if (err instanceof BootstrapError) return { ok: false, message: err.message };
            throw err;
          }
          return { ok: true, value: r.data };
        });
        const raw: Record<string, string> = {};
        const fields: Array<[keyof MerchantProfile, string]> = [
          ['businessName', 'Business name: '],
          ['contactName', 'Contact person: '],
          ['phone', 'Phone (e.g. 01012345678): '],
          ['governorate', 'Governorate: '],
          ['address', 'Address: '],
          ['email', 'Email (optional, Enter to skip): '],
        ];
        for (const [key, q] of fields) {
          raw[key] = await askValid(p, () => p.ask(q), (answer) => {
            const r = merchantProfileSchema.shape[key].safeParse(answer);
            return r.success ? { ok: true, value: answer } : { ok: false, message: r.error.issues[0]?.message ?? 'Invalid value.' };
          });
        }
        const profile = merchantProfileSchema.parse(raw);
        const reason = await askReason(p);
        const password = await askNewPassword(p, 'admin');
        p.say('\nHashing password…');
        const passwordHash = await (ctx.hasher ?? new PasswordHasher()).hash(password);
        const { secret, step } = await enrollTotp(p, username, now);
        const userId = randomUUID();
        const totpCiphertext = encryptSecret(deriveKey(appSecret, 'totp'), secret, totpAad(userId));
        secret.fill(0);
        createAdditionalAdministrator(db, { userId, merchantId: randomUUID(), username, passwordHash, totpCiphertext, acceptedStep: step, profile, reason }, now(), randomUUID());
        p.say(`\nAdministrator "${username}" created with MFA enrollment confirmed. Wait for the NEXT 30-second code before the first sign-in.`);
        return 0;
      } finally {
        p.close();
      }
    });
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

export async function accountResetPassword(ctx: OperatorContext, args: readonly string[]): Promise<number> {
  const now = ctx.now ?? Date.now;
  try {
    parseArgs(args, {});
    return await withMaintenanceDb(ctx, 'account:reset-password', async (db) => {
      const p = ctx.prompter();
      try {
        p.say('ALKHAYR — reset an account password (local operator only). Role and approval status are not changed.');
        const a = await lookup(ctx, db, p);
        await confirmTarget(p, a);
        const reason = await askReason(p);
        const password = await askNewPassword(p, a.role);
        p.say('\nHashing password…');
        const passwordHash = await (ctx.hasher ?? new PasswordHasher()).hash(password);
        const r = resetPassword(db, { userId: a.id, expectedCredentialVersion: a.credentialVersion, passwordHash, reason, now: now(), requestId: randomUUID() });
        p.say(`\nPassword reset for "${a.username}". ${r.sessionsRevoked} session(s) revoked; sign-ins that started before this are refused.`);
        return 0;
      } finally {
        p.close();
      }
    });
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

export async function accountResetMfa(ctx: OperatorContext, args: readonly string[]): Promise<number> {
  const now = ctx.now ?? Date.now;
  try {
    parseArgs(args, {});
    const appSecret = requireAppSecret(ctx);
    if (!appSecret) return 1;
    return await withMaintenanceDb(ctx, 'account:reset-mfa', async (db) => {
      const p = ctx.prompter();
      try {
        p.say('ALKHAYR — replace an administrator authenticator (local operator only).');
        p.say('Verify the administrator\'s identity out of band first. The current enrollment stays valid until the new one is proven.');
        const a = await lookup(ctx, db, p);
        if (a.role !== 'admin') throw new RecoveryError('NOT_ADMIN', 'Only administrator accounts use an authenticator. Nothing was changed.');
        await confirmTarget(p, a);
        const reason = await askReason(p);
        const { secret, step } = await enrollTotp(p, a.username, now);
        const totpCiphertext = encryptSecret(deriveKey(appSecret, 'totp'), secret, totpAad(a.id));
        secret.fill(0);
        const r = replaceTotp(db, { userId: a.id, expectedCredentialVersion: a.credentialVersion, totpCiphertext, acceptedStep: step, reason, now: now(), requestId: randomUUID() });
        p.say(`\nAuthenticator replaced for "${a.username}". ${r.sessionsRevoked} session(s) revoked. The old authenticator no longer works. Wait for the NEXT code before signing in.`);
        return 0;
      } finally {
        p.close();
      }
    });
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

export async function accountRevokeSessions(ctx: OperatorContext, args: readonly string[]): Promise<number> {
  const now = ctx.now ?? Date.now;
  try {
    parseArgs(args, {});
    return await withMaintenanceDb(ctx, 'account:revoke-sessions', async (db) => {
      const p = ctx.prompter();
      try {
        p.say('ALKHAYR — revoke all sessions of an account (local operator only). Credentials are not changed.');
        const a = await lookup(ctx, db, p);
        await confirmTarget(p, a);
        const reason = await askReason(p);
        const r = revokeSessions(db, { userId: a.id, expectedCredentialVersion: a.credentialVersion, reason, now: now(), requestId: randomUUID() });
        p.say(`\n${r.sessionsRevoked} session(s) revoked for "${a.username}". If the password may be known to someone else, also run account:reset-password.`);
        return 0;
      } finally {
        p.close();
      }
    });
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

// ------------------------------------------------------------------ backup commands

function forbiddenKeyDirs(c: AppConfig): string[] {
  return [c.dataDir, c.backupDir];
}

/** The backup key: a protected key file (--key-file) or hidden terminal input. Never an argument. */
async function backupKey(ctx: OperatorContext, parsed: Parsed): Promise<Buffer> {
  const file = parsed.options.get('--key-file');
  if (file) return readKeyFile(path.resolve(file), forbiddenKeyDirs(ctx.config));
  const p = ctx.prompter();
  try {
    return parseBackupKey(await p.askHidden('Backup key (hidden): '));
  } finally {
    p.close();
  }
}

function migrations(ctx: OperatorContext): Migration[] {
  return loadMigrations(ctx.migrationsDir);
}

export async function backupKeygen(ctx: OperatorContext, args: readonly string[]): Promise<number> {
  try {
    const a = parseArgs(args, { options: ['--out'] });
    const out = a.options.get('--out');
    if (!out) throw new UsageError('backup:keygen --out <path-outside-data-and-backup-directories>');
    const id = writeNewKeyFile(path.resolve(out), forbiddenKeyDirs(ctx.config));
    ctx.out(`New backup key written (permissions 0600). Key id: ${id}`);
    ctx.out('Copy this key file to protected offline storage now (separately from APP_SECRET and from the backups). Without it the backups cannot be decrypted.');
    return 0;
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

export async function backupCreate(ctx: OperatorContext, args: readonly string[]): Promise<number> {
  const now = ctx.now ?? Date.now;
  try {
    const a = parseArgs(args, { options: ['--key-file', '--keep'] });
    const keep = a.options.has('--keep') ? Number(a.options.get('--keep')) : null;
    if (keep !== null && (!Number.isSafeInteger(keep) || keep < 1 || keep > 1000)) throw new UsageError('--keep must be a whole number from 1 to 1000.');
    if (!existsSync(ctx.config.databasePath)) throw new BackupError('DATABASE_MISSING', 'No database found to back up.');
    const key = await backupKey(ctx, a);
    try {
      const created = await createBackup({ databasePath: ctx.config.databasePath, dataDir: ctx.config.dataDir, backupDir: ctx.config.backupDir, backupKey: key, appSecret: ctx.config.appSecret, migrations: migrations(ctx), now });
      ctx.out(`Backup created and verified: ${created.file}`);
      ctx.out(JSON.stringify({ backupId: created.header.backupId, createdAt: new Date(created.header.createdAt).toISOString(), schemaVersion: created.header.schemaVersion, keyId: created.header.keyId, appSecretId: created.header.appSecretId, bytes: created.header.plaintextBytes, checks: created.summary.checks, mfa: created.summary.mfa }, null, 2));
      if (created.summary.mfa === 'not_checked') ctx.out('Warning: APP_SECRET was not configured, so administrator MFA readability was not checked.');
      ctx.out('This copy is on this server only. Copy it off the server (and keep the backup key and APP_SECRET separately) to survive a lost disk.');
      if (keep !== null) {
        const r = await pruneBackups(ctx.config.backupDir, keep);
        ctx.out(`Rotation: kept ${r.kept.length}, deleted ${r.deleted.length} older managed backup(s); newest verified: ${r.newestVerified ?? 'none'}.`);
      }
      return 0;
    } finally {
      key.fill(0);
    }
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

export async function backupInspect(ctx: OperatorContext, args: readonly string[]): Promise<number> {
  try {
    const a = parseArgs(args, { positionals: 1 });
    const h = readHeader(path.resolve(a.positionals[0]!));
    const secretMatch = ctx.config.appSecret && h.header.appSecretId ? h.header.appSecretId === appSecretId(ctx.config.appSecret) : null;
    ctx.out(JSON.stringify({ note: 'Unverified metadata (authenticated only by backup:verify).', backupId: h.header.backupId, createdAt: new Date(h.header.createdAt).toISOString(), formatVersion: h.header.formatVersion, schemaVersion: h.header.schemaVersion, keyId: h.header.keyId, appSecretId: h.header.appSecretId, configuredAppSecretMatches: secretMatch, plaintextBytes: h.header.plaintextBytes }, null, 2));
    return 0;
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

export async function backupVerify(ctx: OperatorContext, args: readonly string[]): Promise<number> {
  try {
    const a = parseArgs(args, { positionals: 1, options: ['--key-file'] });
    const file = path.resolve(a.positionals[0]!);
    const key = await backupKey(ctx, a);
    // Private staging inside the data directory's parent area: same protection as the live database.
    const stagingJob = openStaging(ctx.config.dataDir);
    const staging = stagingJob.dir;
    try {
      const target = path.join(staging, 'verify.db');
      const header = await decryptBackup(file, key, target);
      const summary = verifyDatabaseFile(target, { migrations: migrations(ctx), appSecret: ctx.config.appSecret });
      await markVerified(file, header);
      ctx.out(`Backup verified: ${path.basename(file)} (key id ${keyId(key)}).`);
      ctx.out(JSON.stringify({ backupId: header.backupId, createdAt: new Date(header.createdAt).toISOString(), ...summary }, null, 2));
      if (summary.pendingMigrations.length) ctx.out(`Note: restoring it requires ${OPERATOR_COMMANDS.migrate} afterwards (${summary.pendingMigrations.join(', ')}).`);
      return 0;
    } finally {
      stagingJob.dispose();
      key.fill(0);
    }
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

export async function backupRestore(ctx: OperatorContext, args: readonly string[]): Promise<number> {
  const now = ctx.now ?? Date.now;
  try {
    const a = parseArgs(args, { positionals: 1, options: ['--key-file'], flags: ['--replace', '--accept-new-app-secret'] });
    const file = path.resolve(a.positionals[0]!);
    if (!ctx.config.appSecret) {
      ctx.err('Error [APP_SECRET_REQUIRED]: Configure the APP_SECRET that belongs to this backup before restoring.');
      return 1;
    }
    const key = await backupKey(ctx, a);
    const lock = acquireInstanceLock(ctx.config.dataDir, 'backup:restore (stop the server first)');
    try {
      const r = await restoreBackup({
        file,
        backupKey: key,
        dataDir: ctx.config.dataDir,
        databasePath: ctx.config.databasePath,
        migrations: migrations(ctx),
        appSecret: ctx.config.appSecret,
        replace: a.flags.has('--replace'),
        acceptNewAppSecret: a.flags.has('--accept-new-app-secret'),
        now,
      });
      ctx.out(`Restored backup ${r.header.backupId} (created ${new Date(r.header.createdAt).toISOString()}) into ${ctx.config.databasePath}.`);
      if (r.previousMovedTo) ctx.out(`The previous database was kept unchanged in ${r.previousMovedTo}.`);
      ctx.out(`${r.sessionsRemoved} restored session(s) removed: every user must sign in again.`);
      ctx.out('IMPORTANT: the restored data is an OLDER point in time. Orders, stock movements, imports and accounts created after the backup are missing.');
      ctx.out('Reconcile with the business (orders, deliveries, stock counts) BEFORE reopening the portal to traders.');
      ctx.out(
        r.recoveryEpoch !== null
          ? 'The portal starts in RECOVERY MODE: sign-in and reading work, new business writes are refused, and operations prepared before this restore can never run as new ones. After reconciliation run: recovery:reopen'
          : 'This backup predates recovery mode (migration 0008): db:migrate will put the portal into RECOVERY MODE; then reconcile and run recovery:reopen.',
      );
      if (r.summary.pendingMigrations.length) ctx.out(`Before starting the server run: ${OPERATOR_COMMANDS.migrate}`);
      if (r.summary.mfa === 'unreadable_accepted') ctx.out('Administrator MFA cannot be decrypted with this APP_SECRET: the server will refuse to start until every administrator is re-enrolled with account:reset-mfa.');
      return 0;
    } finally {
      lock.release();
      key.fill(0);
    }
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

export async function backupPrune(ctx: OperatorContext, args: readonly string[]): Promise<number> {
  try {
    const a = parseArgs(args, { options: ['--keep'] });
    const keep = Number(a.options.get('--keep'));
    if (!a.options.has('--keep') || !Number.isSafeInteger(keep) || keep < 1 || keep > 1000) throw new UsageError('backup:prune --keep <n>  (n = 1..1000)');
    const r = await pruneBackups(ctx.config.backupDir, keep);
    ctx.out(JSON.stringify(r, null, 2));
    if (!r.newestVerified) ctx.out('Warning: no verified backup exists. Run backup:verify on the newest backup.');
    return 0;
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

export async function backupStatusCommand(ctx: OperatorContext, args: readonly string[]): Promise<number> {
  try {
    parseArgs(args, {});
    const s = await backupStatus({ backupDir: ctx.config.backupDir, dataDir: ctx.config.dataDir, databasePath: ctx.config.databasePath, now: (ctx.now ?? Date.now)() });
    ctx.out(JSON.stringify({ ...s, managedBackups: listBackups(ctx.config.backupDir).map((b) => b.name) }, null, 2));
    return s.warnings.length ? 3 : 0;
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

// ------------------------------------------------------------------ consistency and recovery mode (stage 16)

function openReadOnlyCurrent(ctx: OperatorContext): DatabaseSync | null {
  if (!existsSync(ctx.config.databasePath)) {
    ctx.err(`Error [DATABASE_MISSING]: No database found. Initialize it first with: ${OPERATOR_COMMANDS.init}`);
    return null;
  }
  return openDatabase(ctx.config.databasePath, { mustExist: true }); // only SELECTs are issued (same as db:status)
}

/** `db:check` — read-only consistency report (safe while the server runs). Exit 0 ok, 1 errors, 3 warnings only. */
export async function dbCheck(ctx: OperatorContext, args: readonly string[]): Promise<number> {
  try {
    const a = parseArgs(args, { options: ['--samples'] });
    const samples = a.options.has('--samples') ? Number(a.options.get('--samples')) : 10;
    if (!Number.isSafeInteger(samples) || samples < 0 || samples > 100) throw new UsageError('--samples must be 0..100');
    const db = openReadOnlyCurrent(ctx);
    if (!db) return 1;
    try {
      const report = verifyConsistency(db, { maxSamples: samples });
      ctx.out(JSON.stringify(report, null, 2));
      if (!report.ok) {
        ctx.err('Consistency errors found. Nothing was changed or repaired. New business writes are refused while these remain (integrity hold at startup; per-order/per-product guards at write time).');
        ctx.err('Investigate the sample ids with read-only queries, restore a verified backup if needed, and never edit history in place.');
        return 1;
      }
      return report.warnings ? 3 : 0;
    } finally {
      db.close();
    }
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

/** `recovery:status` — shows whether writes are open and which restore put the portal into recovery mode. */
export async function recoveryStatus(ctx: OperatorContext, args: readonly string[]): Promise<number> {
  try {
    parseArgs(args, {});
    const db = openReadOnlyCurrent(ctx);
    if (!db) return 1;
    try {
      const st = readSystemState(db);
      ctx.out(JSON.stringify({ ...st, restoredBackupAt: st.restoredBackupAt ? new Date(st.restoredBackupAt).toISOString() : null }, null, 2));
      return st.writeMode === 'recovery' ? 3 : 0;
    } finally {
      db.close();
    }
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

/**
 * `recovery:reopen` — explicit, audited end of post-restore recovery mode. Interactive (reason + typed
 * confirmation). Refuses while consistency errors exist. May run while the server is up: the server reads
 * the mode for every new write. Reopening reconstructs nothing; reconciliation is the business's work.
 */
export async function recoveryReopen(ctx: OperatorContext, args: readonly string[]): Promise<number> {
  const now = ctx.now ?? Date.now;
  try {
    parseArgs(args, {});
    if (!existsSync(ctx.config.databasePath)) {
      ctx.err(`Error [DATABASE_MISSING]: No database found.`);
      return 1;
    }
    const db = openDatabase(ctx.config.databasePath, { mustExist: true });
    try {
      const state = inspectSchema(db, loadMigrations(ctx.migrationsDir));
      if (state.kind !== 'current') {
        ctx.err(`Error [MIGRATIONS_PENDING]: Apply pending migrations first: ${OPERATOR_COMMANDS.migrate}`);
        return 1;
      }
      const st = readSystemState(db);
      if (st.writeMode !== 'recovery') {
        ctx.out('The portal is not in recovery mode; writes are already open. Nothing was changed.');
        return 0;
      }
      const report = verifyConsistency(db, { maxSamples: 0 });
      if (!report.ok) {
        ctx.err(`Error [CONSISTENCY_FAILED]: ${report.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ×${i.count}`).join(', ')}. Run db:check. Writes stay closed.`);
        return 1;
      }
      const p = ctx.prompter();
      try {
        p.say('ALKHAYR — reopen business writes after a restore (local operator only).');
        p.say(`Restored backup: ${st.restoredBackupId ?? 'unknown (pre-0008 backup)'} · created ${st.restoredBackupAt ? new Date(st.restoredBackupAt).toISOString() : 'unknown'} · recovery since ${st.recoveryStartedAt ? new Date(st.recoveryStartedAt).toISOString() : 'unknown'}`);
        p.say('Everything after the backup time is missing from this data. Reopening does not reconstruct it.');
        p.say('Confirm that orders, deliveries, stock counts and accounts were reconciled with the business, and that');
        p.say('missing facts will be re-entered as NEW operations. Operations prepared before the restore stay refused.');
        const reason = await askReason(p);
        const typed = await p.ask('Type REOPEN to open business writes now: ');
        if (typed.trim() !== 'REOPEN') throw new CancelledError();
        const after = reopenWrites(db, { expectedVersion: st.version, reason, now: now(), requestId: randomUUID() });
        p.say(`\nBusiness writes are OPEN (recovery epoch ${after.recoveryEpoch} unchanged; audited as recovery.reopened).`);
        return 0;
      } finally {
        p.close();
      }
    } finally {
      db.close();
    }
  } catch (err) {
    if (err instanceof RecoveryModeError) {
      ctx.err(`Error [${err.code}]: ${err.message}`);
      return 1;
    }
    return handleKnown(ctx, err);
  }
}

// ------------------------------------------------------------------ scheduled backups and monitoring (stage 17)

function jobContext(ctx: OperatorContext, settings: JobSettings): JobContext {
  return {
    settings,
    backupDir: ctx.config.backupDir,
    dataDir: ctx.config.dataDir,
    databasePath: ctx.config.databasePath,
    appSecret: ctx.config.appSecret,
    migrations: migrations(ctx),
    now: ctx.now ?? Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    // One JSON line per event (codes and names only; never secrets or contents).
    log: (event, fields = {}) => ctx.out(JSON.stringify({ time: new Date().toISOString(), event, ...fields })),
  };
}

/** `backup:run` — one scheduled-backup job now (for host schedulers such as a systemd timer). Exit 0/1. */
export async function backupRun(ctx: OperatorContext, args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  try {
    parseArgs(args, {});
    const status = await runBackupJob(jobContext(ctx, loadJobSettings(env)));
    return status.lastResult === 'failed' ? 1 : 0;
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

/**
 * `backup:schedule` — long-running scheduler for the backup container: runs `backup:run` at the configured
 * local times (BACKUP_SCHEDULE in BACKUP_TZ). Never overlaps (job lock); SIGTERM/SIGINT stop it between jobs
 * (a running job is allowed to finish within the container's stop grace period).
 */
export async function backupSchedule(ctx: OperatorContext, args: readonly string[], env: NodeJS.ProcessEnv = process.env, signals: NodeJS.EventEmitter = process): Promise<number> {
  try {
    parseArgs(args, {});
    const settings = loadJobSettings(env);
    const jc = jobContext(ctx, settings);
    let stopping = false;
    let wake: (() => void) | null = null;
    let timer: NodeJS.Timeout | null = null;
    const stop = () => {
      stopping = true;
      // Clear the pending sleep so the process exits at once (found in the stage-17 upgrade rehearsal:
      // a pending 60 s timer kept the stopped scheduler alive for ~40 s).
      if (timer) clearTimeout(timer);
      wake?.();
    };
    signals.on('SIGTERM', stop);
    signals.on('SIGINT', stop);
    try {
      jc.log('backup_scheduler_started', { schedule: settings.times.map((t) => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`).join(','), timeZone: settings.timeZone, offsite: settings.offsite ? 'configured' : 'not_configured' });
      while (!stopping) {
        const at = nextRun(jc.now(), settings.times, settings.timeZone);
        jc.log('backup_next_run', { at: new Date(at).toISOString() });
        // Sleep in short slices so wall-clock jumps and stop signals are noticed.
        while (!stopping && jc.now() < at) {
          await new Promise<void>((r) => {
            wake = r;
            timer = setTimeout(r, Math.min(60_000, Math.max(0, at - jc.now())));
          });
          timer = null;
        }
        if (stopping) break;
        await runBackupJob(jc);
      }
      jc.log('backup_scheduler_stopped');
      return 0;
    } finally {
      signals.off('SIGTERM', stop);
      signals.off('SIGINT', stop);
    }
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

type Level = 'ok' | 'warn' | 'critical';
interface Check {
  name: string;
  status: Level;
  detail: string;
}

async function tlsDaysLeft(hostPort: string, caFile: string | undefined): Promise<{ daysLeft: number; error?: undefined } | { error: string }> {
  const { connect } = await import('node:tls');
  const [host, portRaw] = hostPort.split(':');
  return new Promise((resolve) => {
    const socket = connect({ host: host!, port: Number(portRaw ?? 443), servername: host!, ...(caFile ? { ca: readFileSync(caFile) } : {}), timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!socket.authorized) return resolve({ error: `certificate not trusted (${String(socket.authorizationError)})` });
      resolve({ daysLeft: Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86_400_000) });
    });
    socket.on('error', (e) => resolve({ error: (e as NodeJS.ErrnoException).code ?? 'tls_error' }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ error: 'timeout' });
    });
  });
}

/**
 * `ops:status [--tls-host host[:port]] [--tls-ca file] [--skip-consistency]` — private operational status for
 * monitoring (JSON on stdout; exit 0 ok, 3 warning, 1 critical). Separates "process alive" (not checked here;
 * use /healthz) from "writes are safe" (recovery mode, consistency) and from data protection (backup ages,
 * off-server copy, abandoned plaintext, free space) and certificate expiry. Thresholds: MONITOR_* variables.
 */
export async function opsStatus(ctx: OperatorContext, args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  try {
    const a = parseArgs(args, { options: ['--tls-host', '--tls-ca'], flags: ['--skip-consistency'] });
    const report = await collectOpsStatus(ctx, { tlsHost: a.options.get('--tls-host'), tlsCa: a.options.get('--tls-ca'), skipConsistency: a.flags.has('--skip-consistency') }, env);
    ctx.out(JSON.stringify(report, null, 2));
    return report.overall === 'critical' ? 1 : report.overall === 'warn' ? 3 : 0;
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

/** Computes the monitoring report (shared by ops:status and ops:watch). Read-only. */
export async function collectOpsStatus(ctx: OperatorContext, o: { tlsHost?: string | undefined; tlsCa?: string | undefined; skipConsistency?: boolean; readyUrl?: string | undefined }, env: NodeJS.ProcessEnv = process.env): Promise<StatusReport> {
  {
    const num = (k: string, d: number) => (env[k] && Number.isFinite(Number(env[k])) ? Number(env[k]) : d);
    const now = (ctx.now ?? Date.now)();
    const checks: Check[] = [];
    const add = (name: string, status: Level, detail: string) => checks.push({ name, status, detail });
    if (!existsSync(ctx.config.databasePath)) add('database', 'critical', 'database file missing');
    else {
      const db = openDatabase(ctx.config.databasePath, { mustExist: true });
      try {
        const st = readSystemState(db);
        add('writes', st.writeMode === 'recovery' ? 'warn' : 'ok', st.writeMode === 'recovery' ? 'RECOVERY MODE: new business writes refused until recovery:reopen' : 'open');
        if (!o.skipConsistency) {
          const rep = verifyConsistency(db, { maxSamples: 0 });
          add('consistency', rep.ok ? (rep.warnings ? 'warn' : 'ok') : 'critical', rep.ok ? `${rep.warnings} warning(s), ${rep.durationMs} ms` : `errors: ${rep.issues.filter((i) => i.severity === 'error').map((i) => `${i.code}×${i.count}`).join(', ')}`);
        }
        const failures = Number((db.prepare("SELECT count(*) AS n FROM audit_logs WHERE action = 'auth.login_failed' AND created_at > ?").get(now - 3_600_000) as { n: number }).n);
        const limit = num('MONITOR_LOGIN_FAILURES_PER_HOUR', 200);
        add('login_failures_last_hour', failures > limit ? 'warn' : 'ok', String(failures));
      } finally {
        db.close();
      }
    }
    const bs = await backupStatus({ backupDir: ctx.config.backupDir, dataDir: ctx.config.dataDir, databasePath: ctx.config.databasePath, now });
    const maxAge = num('MONITOR_BACKUP_MAX_AGE_HOURS', 26) * 3600;
    add('local_backup', !bs.newestVerified ? 'critical' : bs.newestVerified.ageSeconds! > maxAge ? 'warn' : 'ok', bs.newestVerified ? `newest verified ${Math.round(bs.newestVerified.ageSeconds! / 3600)} h ago` : 'no verified backup');
    add('plaintext_staging', bs.staging.abandonedPlaintext.length ? 'warn' : 'ok', `${bs.staging.abandonedPlaintext.length} abandoned, ${bs.staging.active.length} active, ${bs.staging.refused.length} unexpected`);
    const job = readJobStatus(ctx.config.backupDir);
    add('backup_job', !job ? 'warn' : job.consecutiveFailures > 0 ? (job.consecutiveFailures > 1 ? 'critical' : 'warn') : 'ok', job ? `last ${job.lastResult} at ${new Date(job.lastAttemptAt).toISOString()}${job.lastErrorCode ? ` (${job.lastErrorCode})` : ''}; consecutive failures ${job.consecutiveFailures}` : 'scheduler has not run');
    const offMax = num('MONITOR_OFFSITE_MAX_AGE_HOURS', 50) * 3_600_000;
    if (!job?.offsite.configured) add('offsite_copy', 'warn', 'off-server copy NOT configured (blocker B-2)');
    else add('offsite_copy', !job.offsite.verifiedAt ? 'critical' : now - job.offsite.verifiedAt > offMax ? 'warn' : 'ok', job.offsite.verifiedAt ? `verified ${Math.round((now - job.offsite.verifiedAt) / 3_600_000)} h ago (downloaded, decrypted, consistency-checked)` : 'never verified');
    const minFree = num('MONITOR_MIN_FREE_PERCENT', 10);
    for (const [name, dir] of [['disk_data', ctx.config.dataDir], ['disk_backups', ctx.config.backupDir]] as const) {
      try {
        const fs = statfsSync(dir);
        const pct = (fs.bavail / fs.blocks) * 100;
        add(name, pct < minFree / 2 ? 'critical' : pct < minFree ? 'warn' : 'ok', `${pct.toFixed(1)}% free (${Math.round((fs.bavail * fs.bsize) / 1048576)} MiB)`);
      } catch {
        add(name, 'warn', 'not measurable');
      }
    }
    const tlsHost = o.tlsHost;
    if (tlsHost) {
      const t = await tlsDaysLeft(tlsHost, o.tlsCa);
      const minDays = num('MONITOR_CERT_MIN_DAYS', 14);
      if ('error' in t && t.error) add('tls_certificate', 'critical', t.error);
      else if (!('error' in t)) add('tls_certificate', t.daysLeft < 3 ? 'critical' : t.daysLeft < minDays ? 'warn' : 'ok', `${t.daysLeft} day(s) left`);
    }
    const overall: Level = checks.some((c) => c.status === 'critical') ? 'critical' : checks.some((c) => c.status === 'warn') ? 'warn' : 'ok';
    return { time: new Date(now).toISOString(), overall, checks };
  }
}

function watchSettings(env: NodeJS.ProcessEnv) {
  const num = (k: string, d: number, min: number) => (env[k] && Number.isFinite(Number(env[k])) ? Math.max(min, Number(env[k])) : d);
  const allowHttp = env.ALERT_WEBHOOK_ALLOW_HTTP === '1'; // tests / loopback receivers only
  let webhook: string | null = null;
  const file = env.ALERT_WEBHOOK_URL_FILE;
  if (file) {
    const r = readSecretFile('ALERT_WEBHOOK_URL_FILE', file);
    if (!r.ok) throw new BackupError('CONFIG_INVALID', r.issue);
    if (r.value.trim() !== '') {
      const u = checkWebhookUrl(r.value.trim(), allowHttp);
      if (!u.ok) throw new BackupError('CONFIG_INVALID', u.issue);
      webhook = u.url;
    }
  }
  return {
    webhook,
    label: (env.ALERT_LABEL ?? 'portal').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 40) || 'portal',
    intervalMs: num('MONITOR_INTERVAL_SECONDS', 300, 30) * 1000,
    reminderMs: num('MONITOR_REMINDER_HOURS', 24, 1) * 3_600_000,
    consistencyEveryMs: num('MONITOR_CONSISTENCY_EVERY_MINUTES', 60, 5) * 60_000,
    tlsHost: env.MONITOR_TLS_HOST || undefined,
    tlsCa: env.MONITOR_TLS_CA_FILE || undefined,
  };
}

/** One watcher cycle: compute the report, decide whether a message is due, deliver, persist state. */
export async function opsWatchCycle(ctx: OperatorContext, env: NodeJS.ProcessEnv, runtime: { lastConsistencyAt: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Promise<{ report: StatusReport; sent: string | null; delivered: boolean | null }> {
  const s = watchSettings(env);
  const now = (ctx.now ?? Date.now)();
  const log = (event: string, fields: Record<string, unknown> = {}) => ctx.out(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
  // The full consistency scan is the expensive check: run it at most every MONITOR_CONSISTENCY_EVERY_MINUTES.
  const withConsistency = now - runtime.lastConsistencyAt >= s.consistencyEveryMs;
  if (withConsistency) runtime.lastConsistencyAt = now;
  let report: StatusReport;
  try {
    report = await collectOpsStatus(ctx, { tlsHost: s.tlsHost, tlsCa: s.tlsCa, skipConsistency: !withConsistency }, env);
  } catch (err) {
    report = { time: new Date(now).toISOString(), overall: 'critical', checks: [{ name: 'monitor', status: 'critical', detail: `status could not be computed (${err instanceof Error ? err.name : 'error'})` }] };
  }
  const state = readState(ctx.config.backupDir);
  const due = alertDue(state, report, now, s.reminderMs);
  log('ops_watch_cycle', { overall: report.overall, notOk: report.checks.filter((c) => c.status !== 'ok').map((c) => `${c.name}:${c.status}`), due: due.due ? due.kind : null });
  if (!due.due) {
    if (state.lastFingerprint === null) writeState(ctx.config.backupDir, { ...state, lastFingerprint: fingerprint(report), lastOverall: report.overall });
    return { report, sent: null, delivered: null };
  }
  if (!s.webhook) {
    // No channel configured: the condition is recorded and logged; nothing is claimed as delivered.
    log('alert_not_configured', { kind: due.kind, overall: report.overall });
    writeState(ctx.config.backupDir, { ...state, lastFingerprint: fingerprint(report), lastOverall: report.overall, lastNotifiedAt: now });
    return { report, sent: due.kind, delivered: null };
  }
  const result = await deliver(s.webhook, buildPayload(s.label, due.kind, report, state.lastOverall), { ...(runtime.fetchImpl ? { fetchImpl: runtime.fetchImpl } : {}), ...(runtime.sleep ? { sleep: runtime.sleep } : {}) });
  log(result.ok ? 'alert_delivered' : 'alert_failed', { kind: due.kind, httpStatus: result.httpStatus, attempts: result.attempts });
  writeState(ctx.config.backupDir, result.ok
    ? { ...state, lastFingerprint: fingerprint(report), lastOverall: report.overall, lastNotifiedAt: now, lastDelivery: { at: now, ...result }, consecutiveDeliveryFailures: 0 }
    // Not delivered: keep the previous fingerprint so the alert stays due on the next cycle.
    : { ...state, lastDelivery: { at: now, ...result }, consecutiveDeliveryFailures: state.consecutiveDeliveryFailures + 1 });
  return { report, sent: due.kind, delivered: result.ok };
}

/**
 * `ops:watch` — long-running monitor: every MONITOR_INTERVAL_SECONDS computes the ops status and sends ONE webhook
 * message when the condition changes (problem, changed, recovered) plus a reminder every MONITOR_REMINDER_HOURS
 * while not ok. Never restarts or modifies anything. Without ALERT_WEBHOOK_URL_FILE it only logs.
 */
export async function opsWatch(ctx: OperatorContext, args: readonly string[], env: NodeJS.ProcessEnv = process.env, signals: NodeJS.EventEmitter = process): Promise<number> {
  try {
    const a = parseArgs(args, { flags: ['--once'] });
    const s = watchSettings(env); // validates the configuration before the loop
    const runtime = { lastConsistencyAt: 0 };
    let stopping = false;
    let wake: (() => void) | null = null;
    let timer: NodeJS.Timeout | null = null;
    const stop = () => {
      stopping = true;
      if (timer) clearTimeout(timer);
      wake?.();
    };
    signals.on('SIGTERM', stop);
    signals.on('SIGINT', stop);
    try {
      ctx.out(JSON.stringify({ time: new Date().toISOString(), event: 'ops_watch_started', intervalSeconds: s.intervalMs / 1000, webhookConfigured: Boolean(s.webhook), tlsHost: s.tlsHost ?? null }));
      while (!stopping) {
        await opsWatchCycle(ctx, env, runtime);
        if (a.flags.has('--once')) break;
        await new Promise<void>((r) => {
          wake = r;
          timer = setTimeout(r, s.intervalMs);
        });
        timer = null;
      }
    } finally {
      signals.off('SIGTERM', stop);
      signals.off('SIGINT', stop);
    }
    return 0;
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

/**
 * `ops:alert-test` — sends ONE clearly marked test message to the configured webhook and reports the HTTP result.
 * Run it only when the owner has authorized a test to that recipient/channel.
 */
export async function opsAlertTest(ctx: OperatorContext, args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  try {
    parseArgs(args, {});
    const s = watchSettings(env);
    if (!s.webhook) throw new BackupError('CONFIG_INVALID', 'No alert webhook is configured (ALERT_WEBHOOK_URL_FILE is unset or the file is empty).');
    const now = (ctx.now ?? Date.now)();
    const r = await deliver(s.webhook, buildPayload(s.label, 'test', { time: new Date(now).toISOString(), overall: 'ok', checks: [] }, null));
    ctx.out(JSON.stringify({ time: new Date(now).toISOString(), event: r.ok ? 'alert_test_delivered' : 'alert_test_failed', httpStatus: r.httpStatus, attempts: r.attempts }));
    return r.ok ? 0 : 1;
  } catch (err) {
    return handleKnown(ctx, err);
  }
}

/**
 * `backup:offsite-get <backup-file-name>` — disaster recovery: downloads one backup object from the configured
 * off-server storage into BACKUP_DIR (exclusive create, 0600). It does NOT trust the copy: run backup:verify
 * (decrypt + consistency) and backup:restore next. Credentials come from the OFFSITE_*_FILE secret files.
 */
export async function backupOffsiteGet(ctx: OperatorContext, args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  try {
    const a = parseArgs(args, { positionals: 1 });
    const name = a.positionals[0]!;
    if (!/^alkhayr-\d{8}-\d{6}-[0-9a-f]{8}\.akbk$/.test(name)) throw new UsageError('Give the backup file NAME (alkhayr-YYYYMMDD-HHMMSS-xxxxxxxx.akbk), not a path.');
    const settings = loadJobSettings(env);
    if (!settings.offsite) throw new BackupError('CONFIG_INVALID', 'Off-server storage is not configured (OFFSITE_* settings).');
    const o = settings.offsite;
    const access = readSecretFile('OFFSITE_S3_ACCESS_KEY_FILE', o.accessKeyFile);
    const secret = readSecretFile('OFFSITE_S3_SECRET_KEY_FILE', o.secretKeyFile);
    if (!access.ok || !secret.ok) throw new BackupError('CONFIG_INVALID', 'Off-server credentials cannot be read.');
    const s3 = new S3Client({ endpoint: o.endpoint, region: o.region, bucket: o.bucket, prefix: o.prefix, pathStyle: o.pathStyle, accessKeyId: access.value, secretAccessKey: secret.value });
    mkdirSync(ctx.config.backupDir, { recursive: true, mode: 0o700 });
    const target = path.join(ctx.config.backupDir, name);
    if (existsSync(target)) throw new BackupError('TARGET_EXISTS', 'A backup with this name already exists locally; nothing was downloaded.');
    const partial = path.join(ctx.config.backupDir, `.${name}.partial`);
    rmSync(partial, { force: true });
    try {
      const head = await s3.head(s3.key(name));
      const got = await s3.getToFile(s3.key(name), partial);
      if (got.bytes !== head.bytes) throw new BackupError('OFFSITE_MISMATCH', 'Downloaded size differs from the stored object.');
      if (head.sha256Base64 && Buffer.from(got.hex, 'hex').toString('base64') !== head.sha256Base64) throw new BackupError('OFFSITE_MISMATCH', 'Downloaded checksum differs from the stored object.');
      renameSync(partial, target);
      ctx.out(`Downloaded ${name} (${got.bytes} bytes, sha256 ${got.hex}). NOT yet trusted: run backup:verify, then backup:restore.`);
      return 0;
    } finally {
      rmSync(partial, { force: true });
    }
  } catch (err) {
    if (err instanceof S3Error) {
      ctx.err(`Error [OFFSITE_HTTP_${err.status}${err.s3Code ? `_${err.s3Code}` : ''}]: ${err.message}`);
      return 1;
    }
    return handleKnown(ctx, err);
  }
}
