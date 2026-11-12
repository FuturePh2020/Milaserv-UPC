import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { AppConfig } from '../config.ts';
import { encryptSecret, deriveKey, MissingSecretError, totpAad } from '../auth/encryption.ts';
import { checkPasswordPolicy, PASSWORD_POLICY, PasswordHasher } from '../auth/passwords.ts';
import { base32Encode, generateTotpSecret, otpauthUri, verifyTotp } from '../auth/totp.ts';
import { openDatabase } from '../database/connection.ts';
import { DatabaseError } from '../database/errors.ts';
import { acquireInstanceLock } from '../database/instance-lock.ts';
import { inspectSchema, loadMigrations } from '../database/migrations.ts';
import { OPERATOR_COMMANDS } from '../database/runtime.ts';
import { assertNoAdministrator, assertUsernameAvailable, BootstrapError, createAdministrator } from '../services/admin-bootstrap.ts';
import { merchantProfileSchema, usernameSchema, type MerchantProfile } from '../../shared/schemas.ts';
import { CancelledError, InputTooLongError, type Prompter } from './prompt.ts';

/**
 * `setup-admin`: enroll the FIRST administrator on the trusted server host.
 * Order: preconditions → interactive input → hash + TOTP proof + encryption
 * (no transaction open) → one atomic write (user + approved profile + audit).
 */

export interface SetupAdminContext {
  config: AppConfig;
  migrationsDir: string;
  prompter: Prompter;
  err(line: string): void;
  hasher?: PasswordHasher;
  now?: () => number;
}

const MAX_ATTEMPTS = 3;

class AttemptsExhaustedError extends Error {}

async function askValid<T>(p: Prompter, ask: () => Promise<string>, parse: (raw: string) => { ok: true; value: T } | { ok: false; message: string }): Promise<T> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const result = parse(await ask());
    if (result.ok) return result.value;
    p.say(`  ✗ ${result.message}`);
  }
  throw new AttemptsExhaustedError('Too many invalid attempts.');
}

const POLICY_TEXT: Record<string, string> = {
  too_short: `at least ${PASSWORD_POLICY.minChars.admin} characters`,
  too_long_chars: `at most ${PASSWORD_POLICY.maxChars} characters`,
  too_long_bytes: `at most ${PASSWORD_POLICY.maxBytes} bytes (UTF-8)`,
};

export async function setupAdmin(ctx: SetupAdminContext): Promise<number> {
  const { config, prompter: p } = ctx;
  const now = ctx.now ?? Date.now;

  if (!config.appSecret) {
    p.close();
    ctx.err(`Error [APP_SECRET_REQUIRED]: ${new MissingSecretError('encrypting the administrator MFA secret').message}`);
    return 1;
  }
  const totpKey = deriveKey(config.appSecret, 'totp');
  const migrations = loadMigrations(ctx.migrationsDir);
  if (!existsSync(config.databasePath)) {
    p.close();
    ctx.err(`Error [DATABASE_MISSING]: No database found. Initialize it first with: ${OPERATOR_COMMANDS.init}`);
    return 1;
  }

  let lock: ReturnType<typeof acquireInstanceLock> | undefined;
  try {
    lock = acquireInstanceLock(config.dataDir, 'setup-admin (stop the server first)');
    const db = openDatabase(config.databasePath, { mustExist: true });
    try {
      const state = inspectSchema(db, migrations);
      if (state.kind === 'uninitialized') {
        ctx.err(`Error [DATABASE_UNINITIALIZED]: The database has no schema. Run: ${OPERATOR_COMMANDS.init}`);
        return 1;
      }
      if (state.kind === 'pending') {
        ctx.err(`Error [MIGRATIONS_PENDING]: Apply pending migrations first: ${OPERATOR_COMMANDS.migrate}`);
        return 1;
      }
      assertNoAdministrator(db);

      p.say('ALKHAYR — first administrator enrollment (local operator only).');
      p.say('Nothing is saved until every step succeeds. Press Ctrl-C at any time to cancel.\n');

      const username = await askValid(p, () => p.ask('Administrator username: '), (raw) => {
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

      p.say('\nCompany profile for the administrator account (shown on administrator-created orders):');
      const fields: Array<[keyof MerchantProfile, string]> = [
        ['businessName', 'Business name: '],
        ['contactName', 'Contact person: '],
        ['phone', 'Phone (e.g. 01012345678): '],
        ['governorate', 'Governorate: '],
        ['address', 'Address: '],
        ['email', 'Email (optional, Enter to skip): '],
      ];
      const raw: Record<string, string> = {};
      for (const [key, question] of fields) {
        raw[key] = await askValid(p, () => p.ask(question), (answer) => {
          const r = merchantProfileSchema.shape[key].safeParse(answer);
          return r.success ? { ok: true, value: answer } : { ok: false, message: r.error.issues[0]?.message ?? 'Invalid value.' };
        });
      }
      const profile = merchantProfileSchema.parse(raw);

      p.say(`\nPassword: ${PASSWORD_POLICY.minChars.admin}–${PASSWORD_POLICY.maxChars} characters. Input is hidden; nothing is echoed.`);
      let password = '';
      for (let i = 0; ; i++) {
        if (i >= MAX_ATTEMPTS) throw new AttemptsExhaustedError('Too many invalid password attempts.');
        let first: string;
        try {
          first = await p.askHidden('New administrator password: ');
        } catch (err) {
          if (err instanceof InputTooLongError) {
            p.say(`  ✗ Password must be ${POLICY_TEXT.too_long_chars}.`);
            continue;
          }
          throw err;
        }
        const issues = checkPasswordPolicy(first, 'admin');
        if (issues.length > 0) {
          p.say(`  ✗ Password must be ${issues.map((x) => POLICY_TEXT[x] ?? x).join(' and ')}.`);
          continue;
        }
        const second = await p.askHidden('Confirm password: ');
        if (second !== first) {
          p.say('  ✗ The passwords do not match.');
          continue;
        }
        password = first;
        break;
      }

      p.say('\nHashing password…');
      const passwordHash = await (ctx.hasher ?? new PasswordHasher()).hash(password);

      const secret = generateTotpSecret();
      p.say('\nAdd this account to an authenticator app (manual key entry, TOTP / SHA1 / 6 digits / 30 s):');
      p.say(`  Secret: ${base32Encode(secret).replace(/(.{4})/g, '$1 ').trim()}`);
      p.say(`  URI:    ${otpauthUri(secret, username)}`);
      p.say('Keep this secret private. Do NOT paste it into online QR-code generators or any third-party service.');
      const proof = await askValid(p, () => p.ask('Enter the current 6-digit code to confirm enrollment: '), (code) => {
        const v = verifyTotp(secret, code.trim(), now());
        return v.ok ? { ok: true, value: v.step } : { ok: false, message: 'Code not accepted. Check the device clock and try again.' };
      });

      const userId = randomUUID();
      const totpCiphertext = encryptSecret(totpKey, secret, totpAad(userId));
      secret.fill(0);

      createAdministrator(
        db,
        { userId, merchantId: randomUUID(), username, passwordHash, totpCiphertext, acceptedStep: proof, profile },
        now(),
        randomUUID(),
      );
      p.say(`\nAdministrator "${username}" created with MFA enrollment confirmed.`);
      p.say('Web login is NOT available yet: it is implemented in stage 04. Start the server with `npm start`.');
      return 0;
    } catch (err) {
      if (err instanceof CancelledError) {
        ctx.err('Cancelled. Nothing was saved.');
        return 1;
      }
      if (err instanceof AttemptsExhaustedError) {
        ctx.err(`${err.message} Nothing was saved.`);
        return 1;
      }
      if (err instanceof BootstrapError) {
        ctx.err(`Error [${err.code}]: ${err.message}`);
        return 1;
      }
      throw err;
    } finally {
      db.close();
    }
  } catch (err) {
    if (err instanceof DatabaseError) {
      ctx.err(`Error [${err.code}]: ${err.message}`);
      return 1;
    }
    throw err;
  } finally {
    lock?.release();
    p.close();
  }
}
