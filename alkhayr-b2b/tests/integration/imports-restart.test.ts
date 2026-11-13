import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { encryptSecret, totpAad } from '../../src/server/auth/encryption.ts';
import { deriveServerKeys } from '../../src/server/auth/keys.ts';
import { PasswordHasher } from '../../src/server/auth/passwords.ts';
import { generateTotpSecret, totpCode } from '../../src/server/auth/totp.ts';
import { loadConfig } from '../../src/server/config.ts';
import { Client, type TestApp } from '../helpers/app.ts';
import { baseEnv, createTempApp, startServer, type TempApp } from '../helpers/server.ts';

// Stage 13: a committed import whose response was lost is recovered with the SAME key after the
// server process restarts (durable, database-backed idempotency; nothing kept in memory).
let app: TempApp;
before(async () => {
  app = await createTempApp();
});
after(async () => app?.cleanup());

describe('import recovery across a server restart', () => {
  test('lost response → restart → same key + same file returns the original batch; applied once', async () => {
    const env = baseEnv();
    const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: env.APP_ORIGIN!, APP_SECRET: env.APP_SECRET!, BACKUP_KEY: env.BACKUP_KEY!, DATA_DIR: './data' }, { baseDir: app.root });
    const keys = deriveServerKeys(config.appSecret);
    const db = new DatabaseSync(app.databasePath);
    const admin = { id: randomUUID(), username: 'restart.admin', password: `Restart-Admin-${randomUUID()}`, secret: generateTotpSecret() };
    const t = Date.now();
    db.prepare("INSERT INTO auth_users (id, username, password_hash, password_changed_at, role, totp_ciphertext, last_otp_step, created_at, updated_at) VALUES (?, ?, ?, ?, 'admin', ?, NULL, ?, ?)").run(
      admin.id, admin.username, await new PasswordHasher().hash(admin.password), t, encryptSecret(keys.totp, admin.secret, totpAad(admin.id)), t, t,
    );
    db.prepare("INSERT INTO merchants (id, user_id, business_name, contact_name, phone, governorate, address, status, version, created_at, updated_at) VALUES (?, ?, 'شركة', 'مدير', '01112345678', 'القاهرة', '1 شارع', 'approved', 1, ?, ?)").run(randomUUID(), admin.id, t, t);

    const csv = 'name,brand,category,cartonPriceEgp,packSize,minimumCartons\nشيكولاتة بعد إعادة التشغيل,نور,chocolate,125.50,24,1\n';
    const file = Buffer.from(csv).toString('base64');
    const key = randomUUID();
    const clientFor = (port: number) => new Client({ port, origin: env.APP_ORIGIN!, config: { isProduction: false } } as unknown as TestApp);

    let server = await startServer(app, env);
    try {
      const c = clientFor(server.port);
      assert.equal((await c.login(admin.username, admin.password, totpCode(admin.secret, Date.now()))).status, 200);
      const p = await c.request('POST', '/api/v1/admin/imports/preview', { body: { mode: 'create_products', file } });
      assert.equal(p.status, 200, p.body);
      const first = await c.request('POST', '/api/v1/admin/imports/commit', { body: { mode: 'create_products', file, previewToken: p.json.previewToken, operationKey: key } });
      assert.equal(first.status, 201, first.body);
      // The browser never saw `first` (lost response). The process stops; nothing survives in memory.
      await server.stop();
      server = await startServer(app, env);
      const c2 = clientFor(server.port);
      // A new sign-in needs a new TOTP step (replay protection).
      assert.equal((await c2.login(admin.username, admin.password, totpCode(admin.secret, Date.now() + 30_000))).status, 200);
      const replay = await c2.request('POST', '/api/v1/admin/imports/commit', { body: { mode: 'create_products', file, previewToken: p.json.previewToken, operationKey: key } });
      assert.equal(replay.status, 200, replay.body);
      assert.equal(replay.json.replayed, true);
      assert.equal(replay.json.import.id, first.json.import.id);
      assert.deepEqual(replay.json.import.items, first.json.import.items);
      const n = db.prepare("SELECT count(*) AS n FROM products WHERE name = 'شيكولاتة بعد إعادة التشغيل'").get() as { n: number };
      assert.equal(n.n, 1);
      const ops = db.prepare('SELECT count(*) AS n FROM import_operations').get() as { n: number };
      assert.equal(ops.n, 1);
      // The uploaded file is not stored: its header line appears nowhere in the database files.
      const files = [app.databasePath, `${app.databasePath}-wal`].filter((f) => existsSync(f)).map((f) => readFileSync(f));
      for (const f of files) assert.ok(!f.includes(Buffer.from('name,brand,category,cartonPriceEgp')), 'CSV content found in the database file');
    } finally {
      await server.stop();
      db.close();
    }
  });
});
