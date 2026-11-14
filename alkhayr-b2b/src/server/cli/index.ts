import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig, type AppConfig } from '../config.ts';
import { openDatabase } from '../database/connection.ts';
import { DatabaseError } from '../database/errors.ts';
import { acquireInstanceLock } from '../database/instance-lock.ts';
import { applyMigrations, inspectSchema, loadMigrations, quickCheck, type Migration } from '../database/migrations.ts';
import { OPERATOR_COMMANDS } from '../database/runtime.ts';
import { createTerminalPrompter, NotInteractiveError, type Prompter } from './prompt.ts';
import type { PasswordHasher } from '../auth/passwords.ts';
import { setupAdmin } from './setup-admin.ts';
import { accountResetMfa, accountResetPassword, accountRevokeSessions, adminCreate, backupOffsiteGet, backupRun, backupSchedule, opsStatus, opsWatch, opsAlertTest, dbCheck, recoveryReopen, recoveryStatus, backupCreate, backupInspect, backupKeygen, backupPrune, backupRestore, backupStatusCommand, backupVerify, type OperatorContext } from './operator.ts';

/**
 * Trusted-operator command line. Runs on the server host only; nothing here is
 * reachable over HTTP. Later stages add setup-admin, reset-password,
 * reset-mfa, backup and restore.
 */

const USAGE = `ALKHAYR operator CLI

Usage: node dist/server/cli.js <command> [options]

Commands:
  db:status                    Show schema version, pending migrations and integrity (read-only).
  db:init                      Create a NEW database and apply all migrations.
                               Refuses if a database with any schema already exists.
  db:migrate --confirm-backup  Apply pending migrations to an existing database.
                               The server must be stopped. --confirm-backup affirms that a
                               verified, restorable backup of the current database exists.
  setup-admin                  Enroll the FIRST administrator interactively (password + TOTP).
                               Requires an initialized database, APP_SECRET, a stopped server and
                               an interactive terminal. Takes no arguments; secrets are never
                               accepted on the command line.
  admin:create                 Create an ADDITIONAL administrator (interactive; password + TOTP proof).
  account:reset-password       Reset an account password (interactive; revokes its sessions).
  account:reset-mfa            Replace an administrator authenticator (interactive; proof required).
  account:revoke-sessions      Revoke all sessions of an account (interactive).
                               Account commands need a stopped server, a confirmation of the target
                               username and a reason; they are audited without any secret.
  backup:keygen --out <file>   Create a NEW backup key file (0600) outside DATA_DIR and BACKUP_DIR.
  backup:create [--key-file <file>] [--keep <n>]
                               Consistent snapshot -> encrypt -> verify -> BACKUP_DIR (server may run).
  backup:inspect <backup>      Show the (unverified) header metadata.
  backup:verify <backup> [--key-file <file>]
                               Decrypt into private staging and verify integrity, schema, invariants
                               and APP_SECRET compatibility.
  backup:restore <backup> [--key-file <file>] [--replace] [--accept-new-app-secret]
                               Restore into DATA_DIR (server stopped). Refuses an existing database
                               unless --replace (the old one is moved aside, never deleted).
  backup:prune --keep <n>      Delete older managed backups; always keeps the newest verified one.
  backup:status                Backup age, sizes, row counts and free space (exit 3 = warnings).
                               Without --key-file the backup key is asked for with hidden input.
  db:check [--samples <n>]     Read-only consistency verification of orders, events, allocations, ledger and
                               imports (safe while the server runs). Exit 0 ok, 1 errors, 3 warnings only.
  recovery:status              Show whether business writes are open or in post-restore recovery mode (exit 3).
  recovery:reopen              After reconciliation: reopen business writes (interactive; reason; audited).
  backup:run                   One scheduled-backup job: verified encrypted backup, rotation and (if configured)
                               off-server copy verified by download + decrypt + consistency check (exit 0/1).
                               Key and storage credentials come from protected files (BACKUP_KEY_FILE, OFFSITE_*_FILE).
  backup:offsite-get <name>    Disaster recovery: download one backup from off-server storage into BACKUP_DIR
                               (not trusted until backup:verify).
  backup:schedule              Long-running scheduler for backup:run (BACKUP_SCHEDULE "HH:MM,…" in BACKUP_TZ).
  ops:status [--tls-host h[:p]] [--tls-ca f] [--skip-consistency]
                               Private monitoring status as JSON (exit 0 ok, 3 warning, 1 critical).
  ops:watch [--once]           Long-running monitor: runs the ops status every MONITOR_INTERVAL_SECONDS and posts ONE
                               webhook message per change (problem / changed / recovered) and a daily reminder while
                               not ok. Webhook URL from the protected file ALERT_WEBHOOK_URL_FILE; without it, logs only.
  ops:alert-test               Send one marked TEST message to the configured webhook (only with the owner's authorization).
  help                         Show this help.

Initialization sequence: db:init -> setup-admin -> start the server.

Configuration comes from the environment (and .env via the npm scripts): DATA_DIR etc.
Exit codes: 0 success, 1 failure, 2 usage error.`;

interface Io {
  out(line: string): void;
  err(line: string): void;
}

export interface CliContext {
  config: AppConfig;
  migrationsDir: string;
  io: Io;
  now?: () => number;
  /** Interactive input; defaults to the controlling terminal (refused when not a TTY). */
  createPrompter?: () => Prompter;
  /** Password hasher override (tests use cheap parameters). */
  hasher?: PasswordHasher;
}

function describePending(pending: readonly Migration[]): string {
  return pending.map((m) => m.filename).join(', ');
}

function dbStatus(ctx: CliContext): number {
  const migrations = loadMigrations(ctx.migrationsDir);
  if (!existsSync(ctx.config.databasePath)) {
    ctx.io.out(JSON.stringify({ initialized: false, latestVersion: migrations.length, hint: OPERATOR_COMMANDS.init }, null, 2));
    return 0;
  }
  const db = openDatabase(ctx.config.databasePath, { mustExist: true });
  try {
    const state = inspectSchema(db, migrations);
    const problems = state.kind === 'uninitialized' ? [] : quickCheck(db);
    ctx.io.out(
      JSON.stringify(
        {
          initialized: state.kind !== 'uninitialized',
          schemaVersion: state.kind === 'uninitialized' ? 0 : state.version,
          latestVersion: state.latestKnown,
          pending: state.kind === 'pending' ? state.pending.map((m) => m.filename) : [],
          integrity: problems.length === 0 ? 'ok' : `${problems.length} problem(s)`,
          journalMode: (db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode,
        },
        null,
        2,
      ),
    );
    return problems.length === 0 ? 0 : 1;
  } finally {
    db.close();
  }
}

function dbInit(ctx: CliContext): number {
  const migrations = loadMigrations(ctx.migrationsDir);
  const lock = acquireInstanceLock(ctx.config.dataDir, 'db:init');
  try {
    const db = openDatabase(ctx.config.databasePath, { mustExist: false });
    try {
      const state = inspectSchema(db, migrations);
      if (state.kind !== 'uninitialized') {
        ctx.io.err(
          `Refusing to initialize: a database with schema version ${state.version} already exists. Nothing was changed.\n` +
            `Use ${OPERATOR_COMMANDS.status} to inspect it${state.kind === 'pending' ? ` or ${OPERATOR_COMMANDS.migrate} to upgrade it` : ''}.`,
        );
        return 1;
      }
      const result = applyMigrations(db, migrations, ctx.now);
      ctx.io.out(`Database initialized at schema version ${result.toVersion} (${result.applied.join(', ')}).`);
      ctx.io.out('No users or business data were created. Create the administrator with the stage-03 setup command.');
      return 0;
    } finally {
      db.close();
    }
  } finally {
    lock.release();
  }
}

function dbMigrate(ctx: CliContext, args: readonly string[]): number {
  const migrations = loadMigrations(ctx.migrationsDir);
  if (!existsSync(ctx.config.databasePath)) {
    ctx.io.err(`No database found. Initialize a new one with: ${OPERATOR_COMMANDS.init}`);
    return 1;
  }
  const lock = acquireInstanceLock(ctx.config.dataDir, 'db:migrate (stop the server first)');
  try {
    const db = openDatabase(ctx.config.databasePath, { mustExist: true });
    try {
      const state = inspectSchema(db, migrations);
      if (state.kind === 'uninitialized') {
        ctx.io.err(`The database has no schema. Use ${OPERATOR_COMMANDS.init} instead.`);
        return 1;
      }
      if (state.kind === 'current') {
        ctx.io.out(`Database is up to date at schema version ${state.version}. Nothing to do.`);
        return 0;
      }
      if (!args.includes('--confirm-backup')) {
        ctx.io.err(
          `Pending migrations: ${describePending(state.pending)} (version ${state.version} -> ${state.latestKnown}).\n` +
            'Migrations change an existing database. Stop the server, take a backup and verify it can be restored, then re-run with --confirm-backup.',
        );
        return 1;
      }
      const problems = quickCheck(db);
      if (problems.length > 0) {
        ctx.io.err('SQLite quick_check failed; refusing to migrate a damaged database. Restore from a verified backup.');
        return 1;
      }
      const result = applyMigrations(db, migrations, ctx.now);
      ctx.io.out(`Migrated schema version ${result.fromVersion} -> ${result.toVersion} (${result.applied.join(', ')}).`);
      return 0;
    } finally {
      db.close();
    }
  } finally {
    lock.release();
  }
}

function operatorCtx(ctx: CliContext): OperatorContext {
  return {
    config: ctx.config,
    migrationsDir: ctx.migrationsDir,
    out: ctx.io.out,
    err: ctx.io.err,
    prompter: ctx.createPrompter ?? (() => createTerminalPrompter()),
    ...(ctx.hasher ? { hasher: ctx.hasher } : {}),
    ...(ctx.now ? { now: ctx.now } : {}),
  };
}

export async function runCli(argv: readonly string[], ctx: CliContext): Promise<number> {
  const [command, ...args] = argv;
  try {
    switch (command) {
      case 'setup-admin': {
        if (args.length > 0) {
          ctx.io.err('setup-admin takes no arguments. Usernames and passwords are entered interactively; passwords are never accepted as arguments.');
          return 2;
        }
        let prompter: Prompter;
        try {
          prompter = (ctx.createPrompter ?? (() => createTerminalPrompter()))();
        } catch (err) {
          if (err instanceof NotInteractiveError) {
            ctx.io.err(`Error [NOT_INTERACTIVE]: ${err.message}`);
            return 1;
          }
          throw err;
        }
        return await setupAdmin({ config: ctx.config, migrationsDir: ctx.migrationsDir, prompter, err: ctx.io.err, ...(ctx.now ? { now: ctx.now } : {}) });
      }
      case 'admin:create':
        return await adminCreate(operatorCtx(ctx), args);
      case 'account:reset-password':
        return await accountResetPassword(operatorCtx(ctx), args);
      case 'account:reset-mfa':
        return await accountResetMfa(operatorCtx(ctx), args);
      case 'account:revoke-sessions':
        return await accountRevokeSessions(operatorCtx(ctx), args);
      case 'backup:keygen':
        return await backupKeygen(operatorCtx(ctx), args);
      case 'backup:create':
        return await backupCreate(operatorCtx(ctx), args);
      case 'backup:inspect':
        return await backupInspect(operatorCtx(ctx), args);
      case 'backup:verify':
        return await backupVerify(operatorCtx(ctx), args);
      case 'backup:restore':
        return await backupRestore(operatorCtx(ctx), args);
      case 'backup:prune':
        return await backupPrune(operatorCtx(ctx), args);
      case 'backup:status':
        return await backupStatusCommand(operatorCtx(ctx), args);
      case 'db:status':
        return dbStatus(ctx);
      case 'db:check':
        return await dbCheck(operatorCtx(ctx), args);
      case 'backup:run':
        return await backupRun(operatorCtx(ctx), args);
      case 'backup:offsite-get':
        return await backupOffsiteGet(operatorCtx(ctx), args);
      case 'backup:schedule':
        return await backupSchedule(operatorCtx(ctx), args);
      case 'ops:status':
        return await opsStatus(operatorCtx(ctx), args);
      case 'ops:watch':
        return await opsWatch(operatorCtx(ctx), args);
      case 'ops:alert-test':
        return await opsAlertTest(operatorCtx(ctx), args);
      case 'recovery:status':
        return await recoveryStatus(operatorCtx(ctx), args);
      case 'recovery:reopen':
        return await recoveryReopen(operatorCtx(ctx), args);
      case 'db:init':
        return dbInit(ctx);
      case 'db:migrate':
        return dbMigrate(ctx, args);
      case 'help':
      case '--help':
      case '-h':
        ctx.io.out(USAGE);
        return 0;
      default:
        ctx.io.err(USAGE);
        return 2;
    }
  } catch (err) {
    if (err instanceof DatabaseError) {
      ctx.io.err(`Error [${err.code}]: ${err.message}`);
      return 1;
    }
    if (err instanceof NotInteractiveError) {
      ctx.io.err(`Error [NOT_INTERACTIVE]: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

function main(): void {
  process.umask(0o077);
  const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const appRoot = path.resolve(distDir, '..');
  const io: Io = { out: (l) => process.stdout.write(l + '\n'), err: (l) => process.stderr.write(l + '\n') };
  let config: AppConfig;
  try {
    config = loadConfig(process.env, { baseDir: appRoot, staticRoot: path.join(distDir, 'web') });
  } catch (err) {
    if (err instanceof ConfigError) {
      io.err(`Invalid configuration:\n- ${err.issues.join('\n- ')}`);
      process.exit(1);
    }
    throw err;
  }
  runCli(process.argv.slice(2), { config, migrationsDir: path.join(appRoot, 'migrations'), io }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      io.err(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  );
}

// Only run when executed as the CLI bundle (not when imported by tests).
if (process.argv[1] && path.basename(process.argv[1]) === 'cli.js') main();
