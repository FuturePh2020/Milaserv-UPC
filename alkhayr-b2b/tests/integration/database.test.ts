import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import { baseEnv, CANARY, createTempApp, rawRequest, runCli, runUntilExit, startServer, type TempApp } from '../helpers/server.ts';
import { LATEST_VERSION, nextMigrationFile } from '../helpers/database.ts';

const L = LATEST_VERSION;
const NEXT_FILE = nextMigrationFile('add_note_index');

const scalar = (file: string, sql: string) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Object.values(db.prepare(sql).get() as object)[0];
  } finally {
    db.close();
  }
};

function startupFailure(r: { code: number | null; stderr: string }): { code: string; message: string } {
  assert.equal(r.code, 1, r.stderr);
  const line = r.stderr.split('\n').find((l) => l.includes('"startup_failed"'));
  assert.ok(line, `no startup_failed line in: ${r.stderr}`);
  return JSON.parse(line) as { code: string; message: string };
}

async function withApp(fn: (app: TempApp) => Promise<void>, options: { initDb?: boolean } = {}) {
  const app = await createTempApp(options);
  try {
    await fn(app);
  } finally {
    await app.cleanup();
  }
}

describe('clean release initialization (no Git, no node_modules)', () => {
  test('status -> init -> status -> server ready, using only dist/ and migrations/', () =>
    withApp(
      async (app) => {
        const top = readdirSync(app.root).sort();
        assert.ok(!top.includes('node_modules') && !top.includes('.git'), top.join(','));

        const before = await runCli(app, ['db:status']);
        assert.equal(before.code, 0);
        assert.equal(JSON.parse(before.stdout).initialized, false);
        assert.equal(existsSync(app.databasePath), false, 'db:status must not create a database');

        const init = await runCli(app, ['db:init']);
        assert.equal(init.code, 0, init.stderr);
        assert.match(init.stdout, new RegExp(`initialized at schema version ${L} `));
        assert.equal(statSync(path.dirname(app.databasePath)).mode & 0o777, 0o700);
        assert.equal(statSync(app.databasePath).mode & 0o777, 0o600);

        const status = await runCli(app, ['db:status']);
        assert.deepEqual(JSON.parse(status.stdout), { initialized: true, schemaVersion: L, latestVersion: L, pending: [], integrity: 'ok', journalMode: 'wal' });

        const s = await startServer(app);
        try {
          const ready = await rawRequest(s.port, { path: '/readyz' });
          assert.equal(ready.status, 200);
          assert.deepEqual(JSON.parse(ready.body), { status: 'ready' });
          assert.equal(ready.headers['cache-control'], 'no-store');
        } finally {
          assert.equal(await s.stop(), 0);
        }
      },
      { initDb: false },
    ));

  test('db:init refuses an existing database and changes nothing; db:migrate on a current database is a no-op', () =>
    withApp(async (app) => {
      const settingsBefore = scalar(app.databasePath, 'SELECT company_name || version FROM business_settings');
      const again = await runCli(app, ['db:init']);
      assert.equal(again.code, 1);
      assert.match(again.stderr, new RegExp(`Refusing to initialize: a database with schema version ${L} already exists\\. Nothing was changed\\.`));
      const migrate = await runCli(app, ['db:migrate']);
      assert.equal(migrate.code, 0);
      assert.match(migrate.stdout, new RegExp(`up to date at schema version ${L}\\.`));
      assert.equal(scalar(app.databasePath, 'SELECT company_name || version FROM business_settings'), settingsBefore);
      assert.equal(scalar(app.databasePath, 'SELECT count(*) FROM schema_migrations'), L);
    }));

  test('unknown commands print usage with exit code 2', () =>
    withApp(async (app) => {
      const r = await runCli(app, ['db:drop']);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /Usage:/);
    }));
});

describe('server startup refuses unsafe database states with operator instructions', () => {
  test('missing database (development and production)', () =>
    withApp(
      async (app) => {
        const dev = startupFailure(await runUntilExit(app, baseEnv()));
        assert.equal(dev.code, 'DATABASE_MISSING');
        assert.match(dev.message, /db:init/);
        assert.equal(existsSync(app.databasePath), false, 'startup must not create a database');
        const secret = () => randomBytes(32).toString('base64url');
        const prod = startupFailure(
          await runUntilExit(app, baseEnv({ NODE_ENV: 'production', APP_ORIGIN: 'https://alkhayr.test', APP_SECRET: secret(), BACKUP_KEY: secret() })),
        );
        assert.equal(prod.code, 'DATABASE_MISSING');
        assert.match(prod.message, /node dist\/server\/cli\.js db:init/);
      },
      { initDb: false },
    ));

  test('pending migrations: server refuses; db:migrate requires --confirm-backup; then server starts with data intact', () =>
    withApp(async (app) => {
      writeFileSync(path.join(app.migrationsDir, NEXT_FILE), 'CREATE INDEX merchants_contact_idx ON merchants (contact_name);\n');
      const refused = startupFailure(await runUntilExit(app, baseEnv()));
      assert.equal(refused.code, 'MIGRATIONS_PENDING');
      assert.match(refused.message, new RegExp(`version ${L} but this release requires version ${L + 1}`));
      assert.match(refused.message, /db:migrate -- --confirm-backup/);

      const noFlag = await runCli(app, ['db:migrate']);
      assert.equal(noFlag.code, 1);
      assert.ok(noFlag.stderr.includes(NEXT_FILE));
      assert.match(noFlag.stderr, /--confirm-backup/);
      assert.equal(scalar(app.databasePath, 'PRAGMA user_version'), L);

      const migrated = await runCli(app, ['db:migrate', '--confirm-backup']);
      assert.equal(migrated.code, 0, migrated.stderr);
      assert.match(migrated.stdout, new RegExp(`Migrated schema version ${L} -> ${L + 1}`));
      assert.equal(scalar(app.databasePath, 'SELECT company_name FROM business_settings'), CANARY);

      const s = await startServer(app);
      try {
        assert.equal((await rawRequest(s.port, { path: '/readyz' })).status, 200);
      } finally {
        await s.stop();
      }
    }));

  test('tampered applied migration: server and db:status refuse', () =>
    withApp(async (app) => {
      appendFileSync(path.join(app.migrationsDir, '0001_initial.sql'), '\n-- edited after being applied\n');
      const r = startupFailure(await runUntilExit(app, baseEnv()));
      assert.equal(r.code, 'MIGRATION_CHECKSUM_MISMATCH');
      const status = await runCli(app, ['db:status']);
      assert.equal(status.code, 1);
      assert.match(status.stderr, /MIGRATION_CHECKSUM_MISMATCH/);
    }));

  test('database newer than the release: server refuses', () =>
    withApp(async (app) => {
      const db = new DatabaseSync(app.databasePath);
      db.exec('PRAGMA user_version = 5');
      db.close();
      const r = startupFailure(await runUntilExit(app, baseEnv()));
      assert.equal(r.code, 'SCHEMA_TOO_NEW');
      assert.match(r.message, /do not downgrade/);
    }));

  test('a non-ALKHAYR SQLite file in the data directory is refused and left untouched', () =>
    withApp(
      async (app) => {
        const { mkdirSync } = await import('node:fs');
        mkdirSync(path.dirname(app.databasePath), { recursive: true, mode: 0o700 });
        const foreign = new DatabaseSync(app.databasePath);
        foreign.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO customers (name) VALUES (\'keep me\');');
        foreign.close();
        const r = startupFailure(await runUntilExit(app, baseEnv()));
        assert.equal(r.code, 'NO_MIGRATION_HISTORY');
        const init = await runCli(app, ['db:init']);
        assert.equal(init.code, 1);
        assert.match(init.stderr, /NO_MIGRATION_HISTORY/);
        assert.equal(scalar(app.databasePath, 'SELECT name FROM customers'), 'keep me');
      },
      { initDb: false },
    ));
});

describe('running server', () => {
  test('one instance per data directory; schema maintenance refused while running; status still readable', () =>
    withApp(async (app) => {
      const s = await startServer(app);
      try {
        const second = startupFailure(await runUntilExit(app, baseEnv()));
        assert.equal(second.code, 'INSTANCE_LOCKED');
        const migrate = await runCli(app, ['db:migrate', '--confirm-backup']);
        assert.equal(migrate.code, 1);
        assert.match(migrate.stderr, /INSTANCE_LOCKED/);
        const status = await runCli(app, ['db:status']);
        assert.equal(status.code, 0);
        assert.equal((await rawRequest(s.port, { path: '/readyz' })).status, 200);
      } finally {
        await s.stop();
      }
      // Lock is released on shutdown.
      const again = await startServer(app);
      await again.stop();
    }));

  test('readiness fails (503, generic body) when the database file disappears and recovers when restored; liveness unaffected', () =>
    withApp(async (app) => {
      const s = await startServer(app);
      try {
        renameSync(app.databasePath, `${app.databasePath}.moved`);
        const down = await rawRequest(s.port, { path: '/readyz' });
        assert.equal(down.status, 503);
        const body = JSON.parse(down.body) as { error: { code: string; message: string } };
        assert.equal(body.error.code, 'NOT_READY');
        assert.equal(down.headers['retry-after'], '5');
        for (const leak of ['alkhayr.db', app.root, 'schema_migrations', 'SELECT', 'sqlite', 'DATA_DIR']) {
          assert.ok(!down.body.includes(leak), `readiness body leaks ${leak}`);
        }
        assert.equal((await rawRequest(s.port, { path: '/healthz' })).status, 200);
        renameSync(`${app.databasePath}.moved`, app.databasePath);
        assert.equal((await rawRequest(s.port, { path: '/readyz' })).status, 200);
      } finally {
        await s.stop();
      }
    }));

  test('serving requests never alters the schema, and restarts never reset data', () =>
    withApp(async (app) => {
      const schemaSql = "SELECT group_concat(type || ':' || name, ',') FROM (SELECT type, name FROM sqlite_schema ORDER BY type, name)";
      const before = scalar(app.databasePath, schemaSql);
      for (let i = 0; i < 2; i++) {
        const s = await startServer(app);
        for (const p of ['/', '/healthz', '/readyz', '/api/v1/orders', '/api/v1/products?sort=name%3BDROP%20TABLE%20products']) {
          await rawRequest(s.port, { path: p });
        }
        await s.stop();
      }
      assert.equal(scalar(app.databasePath, schemaSql), before);
      assert.equal(scalar(app.databasePath, 'SELECT company_name FROM business_settings'), CANARY);
      assert.equal(scalar(app.databasePath, 'SELECT count(*) FROM schema_migrations'), L);
    }));

  test('the database really contains the canary that the HTTP exposure tests must never return', () =>
    withApp(async (app) => {
      const s = await startServer(app);
      try {
        const files = [app.databasePath, `${app.databasePath}-wal`].filter(existsSync);
        assert.ok(files.some((f) => readFileSync(f).includes(CANARY)), 'canary not found in database files');
        for (const p of ['/data/alkhayr.db', '/data/alkhayr.db-wal', '/alkhayr.db', '/data/alkhayr.db-shm']) {
          const res = await rawRequest(s.port, { path: p });
          assert.equal(res.status, 404);
          assert.ok(!res.body.includes(CANARY));
        }
      } finally {
        await s.stop();
      }
    }));
});
