import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { assertLocalFilesystem, networkFilesystemName, openDatabase } from '../../src/server/database/connection.ts';
import { DatabaseError } from '../../src/server/database/errors.ts';
import { acquireInstanceLock } from '../../src/server/database/instance-lock.ts';
import { createReadinessProbe } from '../../src/server/database/readiness.ts';
import { createTestDatabase, insertProduct, LATEST_VERSION, tempDir } from '../helpers/database.ts';

const mode = (p: string) => statSync(p).mode & 0o777;
const pragma = (db: { prepare(s: string): { get(): unknown } }, name: string) => Object.values(db.prepare(`PRAGMA ${name}`).get() as object)[0];

function dbErrorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof DatabaseError, String(err));
    return err.code;
  }
  assert.fail('expected DatabaseError');
}

describe('connection settings', () => {
  test('WAL, foreign keys, FULL sync, busy timeout, trusted_schema off', () => {
    const t = createTestDatabase();
    try {
      assert.equal(pragma(t.db, 'journal_mode'), 'wal');
      assert.equal(pragma(t.db, 'foreign_keys'), 1);
      assert.equal(pragma(t.db, 'synchronous'), 2);
      assert.equal(pragma(t.db, 'busy_timeout'), 5000);
      assert.equal(pragma(t.db, 'trusted_schema'), 0);
    } finally {
      t.cleanup();
    }
  });

  test('data directory 0700; database, WAL and SHM files 0600 even with a permissive umask', () => {
    const previous = process.umask(0o022);
    const t = createTestDatabase();
    try {
      insertProduct(t.db); // forces WAL/SHM creation
      assert.equal(mode(path.dirname(t.file)), 0o700);
      for (const f of [t.file, `${t.file}-wal`, `${t.file}-shm`]) {
        assert.ok(existsSync(f), f);
        assert.equal(mode(f), 0o600, path.basename(f));
      }
    } finally {
      process.umask(previous);
      t.cleanup();
    }
  });

  test('an existing, too-open data directory is tightened', () => {
    const dir = path.join(tempDir(), 'data');
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    const db = openDatabase(path.join(dir, 'alkhayr.db'), { mustExist: false });
    db.close();
    assert.equal(mode(dir), 0o700);
  });

  test('mustExist never creates a database; a stale WAL without its database is refused', () => {
    const dir = path.join(tempDir(), 'data');
    const file = path.join(dir, 'alkhayr.db');
    mkdirSync(dir, { mode: 0o700 });
    assert.equal(dbErrorCode(() => openDatabase(file, { mustExist: true })), 'DATABASE_MISSING');
    assert.equal(existsSync(file), false);
    writeFileSync(`${file}-wal`, 'stale');
    assert.equal(dbErrorCode(() => openDatabase(file, { mustExist: false })), 'STALE_WAL');
    assert.equal(existsSync(file), false);
  });

  test('network filesystems are recognized and refused; local disks pass', () => {
    assert.equal(networkFilesystemName(0x6969), 'nfs');
    assert.equal(networkFilesystemName(0xff534d42), 'cifs');
    assert.equal(networkFilesystemName(0xfe534d42), 'smb2');
    assert.equal(networkFilesystemName(0xef53), null); // ext4
    assert.equal(networkFilesystemName(0x794c7630), null); // overlayfs (containers)
    assert.doesNotThrow(() => assertLocalFilesystem(tempDir()));
  });
});

describe('runtime authorizer: HTTP-path connections cannot change schema', () => {
  test('DDL, ATTACH, SAVEPOINT and PRAGMA writes are denied; DML and reads work', () => {
    const t = createTestDatabase();
    t.db.close();
    const db = openDatabase(t.file, { mustExist: true, runtime: true });
    try {
      for (const sql of [
        'CREATE TABLE evil (x INTEGER)',
        'CREATE TEMP TABLE evil (x INTEGER)',
        'DROP TABLE rate_limits',
        'ALTER TABLE products ADD COLUMN evil TEXT',
        'CREATE INDEX evil_idx ON products (name)',
        'DROP TRIGGER orders_no_delete',
        'CREATE VIEW evil AS SELECT 1',
        `ATTACH DATABASE '${path.join(tempDir(), 'x.db')}' AS other`,
        'SAVEPOINT sp1',
        'VACUUM',
        `VACUUM INTO '${path.join(tempDir(), 'exfiltrated.db')}'`,
        'PRAGMA foreign_keys = OFF',
        'PRAGMA journal_mode = DELETE',
        'PRAGMA writable_schema = ON',
        'PRAGMA user_version = 99',
        'PRAGMA table_info(products)',
      ]) {
        assert.throws(() => db.exec(sql), /not authorized|authorization denied/, sql);
      }
      assert.equal(pragma(db, 'foreign_keys'), 1);
      assert.equal(pragma(db, 'journal_mode'), 'wal');
      assert.equal(pragma(db, 'user_version'), LATEST_VERSION);
      const id = insertProduct(db);
      assert.equal((db.prepare('SELECT name FROM products WHERE id = ?').get(id) as { name: string }).name, 'شيكولاتة بالبندق');
      db.exec('BEGIN IMMEDIATE');
      db.exec('ROLLBACK');
    } finally {
      db.close();
      t.cleanup();
    }
  });
});

describe('single-instance lock', () => {
  test('a second holder is refused until the first releases', () => {
    const dir = path.join(tempDir(), 'data');
    const first = acquireInstanceLock(dir, 'test A');
    assert.equal(dbErrorCode(() => acquireInstanceLock(dir, 'test B')), 'INSTANCE_LOCKED');
    first.release();
    first.release(); // idempotent
    const second = acquireInstanceLock(dir, 'test C');
    second.release();
  });
});

describe('readiness probe', () => {
  test('ready while the configured file is open at the expected version', () => {
    const t = createTestDatabase();
    try {
      assert.equal(createReadinessProbe(t.db, t.file, LATEST_VERSION)(), true);
      assert.equal(createReadinessProbe(t.db, t.file, LATEST_VERSION + 1)(), false);
    } finally {
      t.cleanup();
    }
  });

  test('not ready when the file is moved away or replaced, ready again when restored', () => {
    const t = createTestDatabase();
    try {
      const probe = createReadinessProbe(t.db, t.file, LATEST_VERSION);
      renameSync(t.file, `${t.file}.moved`);
      assert.equal(probe(), false);
      writeFileSync(t.file, 'not the same file');
      assert.equal(probe(), false);
      renameSync(`${t.file}.moved`, t.file);
      assert.equal(probe(), true);
    } finally {
      t.cleanup();
    }
  });

  test('not ready (and no throw) when the connection is closed', () => {
    const t = createTestDatabase();
    const probe = createReadinessProbe(t.db, t.file, LATEST_VERSION);
    t.db.close();
    assert.equal(probe(), false);
    t.cleanup();
  });
});
