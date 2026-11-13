import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config.ts';
import { openDatabase } from './connection.ts';
import { DatabaseError } from './errors.ts';
import { acquireInstanceLock, type InstanceLock } from './instance-lock.ts';
import { inspectSchema, loadMigrations, quickCheck } from './migrations.ts';
import { createReadinessProbe, type ReadinessProbe } from './readiness.ts';
import { assertAdministratorMfaReadable } from '../auth/mfa-key-check.ts';
import { verifyConsistency, type ConsistencyReport } from './consistency.ts';

export interface RuntimeDatabase {
  readonly db: DatabaseSync;
  readonly schemaVersion: number;
  readonly readiness: ReadinessProbe;
  /** Number of administrators (0 = setup-admin has not been run yet). */
  readonly administrators: number;
  /** Startup consistency report (stage 16); errors put the server under an integrity hold. */
  readonly consistency: ConsistencyReport;
  close(): void;
}

/** How operators run maintenance commands, shown in startup failures. */
export const OPERATOR_COMMANDS = {
  init: 'npm run db:init   (release: node dist/server/cli.js db:init)',
  migrate: 'npm run db:migrate -- --confirm-backup   (release: node dist/server/cli.js db:migrate --confirm-backup)',
  status: 'npm run db:status   (release: node dist/server/cli.js db:status)',
  setupAdmin: 'npm run setup-admin   (release: node dist/server/cli.js setup-admin)',
} as const;

/**
 * Server startup: take the single-instance lock, open the EXISTING database,
 * and require its schema to be exactly current. The server never creates,
 * migrates or resets a database; that is an explicit operator action.
 */
export function openRuntimeDatabase(config: AppConfig, migrationsDir: string): RuntimeDatabase {
  const migrations = loadMigrations(migrationsDir);
  const lock: InstanceLock = acquireInstanceLock(config.dataDir, 'the server');
  let db: DatabaseSync | undefined;
  try {
    try {
      db = openDatabase(config.databasePath, { mustExist: true });
    } catch (err) {
      if (err instanceof DatabaseError && err.code === 'DATABASE_MISSING') {
        throw new DatabaseError('DATABASE_MISSING', `The database has not been initialized. Initialize it once with: ${OPERATOR_COMMANDS.init}`);
      }
      throw err;
    }
    const state = inspectSchema(db, migrations);
    if (state.kind === 'uninitialized') {
      throw new DatabaseError('DATABASE_UNINITIALIZED', `The database file exists but has no schema. Initialize it with: ${OPERATOR_COMMANDS.init}`);
    }
    if (state.kind === 'pending') {
      throw new DatabaseError(
        'MIGRATIONS_PENDING',
        `The database schema is at version ${state.version} but this release requires version ${state.latestKnown}. ` +
          `Stop all instances, take and verify a backup, then run: ${OPERATOR_COMMANDS.migrate}`,
      );
    }
    const problems = quickCheck(db);
    if (problems.length > 0) {
      throw new DatabaseError('INTEGRITY_CHECK_FAILED', `SQLite quick_check reported ${problems.length} problem(s). Do not use this database; restore from a verified backup.`);
    }
    // Administrator MFA secrets must decrypt with the configured APP_SECRET (fail closed, never reset).
    const { administrators } = assertAdministratorMfaReadable(db, config.appSecret);
    // Stage 16: full consistency verification (read-only). Errors do not stop the process (operators
    // must be able to read and reconcile), but every new business write is refused (integrity hold).
    const consistency = verifyConsistency(db, { maxSamples: 0 });
    // From here on the connection can no longer change schema or PRAGMA settings.
    db.close();
    db = openDatabase(config.databasePath, { mustExist: true, runtime: true });
    const opened = db;
    const readiness = createReadinessProbe(opened, config.databasePath, state.version);
    let closed = false;
    return {
      db: opened,
      schemaVersion: state.version,
      readiness,
      administrators,
      consistency,
      close() {
        if (closed) return;
        closed = true;
        try {
          opened.close();
        } finally {
          lock.release();
        }
      },
    };
  } catch (err) {
    if (db?.isOpen) db.close();
    lock.release();
    throw err;
  }
}
