import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { constants as sqlite, type DatabaseSync } from 'node:sqlite';
import { APPLICATION_ID } from './connection.ts';
import { DatabaseError } from './errors.ts';

/**
 * Versioned, checksum-verified, ordered migrations (docs/DATABASE.md §3).
 * Files: migrations/NNNN_name.sql, contiguous from 0001. Each pending file runs
 * in its own BEGIN IMMEDIATE transaction together with its history row and
 * PRAGMA user_version, so a failure records nothing. Applied files are
 * immutable: any checksum difference stops startup.
 */

export interface Migration {
  version: number;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
}

export type SchemaState =
  | { kind: 'uninitialized'; latestKnown: number }
  | { kind: 'current'; version: number; latestKnown: number }
  | { kind: 'pending'; version: number; latestKnown: number; pending: Migration[] };

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]{1,80})\.sql$/;

export function loadMigrations(dir: string): Migration[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw new DatabaseError('MIGRATIONS_MISSING', 'The migrations directory is missing from this installation.', { cause: err });
  }
  const migrations: Migration[] = [];
  for (const filename of entries.sort()) {
    if (!filename.endsWith('.sql')) continue;
    const m = FILE_PATTERN.exec(filename);
    if (!m) throw new DatabaseError('MIGRATION_FILENAME', `Invalid migration filename: ${filename} (expected NNNN_name.sql).`);
    const bytes = readFileSync(path.join(dir, filename));
    migrations.push({
      version: Number(m[1]),
      name: m[2] as string,
      filename,
      sql: bytes.toString('utf8'),
      checksum: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  migrations.forEach((mig, i) => {
    if (mig.version !== i + 1) {
      throw new DatabaseError('MIGRATION_SEQUENCE', `Migrations must be numbered contiguously from 0001; found ${mig.filename} at position ${i + 1}.`);
    }
  });
  if (migrations.length === 0) throw new DatabaseError('MIGRATIONS_MISSING', 'No migrations were found.');
  return migrations;
}

function scalar(db: DatabaseSync, sql: string): unknown {
  const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
  return row ? Object.values(row)[0] : undefined;
}

interface AppliedRow {
  version: number;
  name: string;
  checksum: string;
}

/** Inspect schema state against the known migrations. Throws on anything unsafe. */
export function inspectSchema(db: DatabaseSync, migrations: readonly Migration[]): SchemaState {
  const latestKnown = migrations.length;
  const appId = Number(scalar(db, 'PRAGMA application_id'));
  const userVersion = Number(scalar(db, 'PRAGMA user_version'));
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  const hasHistory = tables.some((t) => t.name === 'schema_migrations');

  if (appId !== 0 && appId !== APPLICATION_ID) {
    throw new DatabaseError('FOREIGN_DATABASE', 'This file is not an ALKHAYR database (unexpected application_id).');
  }
  if (!hasHistory) {
    if (tables.length === 0 && appId === 0 && userVersion === 0) return { kind: 'uninitialized', latestKnown };
    throw new DatabaseError('NO_MIGRATION_HISTORY', 'The database contains tables but no migration history. Refusing to use or modify it.');
  }

  const applied = db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all() as unknown as AppliedRow[];
  const maxApplied = applied.length === 0 ? 0 : applied[applied.length - 1]!.version;
  if (maxApplied > latestKnown || userVersion > latestKnown) {
    throw new DatabaseError(
      'SCHEMA_TOO_NEW',
      `The database schema (version ${Math.max(maxApplied, userVersion)}) is newer than this application supports (version ${latestKnown}). Run the matching or newer application release; do not downgrade.`,
    );
  }
  applied.forEach((row, i) => {
    if (row.version !== i + 1) throw new DatabaseError('MIGRATION_HISTORY_GAP', `Migration history is not contiguous at version ${i + 1}.`);
    const known = migrations[i]!;
    if (row.checksum !== known.checksum || row.name !== known.name) {
      throw new DatabaseError(
        'MIGRATION_CHECKSUM_MISMATCH',
        `Applied migration ${known.filename} does not match the file shipped with this release (checksum/name differ). Applied migrations are immutable; restore the original file.`,
      );
    }
  });
  if (userVersion !== maxApplied) {
    throw new DatabaseError('USER_VERSION_MISMATCH', `PRAGMA user_version (${userVersion}) does not match the migration history (${maxApplied}).`);
  }
  if (maxApplied === latestKnown) return { kind: 'current', version: maxApplied, latestKnown };
  return { kind: 'pending', version: maxApplied, latestKnown, pending: migrations.slice(maxApplied) };
}

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: string[];
}

export class MigrationFailedError extends DatabaseError {
  readonly version: number;
  constructor(migration: Migration, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super('MIGRATION_FAILED', `Migration ${migration.filename} failed and was rolled back: ${detail}`, { cause });
    this.name = 'MigrationFailedError';
    this.version = migration.version;
  }
}

/** Apply all pending migrations, each atomically. Returns what was applied. */
export function applyMigrations(db: DatabaseSync, migrations: readonly Migration[], now: () => number = Date.now): MigrationResult {
  const initial = inspectSchema(db, migrations);
  const fromVersion = initial.kind === 'uninitialized' ? 0 : initial.version;
  const applied: string[] = [];
  for (const migration of migrations.slice(fromVersion)) {
    if (db.isTransaction) throw new DatabaseError('MIGRATION_IN_TRANSACTION', 'Cannot migrate inside an open transaction.');
    db.exec('BEGIN IMMEDIATE');
    try {
      // Re-check inside the write lock: another process may have applied it.
      const state = inspectSchema(db, migrations);
      const current = state.kind === 'uninitialized' ? 0 : state.version;
      if (current >= migration.version) {
        db.exec('ROLLBACK');
        continue;
      }
      if (current !== migration.version - 1) throw new DatabaseError('MIGRATION_SEQUENCE', 'Unexpected schema version during migration.');
      // While the file runs, transaction control, savepoints and ATTACH are denied,
      // so a migration cannot commit part of itself or touch another database.
      db.setAuthorizer((action: number) =>
        action === sqlite.SQLITE_TRANSACTION || action === sqlite.SQLITE_SAVEPOINT || action === sqlite.SQLITE_ATTACH || action === sqlite.SQLITE_DETACH
          ? sqlite.SQLITE_DENY
          : sqlite.SQLITE_OK,
      );
      try {
        db.exec(migration.sql);
      } finally {
        db.setAuthorizer(null);
      }
      if (!db.isTransaction) throw new DatabaseError('MIGRATION_TRANSACTION_CONTROL', 'Migration files must not contain BEGIN/COMMIT/ROLLBACK.');
      const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
      if (fkViolations.length > 0) throw new DatabaseError('MIGRATION_FOREIGN_KEYS', `Migration left ${fkViolations.length} foreign-key violation(s).`);
      db.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)').run(
        migration.version,
        migration.name,
        migration.checksum,
        now(),
      );
      if (!Number.isSafeInteger(migration.version)) throw new DatabaseError('MIGRATION_SEQUENCE', 'Invalid version.');
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
      applied.push(migration.filename);
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK');
      // Schema-state errors (e.g. tampering detected inside the lock) pass through;
      // anything raised while executing the file is reported as a failed migration.
      const passThrough = err instanceof DatabaseError && !['MIGRATION_TRANSACTION_CONTROL', 'MIGRATION_FOREIGN_KEYS'].includes(err.code);
      throw passThrough ? err : new MigrationFailedError(migration, err);
    }
  }
  const final = inspectSchema(db, migrations);
  if (final.kind !== 'current') throw new DatabaseError('MIGRATION_INCOMPLETE', 'Migrations did not reach the latest version.');
  return { fromVersion, toVersion: final.version, applied };
}

/** SQLite's own consistency check; returns problems ([] when healthy). */
export function quickCheck(db: DatabaseSync): string[] {
  const rows = db.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>;
  const messages = rows.map((r) => String(Object.values(r)[0]));
  return messages.length === 1 && messages[0] === 'ok' ? [] : messages;
}
