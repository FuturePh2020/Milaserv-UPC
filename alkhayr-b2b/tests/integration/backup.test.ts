import assert from 'node:assert/strict';
import { createCipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { appSecretId, keyId, MAGIC, readHeader } from '../../src/server/backup/backup.ts';
import { runCli } from '../../src/server/cli/index.ts';
import type { AppConfig } from '../../src/server/config.ts';
import { APPLICATION_ID } from '../../src/server/database/connection.ts';
import { acquireInstanceLock } from '../../src/server/database/instance-lock.ts';
import { Client, createAdmin, createTrader, startTestApp, type TestApp } from '../helpers/app.ts';
import { fixtureTransition, insertOrder, insertProduct, MIGRATIONS_DIR, tempDir } from '../helpers/database.ts';
import { codeFromOutput, scriptedPrompter, type Answer } from '../helpers/prompter.ts';
import { assertAdministratorMfaReadable, SecurityConfigError } from '../../src/server/auth/mfa-key-check.ts';

// Stage 15: encrypted backups, verification, restore, rotation. Disposable databases and directories only.

let ipSeq = 0;
const ip = () => `100.93.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

async function withApp(fn: (app: TestApp, work: string) => Promise<void>) {
  const app = await startTestApp();
  const work = tempDir('alkhayr-bk-');
  try {
    await fn(app, work);
  } finally {
    await app.close();
  }
}

/** CLI against the app's data directory (or another one) with a separate backup directory. */
async function cli(config: AppConfig, args: string[], answers: Answer[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(args, {
    config,
    migrationsDir: MIGRATIONS_DIR,
    io: { out: (l) => void out.push(l), err: (l) => void err.push(l) },
    createPrompter: () => scriptedPrompter([...answers]),
  });
  return { code, out: out.join('\n'), err: err.join('\n'), all: [...out, ...err].join('\n') };
}
const configFor = (app: TestApp, work: string, dataDir = app.config.dataDir, appSecret: Buffer | null = app.config.appSecret): AppConfig =>
  ({ ...app.config, dataDir, databasePath: path.join(dataDir, 'alkhayr.db'), backupDir: path.join(work, 'backups'), appSecret }) as AppConfig;

async function keyFile(config: AppConfig, work: string, name = 'backup.key') {
  const file = path.join(work, 'keys', name);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const r = await cli(config, ['backup:keygen', '--out', file]);
  assert.equal(r.code, 0, r.all);
  return file;
}

/** Business data with a REAL administrator (MFA secret encrypted with the app's APP_SECRET). */
async function seed(app: TestApp) {
  const db = app.fixtureDb;
  const admin = await createAdmin(app);
  const p = insertProduct(db, { onHand: 50 });
  const t = createTraderSync(app);
  const o = insertOrder(db, { userId: t.userId, merchantId: t.merchantId, finalize: true, items: [{ productId: p, cartons: 4, unitPrice: 12550 }] });
  fixtureTransition(db, o, 'confirmed', { actorId: admin.id });
  return { product: p, order: o, admin };
}

/**
 * TEST-ONLY corruption of an offline COPY: the table's guarding triggers are dropped, the change is
 * made, and the triggers are recreated with their identical SQL (so the schema still matches).
 */
function tamperBypassingTriggers(file: string, table: string, sql: string): void {
  const d = new DatabaseSync(file);
  const trigs = d.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ?").all(table) as Array<{ name: string; sql: string }>;
  for (const t of trigs) d.exec(`DROP TRIGGER "${t.name}"`);
  d.exec(sql);
  for (const t of trigs) d.exec(t.sql);
  d.close();
}

/** The live database as one self-contained file (WAL folded in). */
function dbBytes(app: TestApp, work: string, name: string): string {
  const f = path.join(work, name);
  cpSync(app.config.databasePath, f);
  if (existsSync(`${app.config.databasePath}-wal`)) cpSync(`${app.config.databasePath}-wal`, `${f}-wal`);
  const c = new DatabaseSync(f);
  c.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  c.exec('PRAGMA journal_mode = DELETE');
  c.close();
  return f;
}
function createTraderSync(app: TestApp) {
  const userId = randomUUID();
  const merchantId = randomUUID();
  const t = Date.now();
  app.fixtureDb.prepare("INSERT INTO auth_users (id, username, password_hash, password_changed_at, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'trader', ?, ?)").run(userId, `seed.${userId.slice(0, 6)}`, 'x'.repeat(40), t, t, t);
  app.fixtureDb.prepare("INSERT INTO merchants (id, user_id, business_name, contact_name, phone, governorate, address, status, version, created_at, updated_at) VALUES (?, ?, 'متجر', 'مسؤول', '01012345678', 'القاهرة', '1 شارع', 'approved', 1, ?, ?)").run(merchantId, userId, t, t);
  return { userId, merchantId };
}
const backups = (config: AppConfig) => (existsSync(config.backupDir) ? readdirSync(config.backupDir).filter((n) => n.endsWith('.akbk')).sort() : []);
const mode = (f: string) => statSync(f).mode & 0o777;

describe('backup keys', () => {
  test('keygen writes a new 0600 key file, prints only its id, never overwrites, refuses data/backup directories', () =>
    withApp(async (app, work) => {
      const config = configFor(app, work);
      const file = path.join(work, 'k1.key');
      const r = await cli(config, ['backup:keygen', '--out', file]);
      assert.equal(r.code, 0, r.all);
      assert.equal(mode(file), 0o600);
      const key = readFileSync(file, 'utf8').trim();
      assert.ok(!r.all.includes(key), 'the key is never printed');
      assert.match(r.out, new RegExp(keyId(Buffer.from(key, 'base64url'))));
      assert.equal((await cli(config, ['backup:keygen', '--out', file])).code, 1, 'never overwrites');
      assert.equal(readFileSync(file, 'utf8').trim(), key);
      mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
      for (const dir of [config.dataDir, config.backupDir]) assert.match((await cli(config, ['backup:keygen', '--out', path.join(dir, 'x.key')])).err, /KEY_FILE_LOCATION/);
      for (const bad of [['backup:create', '--key', key], ['backup:create', '--key-file=x'], ['backup:create', '--passphrase', 'x']]) assert.equal((await cli(config, bad)).code, 2, bad.join(' '));
    }));

  test('key files must be private regular files of this user; no symlinks', () =>
    withApp(async (app, work) => {
      const config = configFor(app, work);
      const file = await keyFile(config, work);
      chmodSync(file, 0o644);
      assert.match((await cli(config, ['backup:create', '--key-file', file])).err, /KEY_FILE_INSECURE/);
      chmodSync(file, 0o600);
      const link = path.join(work, 'keys', 'link.key');
      symlinkSync(file, link);
      assert.match((await cli(config, ['backup:create', '--key-file', link])).err, /KEY_FILE_INSECURE.*symbolic links are refused/);
      // A private key file stored next to the data it protects is refused.
      const inData = path.join(config.dataDir, 'copied.key');
      cpSync(file, inData);
      chmodSync(inData, 0o600);
      assert.match((await cli(config, ['backup:create', '--key-file', inData])).err, /KEY_FILE_LOCATION/);
      assert.match((await cli(config, ['backup:create', '--key-file', path.join(work, 'missing.key')])).err, /KEY_FILE_MISSING/);
      assert.deepEqual(backups(config), []);
    }));
});

describe('create, inspect, verify', () => {
  test('backup is encrypted, private, verified, marked; header carries key and secret ids; no secrets printed', () =>
    withApp(async (app, work) => {
      await seed(app);
      const config = configFor(app, work);
      const kf = await keyFile(config, work);
      const r = await cli(config, ['backup:create', '--key-file', kf]);
      assert.equal(r.code, 0, r.all);
      const [name] = backups(config);
      assert.match(name!, /^alkhayr-\d{8}-\d{6}-[0-9a-f]{8}\.akbk$/);
      const file = path.join(config.backupDir, name!);
      assert.equal(mode(file), 0o600);
      assert.equal(mode(config.backupDir), 0o700);
      assert.ok(existsSync(`${file}.verified`));
      const bytes = readFileSync(file);
      assert.ok(bytes.subarray(0, 8).equals(MAGIC));
      assert.ok(!bytes.includes(Buffer.from('SQLite format 3')), 'no plaintext database inside');
      const key = Buffer.from(readFileSync(kf, 'utf8').trim(), 'base64url');
      const h = readHeader(file).header;
      assert.equal(h.keyId, keyId(key));
      assert.equal(h.appSecretId, appSecretId(app.config.appSecret!));
      assert.ok(!r.all.includes(readFileSync(kf, 'utf8').trim()) && !r.all.includes(app.config.appSecret!.toString('base64url')));
      const inspect = await cli(config, ['backup:inspect', file]);
      assert.match(inspect.out, /"configuredAppSecretMatches": true/);
      const v = await cli(config, ['backup:verify', file, '--key-file', kf]);
      assert.equal(v.code, 0, v.all);
      assert.match(v.out, /stock_ledger_allocation_import_invariants/);
      assert.match(v.out, /"mfa": "readable"/);
      assert.deepEqual(readdirSync(config.dataDir).filter((n) => n.startsWith('.staging-')), [], 'no plaintext staging left behind');
    }));

  test('interactive key entry (hidden prompt) works; no TTY key and no file -> refused', () =>
    withApp(async (app, work) => {
      const config = configFor(app, work);
      const kf = await keyFile(config, work);
      const key = readFileSync(kf, 'utf8').trim();
      const r = await cli(config, ['backup:create'], [key]);
      assert.equal(r.code, 0, r.all);
      assert.equal((await cli(config, ['backup:verify', path.join(config.backupDir, backups(config)[0]!)], ['not-a-key'])).code, 1);
    }));

  test('wrong key, tampered ciphertext/header, truncation, unknown format/version, oversized header, wrong APP_SECRET are refused', () =>
    withApp(async (app, work) => {
      await seed(app);
      const config = configFor(app, work);
      const kf = await keyFile(config, work);
      assert.equal((await cli(config, ['backup:create', '--key-file', kf])).code, 0);
      const file = path.join(config.backupDir, backups(config)[0]!);
      const other = await keyFile(config, work, 'other.key');
      assert.match((await cli(config, ['backup:verify', file, '--key-file', other])).err, /KEY_MISMATCH/);
      const variant = (name: string, mutate: (b: Buffer) => Buffer) => {
        const f = path.join(work, name);
        writeFileSync(f, mutate(Buffer.from(readFileSync(file))), { mode: 0o600 });
        return f;
      };
      const h = readHeader(file);
      const flipCipher = variant('flip.akbk', (b) => {
        b[h.ciphertextOffset + 100]! ^= 0x01;
        return b;
      });
      assert.match((await cli(config, ['backup:verify', flipCipher, '--key-file', kf])).err, /AUTH_FAILED/);
      const flipHeader = variant('hdr.akbk', (b) => {
        const s = b.toString('latin1');
        const i = s.indexOf('"createdAt":') + '"createdAt":'.length;
        b[i] = b[i] === 0x31 ? 0x32 : 0x31; // same length, different authenticated metadata
        return b;
      });
      assert.match((await cli(config, ['backup:verify', flipHeader, '--key-file', kf])).err, /AUTH_FAILED/);
      assert.match((await cli(config, ['backup:verify', variant('trunc.akbk', (b) => b.subarray(0, b.length - 10)), '--key-file', kf])).err, /TRUNCATED/);
      assert.match((await cli(config, ['backup:verify', variant('ext.akbk', (b) => Buffer.concat([b, Buffer.from('x')])), '--key-file', kf])).err, /TRUNCATED/);
      assert.match((await cli(config, ['backup:verify', variant('zip.akbk', () => Buffer.from('PK\u0003\u0004 not a backup at all')), '--key-file', kf])).err, /NOT_A_BACKUP/);
      assert.match((await cli(config, ['backup:verify', variant('v2.akbk', (b) => Buffer.concat([Buffer.from('AKHRBKP2'), b.subarray(8)])), '--key-file', kf])).err, /VERSION_UNSUPPORTED/);
      const big = Buffer.alloc(20);
      MAGIC.copy(big);
      big.writeUInt32BE(1_000_000, 8);
      assert.match((await cli(config, ['backup:verify', variant('big.akbk', () => Buffer.concat([big, Buffer.alloc(100)])), '--key-file', kf])).err, /HEADER_INVALID/);
      // Header-level APP_SECRET id check, before anything is decrypted (fresh target directory).
      const wrongSecret = configFor(app, work, path.join(work, 'fresh-target'), randomBytes(32));
      assert.match((await cli(wrongSecret, ['backup:restore', file, '--key-file', kf])).err, /APP_SECRET_MISMATCH.*belongs to a different APP_SECRET/);
      assert.ok(!existsSync(wrongSecret.databasePath));
      for (const r of [await cli(config, ['backup:verify', flipCipher, '--key-file', kf])]) assert.ok(!r.all.includes(readFileSync(kf, 'utf8').trim()));
    }));

  test('a backup whose administrator MFA cannot be decrypted with the configured APP_SECRET fails verification', () =>
    withApp(async (app, work) => {
      await createAdmin(app);
      const config = configFor(app, work);
      const kf = await keyFile(config, work);
      assert.equal((await cli(config, ['backup:create', '--key-file', kf])).code, 0);
      const file = path.join(config.backupDir, backups(config)[0]!);
      const wrong = configFor(app, work, app.config.dataDir, randomBytes(32));
      assert.match((await cli(wrong, ['backup:verify', file, '--key-file', kf])).err, /APP_SECRET_MISMATCH/);
    }));

  test('a corrupt or incompatible database inside a validly encrypted container is refused', () =>
    withApp(async (app, work) => {
      const config = configFor(app, work);
      const kf = await keyFile(config, work);
      const key = Buffer.from(readFileSync(kf, 'utf8').trim(), 'base64url');
      // TEST-ONLY: encrypt arbitrary database bytes in the documented v1 container.
      const craft = (name: string, plaintext: Buffer, override: Record<string, unknown> = {}) => {
        const backupId = randomUUID();
        const header = {
          format: 'alkhayr-backup', formatVersion: 1, backupId, createdAt: Date.now(), cipher: 'aes-256-gcm', kdf: 'hkdf-sha256',
          salt: randomBytes(32).toString('base64url'), nonce: randomBytes(12).toString('base64url'), keyId: keyId(key), appSecretId: appSecretId(app.config.appSecret!),
          applicationId: APPLICATION_ID, schemaVersion: 7, migrations: [], plaintextBytes: plaintext.length, plaintextSha256: createHash('sha256').update(plaintext).digest('hex'),
          ...override,
        };
        const hb = Buffer.from(JSON.stringify(header));
        const prefix = Buffer.alloc(12);
        MAGIC.copy(prefix);
        prefix.writeUInt32BE(hb.length, 8);
        const k = Buffer.from(hkdfSync('sha256', key, Buffer.from(header.salt, 'base64url'), `alkhayr:backup:v1:${backupId}`, 32));
        const c = createCipheriv('aes-256-gcm', k, Buffer.from(header.nonce, 'base64url'));
        c.setAAD(Buffer.concat([prefix, hb]));
        const f = path.join(work, name);
        writeFileSync(f, Buffer.concat([prefix, hb, c.update(plaintext), c.final(), c.getAuthTag()]), { mode: 0o600 });
        return f;
      };
      await seed(app);
      const good = readFileSync(dbBytes(app, work, 'good.db'));
      assert.ok(good.length > 16384);
      const corrupt = Buffer.from(good);
      corrupt.fill(0x41, 8192, 12288); // damage a b-tree page
      assert.match((await cli(config, ['backup:verify', craft('corrupt.akbk', corrupt), '--key-file', kf])).err, /DB_CORRUPT|DB_UNREADABLE/);
      // Changed migration checksum (incompatible history).
      const copy = dbBytes(app, work, 'copy.db');
      tamperBypassingTriggers(copy, 'schema_migrations', "UPDATE schema_migrations SET checksum = '" + '0'.repeat(64) + "' WHERE version = 1");
      const r = await cli(config, ['backup:verify', craft('schema.akbk', readFileSync(copy)), '--key-file', kf]);
      assert.match(r.err, /SCHEMA_INCOMPATIBLE/);
      // Broken application invariant: stock not matching its ledger.
      const inv = dbBytes(app, work, 'inv.db');
      tamperBypassingTriggers(inv, 'products', 'UPDATE products SET on_hand = on_hand + 7');
      assert.match((await cli(config, ['backup:verify', craft('inv.akbk', readFileSync(inv)), '--key-file', kf])).err, /INVARIANT_FAILED/);
      // Authenticated, but the recorded plaintext digest does not match (defence in depth behind GCM).
      const okDb = readFileSync(dbBytes(app, work, 'ok.db'));
      assert.match((await cli(config, ['backup:verify', craft('hash.akbk', okDb, { plaintextSha256: '0'.repeat(64) }), '--key-file', kf])).err, /AUTH_FAILED/);
      // Made by a newer release (higher schema version): restore refuses before decrypting anything.
      const target = configFor(app, work, path.join(work, 'newer-target'));
      const newer = await cli(target, ['backup:restore', craft('newer.akbk', okDb, { schemaVersion: 8 }), '--key-file', kf]);
      assert.match(newer.err, /SCHEMA_TOO_NEW/);
      assert.ok(!existsSync(target.databasePath));
    }));
});

describe('restore', () => {
  test('restore into a NEW data directory: verified, sessions removed, audit recorded, data and idempotency retained', () =>
    withApp(async (app, work) => {
      const { order } = await seed(app);
      const t = await createTrader(app);
      const c = new Client(app, ip());
      assert.equal((await c.login(t.username, t.password)).status, 200);
      const sessionsBefore = Number((app.fixtureDb.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }).n);
      assert.ok(sessionsBefore >= 1);
      const config = configFor(app, work);
      const kf = await keyFile(config, work);
      assert.equal((await cli(config, ['backup:create', '--key-file', kf])).code, 0);
      const file = path.join(config.backupDir, backups(config)[0]!);
      const target = configFor(app, work, path.join(work, 'restored'));
      const r = await cli(target, ['backup:restore', file, '--key-file', kf]);
      assert.equal(r.code, 0, r.all);
      assert.match(r.out, /OLDER point in time/);
      assert.equal(mode(target.databasePath), 0o600);
      const db = new DatabaseSync(target.databasePath, { readOnly: true });
      try {
        assert.equal(Number((db.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }).n), 0, 'restored sessions removed');
        assert.equal((db.prepare('SELECT state FROM orders WHERE id = ?').get(order) as { state: string }).state, 'confirmed');
        const a = db.prepare("SELECT actor_user_id, metadata FROM audit_logs WHERE action = 'backup.restored'").get() as { actor_user_id: string | null; metadata: string };
        assert.equal(a.actor_user_id, null, 'operator/system action, no fabricated administrator');
        assert.equal(JSON.parse(a.metadata).sessions_removed, sessionsBefore);
        const src = new DatabaseSync(app.config.databasePath, { readOnly: true });
        for (const tbl of ['orders', 'order_items', 'inventory_ledger', 'order_allocations', 'products', 'auth_users']) {
          assert.equal((db.prepare(`SELECT count(*) AS n FROM ${tbl}`).get() as { n: number }).n, (src.prepare(`SELECT count(*) AS n FROM ${tbl}`).get() as { n: number }).n, tbl);
        }
        assert.deepEqual(db.prepare('SELECT request_key, request_digest FROM orders').all(), src.prepare('SELECT request_key, request_digest FROM orders').all(), 'order idempotency records retained');
        src.close();
      } finally {
        db.close();
      }
    }));

  test('refuses a running target, an existing target without --replace; --replace keeps the previous database aside', () =>
    withApp(async (app, work) => {
      await seed(app);
      const config = configFor(app, work);
      const kf = await keyFile(config, work);
      assert.equal((await cli(config, ['backup:create', '--key-file', kf])).code, 0);
      const file = path.join(config.backupDir, backups(config)[0]!);
      const target = configFor(app, work, path.join(work, 'live'));
      assert.equal((await cli(target, ['backup:restore', file, '--key-file', kf])).code, 0);
      const before = createHash('sha256').update(readFileSync(target.databasePath)).digest('hex');
      assert.match((await cli(target, ['backup:restore', file, '--key-file', kf])).err, /TARGET_EXISTS/);
      assert.equal(createHash('sha256').update(readFileSync(target.databasePath)).digest('hex'), before, 'unchanged');
      const lock = acquireInstanceLock(target.dataDir, 'test server');
      try {
        assert.match((await cli(target, ['backup:restore', file, '--key-file', kf, '--replace'])).err, /INSTANCE_LOCKED/);
      } finally {
        lock.release();
      }
      const r = await cli(target, ['backup:restore', file, '--key-file', kf, '--replace']);
      assert.equal(r.code, 0, r.all);
      const aside = readdirSync(target.dataDir).filter((n) => n.startsWith('pre-restore-'));
      assert.equal(aside.length, 1);
      assert.equal(createHash('sha256').update(readFileSync(path.join(target.dataDir, aside[0]!, 'alkhayr.db'))).digest('hex'), before, 'previous database kept intact');
    }));

  test('lost APP_SECRET (case E): restore only with explicit acceptance; MFA stays unreadable until each administrator is re-enrolled', () =>
    withApp(async (app, work) => {
      const { admin } = await seed(app);
      const config = configFor(app, work);
      const kf = await keyFile(config, work);
      assert.equal((await cli(config, ['backup:create', '--key-file', kf])).code, 0);
      const file = path.join(config.backupDir, backups(config)[0]!);
      const newSecret = randomBytes(32);
      const target = configFor(app, work, path.join(work, 'new-secret'), newSecret);
      assert.match((await cli(target, ['backup:restore', file, '--key-file', kf])).err, /APP_SECRET_MISMATCH/);
      assert.ok(!existsSync(target.databasePath), 'nothing restored without acceptance');
      const r = await cli(target, ['backup:restore', file, '--key-file', kf, '--accept-new-app-secret']);
      assert.equal(r.code, 0, r.all);
      assert.match(r.out, /server will refuse to start until every administrator is re-enrolled/);
      const ro = () => new DatabaseSync(target.databasePath, { readOnly: true });
      let db = ro();
      // Nothing was silently disabled, replaced or promoted: the old ciphertext is kept, roles unchanged.
      assert.throws(() => assertAdministratorMfaReadable(db, newSecret), SecurityConfigError);
      const roles = db.prepare('SELECT role, count(*) AS n FROM auth_users GROUP BY role ORDER BY role').all();
      db.close();
      const reset = await cli(target, ['account:reset-mfa'], [admin.username, admin.username, 'APP_SECRET lost; re-enrolling after restore', codeFromOutput(Date.now)]);
      assert.equal(reset.code, 0, reset.all);
      db = ro();
      assert.equal(assertAdministratorMfaReadable(db, newSecret).administrators, 1);
      assert.deepEqual(db.prepare('SELECT role, count(*) AS n FROM auth_users GROUP BY role ORDER BY role').all(), roles);
      db.close();
    }));

  test('a failed restore leaves the target untouched and no plaintext staging', () =>
    withApp(async (app, work) => {
      await seed(app);
      const config = configFor(app, work);
      const kf = await keyFile(config, work);
      assert.equal((await cli(config, ['backup:create', '--key-file', kf])).code, 0);
      const file = path.join(config.backupDir, backups(config)[0]!);
      const target = configFor(app, work, path.join(work, 'live2'));
      assert.equal((await cli(target, ['backup:restore', file, '--key-file', kf])).code, 0);
      const before = createHash('sha256').update(readFileSync(target.databasePath)).digest('hex');
      const tampered = path.join(work, 't.akbk');
      const b = Buffer.from(readFileSync(file));
      b[b.length - 5]! ^= 0xff;
      writeFileSync(tampered, b, { mode: 0o600 });
      assert.match((await cli(target, ['backup:restore', tampered, '--key-file', kf, '--replace'])).err, /AUTH_FAILED/);
      assert.equal(createHash('sha256').update(readFileSync(target.databasePath)).digest('hex'), before);
      assert.deepEqual(readdirSync(target.dataDir).filter((n) => n.startsWith('.staging-') || n.startsWith('pre-restore-')), []);
    }));

  test('a failed backup (verification fails) leaves no partial or new file and keeps existing backups', () =>
    withApp(async (app, work) => {
      await createAdmin(app);
      const config = configFor(app, work);
      const kf = await keyFile(config, work);
      assert.equal((await cli(config, ['backup:create', '--key-file', kf])).code, 0);
      const existing = backups(config);
      const wrong = configFor(app, work, app.config.dataDir, randomBytes(32));
      assert.match((await cli(wrong, ['backup:create', '--key-file', kf])).err, /APP_SECRET_MISMATCH/);
      assert.deepEqual(backups(config), existing);
      assert.deepEqual(readdirSync(config.backupDir).filter((n) => n.endsWith('.partial')), []);
      assert.deepEqual(readdirSync(config.dataDir).filter((n) => n.startsWith('.staging-')), []);
    }));
});

describe('rotation and diagnostics', () => {
  test('prune keeps N newest plus the newest verified; never touches symlinks or unrelated files; stale leftovers cleaned', () =>
    withApp(async (app, work) => {
      const config = configFor(app, work);
      const kf = await keyFile(config, work);
      mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
      // Stale leftovers of an interrupted run (old mtime) and unrelated files.
      const stalePartial = path.join(config.backupDir, '.alkhayr-20260101-000000-abcdef12.akbk.partial');
      writeFileSync(stalePartial, 'x');
      const staleStaging = path.join(config.dataDir, '.staging-0123456789abcdef');
      mkdirSync(staleStaging);
      const old = new Date(Date.now() - 2 * 3_600_000);
      utimesSync(stalePartial, old, old);
      utimesSync(staleStaging, old, old);
      writeFileSync(path.join(config.backupDir, 'notes.txt'), 'keep me');
      const outside = path.join(work, 'outside.akbk');
      writeFileSync(outside, 'not ours');
      symlinkSync(outside, path.join(config.backupDir, 'alkhayr-20990101-000000-ffffffff.akbk'));
      // A symlink with a managed staging name (pointing at an old directory elsewhere) is never followed or removed.
      const foreignDir = path.join(work, 'foreign-dir');
      mkdirSync(foreignDir);
      writeFileSync(path.join(foreignDir, 'precious.txt'), 'keep');
      utimesSync(foreignDir, old, old);
      const stagingLink = path.join(config.dataDir, '.staging-fedcba9876543210');
      symlinkSync(foreignDir, stagingLink);
      for (let i = 0; i < 3; i++) {
        assert.equal((await cli(config, ['backup:create', '--key-file', kf])).code, 0);
        await new Promise((r) => setTimeout(r, 1100)); // distinct second-resolution names
      }
      assert.ok(!existsSync(stalePartial) && !existsSync(staleStaging), 'stale managed leftovers removed');
      const names = readdirSync(config.backupDir).filter((n) => /^alkhayr-\d{8}-\d{6}-[0-9a-f]{8}\.akbk$/.test(n) && !lstatSync(path.join(config.backupDir, n)).isSymbolicLink()).sort();
      assert.equal(names.length, 3);
      // The newest is NOT verified any more: prune --keep 1 must still keep the newest verified (the middle one).
      const { rmSync } = await import('node:fs');
      rmSync(path.join(config.backupDir, `${names[2]}.verified`));
      const r = await cli(config, ['backup:prune', '--keep', '1']);
      assert.equal(r.code, 0, r.all);
      const left = readdirSync(config.backupDir).sort();
      assert.ok(left.includes(names[2]!) && left.includes(names[1]!) && !left.includes(names[0]!), left.join(','));
      assert.ok(left.includes('notes.txt') && left.includes('alkhayr-20990101-000000-ffffffff.akbk'), 'unrelated file and symlink untouched');
      assert.equal(readFileSync(outside, 'utf8'), 'not ours');
      assert.ok(lstatSync(stagingLink).isSymbolicLink(), 'staging-named symlink untouched');
      assert.equal(readFileSync(path.join(foreignDir, 'precious.txt'), 'utf8'), 'keep');
      assert.equal((await cli(config, ['backup:prune', '--keep', '0'])).code, 2);
      const st = await cli(config, ['backup:status']);
      const json = JSON.parse(st.out);
      assert.equal(json.backups, 2);
      assert.equal(json.newestVerified.name, names[1]);
      assert.equal(typeof json.rows.import_operations, 'number');
      assert.equal(typeof json.freeBytes, 'number');
    }));

  test('status warns (exit 3) when no verified backup exists', () =>
    withApp(async (app, work) => {
      const st = await cli(configFor(app, work), ['backup:status']);
      assert.equal(st.code, 3);
      assert.match(st.out, /no verified backup exists/);
    }));
});

describe('online snapshot consistency under concurrent writes', () => {
  test('backup taken while orders and stock movements commit restores to a state where every invariant holds', () =>
    withApp(async (app, work) => {
      const admin = await createAdmin(app);
      const ac = new Client(app, ip());
      assert.equal((await ac.login(admin.username, admin.password, admin.code())).status, 200);
      const products = Array.from({ length: 5 }, () => insertProduct(app.fixtureDb, { onHand: 0 }));
      const version = (id: string) => (app.fixtureDb.prepare('SELECT version FROM products WHERE id = ?').get(id) as { version: number }).version;
      const config = configFor(app, work);
      const kf = await keyFile(config, work);
      let stop = false;
      let writes = 0;
      const writer = (async () => {
        while (!stop) {
          for (const id of products) {
            const r = await ac.request('POST', `/api/v1/admin/inventory/${id}/adjustments`, { body: { type: 'receipt', quantity: 1, expectedVersion: version(id), operationKey: randomUUID(), reason: 'استلام متزامن' } });
            if (r.status === 201) writes++;
          }
        }
      })();
      const results = [];
      for (let i = 0; i < 3; i++) {
        results.push(await cli(config, ['backup:create', '--key-file', kf]));
        await new Promise((r) => setTimeout(r, 1100));
      }
      stop = true;
      await writer;
      assert.ok(writes > 20, `concurrent writes happened (${writes})`);
      for (const r of results) assert.equal(r.code, 0, r.all);
      for (const name of backups(config)) {
        const target = configFor(app, work, path.join(work, `r-${name}`));
        const rr = await cli(target, ['backup:restore', path.join(config.backupDir, name), '--key-file', kf]);
        assert.equal(rr.code, 0, rr.all); // restore re-runs integrity, FK and stock/ledger invariants on the snapshot
      }
    }));
});
