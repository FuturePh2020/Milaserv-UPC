import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { APPLICATION_ID, openDatabase } from '../../src/server/database/connection.ts';
import { DatabaseError } from '../../src/server/database/errors.ts';
import { applyMigrations, inspectSchema, loadMigrations, MigrationFailedError, quickCheck } from '../../src/server/database/migrations.ts';
import { createTestDatabase, LATEST_VERSION, MIGRATIONS_DIR, nextMigrationFile, tempDir } from '../helpers/database.ts';

const scalar = (db: DatabaseSync, sql: string) => Object.values(db.prepare(sql).get() as object)[0];

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof DatabaseError, `expected DatabaseError, got ${String(err)}`);
    return err.code;
  }
  assert.fail('expected a DatabaseError');
}

/** Copy of the real migrations into a scratch dir that a test may extend. */
function migrationsCopy(): string {
  const dir = path.join(tempDir('alkhayr-mig-'), 'migrations');
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  return dir;
}

const EXPECTED_TABLES = [
  'audit_logs', 'auth_users', 'business_settings', 'import_operation_items', 'import_operations', 'inventory_ledger', 'merchants', 'order_allocations', 'order_events', 'order_items',
  'orders', 'product_categories', 'products', 'rate_limits', 'schema_migrations', 'sessions', 'system_state',
];

describe('loading migrations', () => {
  test('the shipped migrations load in order with SHA-256 checksums of the exact file bytes', () => {
    const migrations = loadMigrations(MIGRATIONS_DIR);
    assert.equal(migrations[0]?.filename, '0001_initial.sql');
    assert.equal(migrations[0]?.version, 1);
    assert.equal(migrations[0]?.name, 'initial');
    assert.equal(migrations[0]?.checksum, createHash('sha256').update(readFileSync(path.join(MIGRATIONS_DIR, '0001_initial.sql'))).digest('hex'));
  });

  test('invalid filenames, gaps and empty directories are rejected', () => {
    const bad = migrationsCopy();
    writeFileSync(path.join(bad, '2_oops.sql'), 'SELECT 1;');
    assert.equal(code(() => loadMigrations(bad)), 'MIGRATION_FILENAME');
    const gap = migrationsCopy();
    writeFileSync(path.join(gap, nextMigrationFile('skipped', 2)), 'SELECT 1;');
    assert.equal(code(() => loadMigrations(gap)), 'MIGRATION_SEQUENCE');
    assert.equal(code(() => loadMigrations(path.join(tempDir(), 'none'))), 'MIGRATIONS_MISSING');
    assert.equal(code(() => loadMigrations(tempDir())), 'MIGRATIONS_MISSING');
  });
});

describe('fresh initialization and repeat runs', () => {
  test('a new file is uninitialized; applying produces the full schema at the latest version', () => {
    const t = createTestDatabase({ migrate: false });
    try {
      const migrations = loadMigrations(MIGRATIONS_DIR);
      assert.deepEqual(inspectSchema(t.db, migrations), { kind: 'uninitialized', latestKnown: LATEST_VERSION });
      const result = applyMigrations(t.db, migrations, () => 1_800_000_000_000);
      assert.deepEqual(result, { fromVersion: 0, toVersion: LATEST_VERSION, applied: migrations.map((m) => m.filename) });
      assert.equal(result.applied[0], '0001_initial.sql');
      assert.equal(scalar(t.db, 'PRAGMA user_version'), LATEST_VERSION);
      assert.equal(scalar(t.db, 'PRAGMA application_id'), APPLICATION_ID);
      const tables = (t.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
      assert.deepEqual(tables, EXPECTED_TABLES);
      const history = t.db.prepare('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version').all();
      assert.deepEqual(
        history.map((r) => ({ ...r })),
        migrations.map((m) => ({ version: m.version, name: m.name, checksum: m.checksum, applied_at: 1_800_000_000_000 })),
      );
      assert.deepEqual(quickCheck(t.db), []);
      assert.equal(t.db.prepare('PRAGMA foreign_key_check').all().length, 0);
    } finally {
      t.cleanup();
    }
  });

  test('re-running migrations is a no-op and does not reseed or reset data', () => {
    const t = createTestDatabase();
    try {
      t.db.prepare("UPDATE business_settings SET tax_bps = 1400, version = version + 1 WHERE id = 1").run();
      const migrations = loadMigrations(MIGRATIONS_DIR);
      const result = applyMigrations(t.db, migrations);
      assert.deepEqual(result.applied, []);
      assert.equal(scalar(t.db, 'SELECT count(*) FROM schema_migrations'), LATEST_VERSION);
      assert.equal(scalar(t.db, 'SELECT tax_bps FROM business_settings'), 1400);
      assert.equal(scalar(t.db, 'SELECT count(*) FROM product_categories'), 4);
      assert.deepEqual(inspectSchema(t.db, migrations), { kind: 'current', version: LATEST_VERSION, latestKnown: LATEST_VERSION });
    } finally {
      t.cleanup();
    }
  });

  test('a second connection racing to migrate the same file does not double-apply', () => {
    const t = createTestDatabase({ migrate: false });
    const other = openDatabase(t.file, { mustExist: true });
    try {
      const migrations = loadMigrations(MIGRATIONS_DIR);
      applyMigrations(t.db, migrations);
      assert.deepEqual(applyMigrations(other, migrations).applied, []);
      assert.equal(scalar(other, 'SELECT count(*) FROM schema_migrations'), LATEST_VERSION);
    } finally {
      other.close();
      t.cleanup();
    }
  });
});

describe('immutability and version guards', () => {
  test('an altered applied migration is rejected (content or name)', () => {
    const dir = migrationsCopy();
    const t = createTestDatabase({ migrationsDir: dir });
    try {
      appendFileSync(path.join(dir, '0001_initial.sql'), '\n-- harmless-looking edit\n');
      assert.equal(code(() => inspectSchema(t.db, loadMigrations(dir))), 'MIGRATION_CHECKSUM_MISMATCH');
      assert.equal(code(() => applyMigrations(t.db, loadMigrations(dir))), 'MIGRATION_CHECKSUM_MISMATCH');
      const renamed = migrationsCopy();
      renameSync(path.join(renamed, '0001_initial.sql'), path.join(renamed, '0001_first.sql'));
      assert.equal(code(() => inspectSchema(t.db, loadMigrations(renamed))), 'MIGRATION_CHECKSUM_MISMATCH');
    } finally {
      t.cleanup();
    }
  });

  test('a database newer than this release is rejected (history or user_version)', () => {
    const dir = migrationsCopy();
    writeFileSync(path.join(dir, nextMigrationFile('future')), 'CREATE TABLE future_feature (id INTEGER PRIMARY KEY) STRICT;\n');
    const t = createTestDatabase({ migrationsDir: dir });
    try {
      assert.equal(scalar(t.db, 'PRAGMA user_version'), LATEST_VERSION + 1);
      assert.equal(code(() => inspectSchema(t.db, loadMigrations(MIGRATIONS_DIR))), 'SCHEMA_TOO_NEW');
      assert.equal(code(() => applyMigrations(t.db, loadMigrations(MIGRATIONS_DIR))), 'SCHEMA_TOO_NEW');
    } finally {
      t.cleanup();
    }
    const u = createTestDatabase();
    try {
      u.db.exec(`PRAGMA user_version = ${LATEST_VERSION + 1}`);
      assert.equal(code(() => inspectSchema(u.db, loadMigrations(MIGRATIONS_DIR))), 'SCHEMA_TOO_NEW');
    } finally {
      u.cleanup();
    }
  });

  test('foreign files, tables without history and mismatched user_version are rejected', () => {
    const migrations = loadMigrations(MIGRATIONS_DIR);
    const a = createTestDatabase({ migrate: false });
    try {
      a.db.exec('PRAGMA application_id = 12345');
      assert.equal(code(() => inspectSchema(a.db, migrations)), 'FOREIGN_DATABASE');
    } finally {
      a.cleanup();
    }
    const b = createTestDatabase({ migrate: false });
    try {
      b.db.exec('CREATE TABLE something_else (x INTEGER)');
      assert.equal(code(() => inspectSchema(b.db, migrations)), 'NO_MIGRATION_HISTORY');
      assert.equal(code(() => applyMigrations(b.db, migrations)), 'NO_MIGRATION_HISTORY');
    } finally {
      b.cleanup();
    }
    const c = createTestDatabase();
    try {
      c.db.exec('PRAGMA user_version = 0');
      assert.equal(code(() => inspectSchema(c.db, migrations)), 'USER_VERSION_MISMATCH');
    } finally {
      c.cleanup();
    }
  });

  test('history rows cannot be updated or deleted', () => {
    const t = createTestDatabase();
    try {
      assert.throws(() => t.db.exec("UPDATE schema_migrations SET checksum = 'x' WHERE version = 1"), /append-only/);
      assert.throws(() => t.db.exec('DELETE FROM schema_migrations'), /append-only/);
    } finally {
      t.cleanup();
    }
  });
});

describe('failed migrations leave no recorded success', () => {
  function failingCase(sql: string): { db: DatabaseSync; dir: string; cleanup(): void } {
    const dir = migrationsCopy();
    const t = createTestDatabase({ migrationsDir: dir });
    writeFileSync(path.join(dir, nextMigrationFile('next')), sql);
    return { db: t.db, dir, cleanup: t.cleanup };
  }

  function assertStillAtLatest(db: DatabaseSync) {
    assert.equal(scalar(db, 'SELECT max(version) FROM schema_migrations'), LATEST_VERSION);
    assert.equal(scalar(db, 'PRAGMA user_version'), LATEST_VERSION);
    assert.equal(scalar(db, "SELECT count(*) FROM sqlite_schema WHERE name = 'half_done'"), 0);
    assert.equal(scalar(db, 'SELECT shipping_cents FROM business_settings'), 0);
    assert.equal(db.isTransaction, false);
  }

  test('an SQL error mid-file rolls back every statement of that migration', () => {
    const c = failingCase(
      'CREATE TABLE half_done (id INTEGER PRIMARY KEY) STRICT;\nUPDATE business_settings SET shipping_cents = 999, version = version + 1;\nTHIS IS NOT SQL;\n',
    );
    try {
      const err = (() => {
        try {
          applyMigrations(c.db, loadMigrations(c.dir));
        } catch (e) {
          return e;
        }
      })();
      assert.ok(err instanceof MigrationFailedError);
      assert.equal(err.version, LATEST_VERSION + 1);
      assertStillAtLatest(c.db);
      // The fixed migration can then be applied normally.
      writeFileSync(path.join(c.dir, nextMigrationFile('next')), 'CREATE TABLE half_done (id INTEGER PRIMARY KEY) STRICT;\n');
      assert.deepEqual(applyMigrations(c.db, loadMigrations(c.dir)).applied, [nextMigrationFile('next')]);
    } finally {
      c.cleanup();
    }
  });

  test('a migration that tries to COMMIT itself is denied and rolled back', () => {
    const c = failingCase('CREATE TABLE half_done (id INTEGER PRIMARY KEY) STRICT;\nCOMMIT;\nCREATE TABLE after_commit (id INTEGER) STRICT;\n');
    try {
      assert.throws(() => applyMigrations(c.db, loadMigrations(c.dir)), MigrationFailedError);
      assertStillAtLatest(c.db);
    } finally {
      c.cleanup();
    }
  });

  test('a migration that ATTACHes another database is denied', () => {
    const c = failingCase(`ATTACH DATABASE '${path.join(tempDir(), 'x.db')}' AS other;\n`);
    try {
      assert.throws(() => applyMigrations(c.db, loadMigrations(c.dir)), MigrationFailedError);
      assertStillAtLatest(c.db);
    } finally {
      c.cleanup();
    }
  });

  test('a migration that leaves foreign-key violations is rolled back', () => {
    const c = failingCase(
      "PRAGMA defer_foreign_keys = ON;\nCREATE TABLE half_done (id INTEGER PRIMARY KEY) STRICT;\n" +
        "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, auth_at, password_changed_at) " +
        "VALUES ('" + 'a'.repeat(64) + "', '00000000-0000-4000-8000-000000000000', 1, 1, 2, 1, 1);\n",
    );
    try {
      const err = (() => {
        try {
          applyMigrations(c.db, loadMigrations(c.dir));
        } catch (e) {
          return e;
        }
      })();
      assert.ok(err instanceof MigrationFailedError, String(err));
      assert.match(err.message, /foreign-key/);
      assertStillAtLatest(c.db);
      assert.equal(scalar(c.db, 'SELECT count(*) FROM sessions'), 0);
    } finally {
      c.cleanup();
    }
  });
});
