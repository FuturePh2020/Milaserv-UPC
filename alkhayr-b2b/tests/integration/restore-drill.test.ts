import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { deriveKey, encryptSecret, totpAad } from '../../src/server/auth/encryption.ts';
import { PasswordHasher } from '../../src/server/auth/passwords.ts';
import { generateTotpSecret, totpCode } from '../../src/server/auth/totp.ts';
import { parseSecret } from '../../src/server/config.ts';
import { insertMerchant, insertProduct } from '../helpers/database.ts';
import { baseEnv, createTempApp, FIXTURE_APP_SECRET, projectRoot, rawRequest, runCli, startServer, TEST_HOST, type RunningServer, type TempApp } from '../helpers/server.ts';

// Stage 15 recovery drill against the REAL bundled server and CLI processes:
// live server -> online encrypted backup -> stop -> restore into a NEW DATA_DIR -> real startup ->
// administrator TOTP login with the original secret, merchant login and history, idempotent replay,
// restored sessions rejected. Disposable app root and synthetic credentials only.

const ADMIN_PASSWORD = 'Drill-Fixture-Admin-Passphrase';
const TRADER_PASSWORD = 'Drill-Fixture-Trader-1';
const ORIGIN = `http://${TEST_HOST}`;

class RawClient {
  readonly jar = new Map<string, string>();
  csrf: string | null = null;
  readonly server: () => RunningServer;
  constructor(server: () => RunningServer) {
    this.server = server;
  }
  async request(method: string, p: string, body?: unknown) {
    const headers: Record<string, string> = { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' };
    if (this.jar.size) headers.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await rawRequest(this.server().port, { method, path: p, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    for (const c of ([] as string[]).concat(r.headers['set-cookie'] ?? [])) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      const v = pair!.slice(i + 1);
      if (v === '' || /Max-Age=0/i.test(c)) this.jar.delete(pair!.slice(0, i));
      else this.jar.set(pair!.slice(0, i), v);
    }
    let json: any;
    try {
      json = JSON.parse(r.body);
    } catch {
      /* not JSON */
    }
    return { ...r, json };
  }
  async login(username: string, password: string, totp?: string) {
    this.jar.clear();
    this.csrf = null;
    const pre = await this.request('GET', '/api/v1/auth/csrf');
    this.csrf = pre.json.preLoginToken;
    const r = await this.request('POST', '/api/v1/auth/login', { username, password, ...(totp ? { totp } : {}) });
    if (r.status === 200) this.csrf = r.json.csrfToken;
    return r;
  }
}

test('recovery drill: online backup of a running server, restore into a new DATA_DIR, real startup and sign-in', { timeout: 240_000 }, async () => {
  const app = await createTempApp();
  const backupDir = path.join(app.root, 'backups');
  const keyDir = path.join(app.root, 'operator-keys');
  mkdirSync(keyDir, { mode: 0o700 });
  const keyFile = path.join(keyDir, 'backup.key');
  const env = (extra: Record<string, string> = {}) => baseEnv({ BACKUP_DIR: backupDir, ...extra });
  try {
    // ---- seed: administrator (TOTP encrypted with this deployment's APP_SECRET), trader, product
    const totpSecret = generateTotpSecret();
    const hasher = new PasswordHasher();
    {
      const db = new DatabaseSync(app.databasePath);
      const t = Date.now();
      const adminId = randomUUID();
      const appSecret = parseSecret('APP_SECRET', FIXTURE_APP_SECRET) as Buffer;
      db.prepare("INSERT INTO auth_users (id, username, password_hash, password_changed_at, role, totp_ciphertext, created_at, updated_at) VALUES (?, 'drill.admin', ?, ?, 'admin', ?, ?, ?)").run(
        adminId,
        await hasher.hash(ADMIN_PASSWORD),
        t,
        encryptSecret(deriveKey(appSecret, 'totp'), totpSecret, totpAad(adminId)),
        t,
        t,
      );
      insertMerchant(db, adminId);
      const traderId = randomUUID();
      db.prepare("INSERT INTO auth_users (id, username, password_hash, password_changed_at, role, created_at, updated_at) VALUES (?, 'drill.trader', ?, ?, 'trader', ?, ?)").run(traderId, await hasher.hash(TRADER_PASSWORD), t, t, t);
      insertMerchant(db, traderId);
      insertProduct(db, { onHand: 40, price: 12_550, pack: 24 });
      db.close();
    }

    // ---- live server: admin sign-in, a real order, a session that will be in the backup
    let server = await startServer(app, env());
    const current = () => server;
    const product = new DatabaseSync(app.databasePath, { readOnly: true }).prepare('SELECT id, price_cents, pack_size FROM products').get() as { id: string; price_cents: number; pack_size: number };
    const admin = new RawClient(current);
    const usedCode = totpCode(totpSecret, Date.now());
    assert.equal((await admin.login('drill.admin', ADMIN_PASSWORD, usedCode)).status, 200);
    const trader = new RawClient(current);
    assert.equal((await trader.login('drill.trader', TRADER_PASSWORD)).status, 200);
    const terms = new DatabaseSync(app.databasePath, { readOnly: true }).prepare('SELECT shipping_cents, shipping_taxable, tax_bps FROM business_settings WHERE id = 1').get() as { shipping_cents: number; shipping_taxable: number; tax_bps: number };
    const orderBody = {
      requestKey: randomUUID(),
      items: [{ productId: product.id, cartons: 3, expectedCartonPriceCents: product.price_cents, expectedPackSize: product.pack_size }],
      expectedTerms: { shippingCents: terms.shipping_cents, shippingTaxable: terms.shipping_taxable === 1, taxBps: terms.tax_bps },
    };
    const placed = await trader.request('POST', '/api/v1/orders', orderBody);
    assert.equal(placed.status, 201, placed.body);
    const orderId = placed.json.order.id as string;
    const oldCookies = new Map(trader.jar);

    // ---- keygen + online backup while the server runs
    const kg = await runCli(app, ['backup:keygen', '--out', keyFile], env());
    assert.equal(kg.code, 0, kg.stderr);
    assert.equal(statSync(keyFile).mode & 0o777, 0o600);
    const created = await runCli(app, ['backup:create', '--key-file', keyFile], env());
    assert.equal(created.code, 0, created.stderr + created.stdout);
    const backupFile = path.join(backupDir, readdirSync(backupDir).find((n) => n.endsWith('.akbk'))!);
    // Changes after the backup are NOT in it (recovery point = backup time).
    const late = await trader.request('POST', '/api/v1/orders', { ...orderBody, requestKey: randomUUID() });
    assert.equal(late.status, 201, late.body);
    assert.equal(await server.stop(), 0);

    // ---- restore into a NEW data directory with the WRONG APP_SECRET: refused, nothing created
    const restoredDir = path.join(app.root, 'restored-data');
    const wrong = await runCli(app, ['backup:restore', backupFile, '--key-file', keyFile], env({ DATA_DIR: restoredDir, APP_SECRET: randomBytes(32).toString('base64url') }));
    assert.equal(wrong.code, 1);
    assert.match(wrong.stderr, /APP_SECRET_MISMATCH/);

    // ---- restore with the right secret (timed: measured RTO component for this tiny dataset)
    const t0 = Date.now();
    const restored = await runCli(app, ['backup:restore', backupFile, '--key-file', keyFile], env({ DATA_DIR: restoredDir }));
    assert.equal(restored.code, 0, restored.stderr + restored.stdout);
    assert.match(restored.stdout, /OLDER point in time/);
    server = await startServer(app, env({ DATA_DIR: restoredDir }));
    const restoreToReadyMs = Date.now() - t0;
    try {
      // Sessions from the backup are rejected.
      const stale = new RawClient(current);
      for (const [k, v] of oldCookies) stale.jar.set(k, v);
      assert.equal((await stale.request('GET', '/api/v1/auth/me')).status, 401);
      // TOTP anti-replay state survived: the code used before the backup is refused...
      assert.equal((await new RawClient(current).login('drill.admin', ADMIN_PASSWORD, usedCode)).status, 401);
      // ...and the ORIGINAL authenticator works with a later code.
      const admin2 = new RawClient(current);
      assert.equal((await admin2.login('drill.admin', ADMIN_PASSWORD, totpCode(totpSecret, Date.now() + 30_000))).status, 200);
      assert.equal((await admin2.request('GET', `/api/v1/admin/orders/${orderId}`)).status, 200);
      // Merchant history: the backed-up order exists, the later one does not (older point in time).
      const trader2 = new RawClient(current);
      assert.equal((await trader2.login('drill.trader', TRADER_PASSWORD)).status, 200);
      const list = await trader2.request('GET', '/api/v1/orders');
      assert.equal(list.status, 200, list.body);
      const ids = (list.json.items as Array<{ id: string }>).map((o) => o.id);
      assert.ok(ids.includes(orderId));
      assert.ok(!ids.includes(late.json.order.id), 'post-backup order is not in the restored data');
      // Idempotency records retained: the identical retry returns the original order, no duplicate.
      const replay = await trader2.request('POST', '/api/v1/orders', orderBody);
      assert.equal(replay.status, 200, replay.body);
      assert.equal(replay.json.replayed, true);
      assert.equal(replay.json.order.id, orderId);
      const logs = server.stdout() + server.stderr() + restored.stdout + restored.stderr + created.stdout + created.stderr;
      for (const s of [ADMIN_PASSWORD, TRADER_PASSWORD, FIXTURE_APP_SECRET, totpSecret.toString('hex')]) assert.ok(!logs.includes(s), 'secret in process output');
    } finally {
      assert.equal(await server.stop(), 0);
    }
    // Ledger reconciliation on the restored data (also part of backup:verify).
    const db = new DatabaseSync(path.join(restoredDir, 'alkhayr.db'), { readOnly: true });
    const bad = db.prepare(`SELECT count(*) AS n FROM products p WHERE p.on_hand <> (SELECT coalesce(sum(on_hand_delta),0) FROM inventory_ledger l WHERE l.product_id = p.id)
                                 OR p.reserved <> (SELECT coalesce(sum(reserved_delta),0) FROM inventory_ledger l WHERE l.product_id = p.id)`).get() as { n: number };
    assert.equal(Number(bad.n), 0);
    assert.equal(Number((db.prepare("SELECT count(*) AS n FROM audit_logs WHERE action = 'backup.restored' AND actor_user_id IS NULL").get() as { n: number }).n), 1);
    db.close();
    console.log(`# drill: restore + verify + server ready in ${restoreToReadyMs} ms (tiny synthetic dataset; not an RTO for real data)`);
  } finally {
    await app.cleanup();
  }
});

/** Runs a bundled CLI command inside a real pseudo-terminal (tests/helpers/pty_driver.py). */
function pty(app: TempApp, args: string[], env: NodeJS.ProcessEnv, steps: Array<{ expect: string; send: string | null }>) {
  const cfg = { argv: [process.execPath, path.join(app.distDir, 'server', 'cli.js'), ...args], env: { ...env, TERM: 'dumb' }, cwd: app.root, timeout: 60, steps };
  return JSON.parse(execFileSync('python3', ['-I', path.join(projectRoot, 'tests', 'helpers', 'pty_driver.py'), JSON.stringify(cfg)], { encoding: 'utf8', timeout: 90_000 })) as { exit: number | null; error: string | null; transcript: string };
}

test('real terminal: backup key typed at a hidden prompt (never echoed); password reset through the terminal', { timeout: 240_000 }, async () => {
  const app = await createTempApp();
  const backupDir = path.join(app.root, 'backups');
  const env = baseEnv({ BACKUP_DIR: backupDir });
  try {
    const hasher = new PasswordHasher();
    {
      const db = new DatabaseSync(app.databasePath);
      const t = Date.now();
      const id = randomUUID();
      db.prepare("INSERT INTO auth_users (id, username, password_hash, password_changed_at, role, created_at, updated_at) VALUES (?, 'pty.trader', ?, ?, 'trader', ?, ?)").run(id, await hasher.hash(TRADER_PASSWORD), t, t, t);
      insertMerchant(db, id);
      db.close();
    }
    const keyDir = path.join(app.root, 'operator-keys');
    mkdirSync(keyDir, { mode: 0o700 });
    const keyFile = path.join(keyDir, 'backup.key');
    assert.equal((await runCli(app, ['backup:keygen', '--out', keyFile], env)).code, 0);
    const key = readFileSync(keyFile, 'utf8').trim();
    const b = pty(app, ['backup:create'], env, [
      { expect: 'Backup key \\(hidden\\): ', send: key },
      { expect: 'Backup verified', send: null },
    ]);
    assert.equal(b.exit, 0, `${b.error}\n${b.transcript}`);
    assert.ok(!b.transcript.includes(key), 'the backup key is never echoed');
    assert.equal(readdirSync(backupDir).filter((n) => n.endsWith('.akbk')).length, 1);

    const NEW = 'Pty-Reset-Trader-Pass-7';
    const r = pty(app, ['account:reset-password'], env, [
      { expect: 'Username of the account: ', send: 'pty.trader' },
      { expect: 'Type the username again to confirm this account: ', send: 'pty.trader' },
      { expect: 'Reason for this action', send: 'merchant forgot the password' },
      { expect: 'New password: ', send: NEW },
      { expect: 'Confirm password: ', send: NEW },
      { expect: 'Password reset for', send: null },
    ]);
    assert.equal(r.exit, 0, `${r.error}\n${r.transcript}`);
    assert.ok(!r.transcript.includes(NEW), `the new password is never echoed:\n${r.transcript}`);
    const db = new DatabaseSync(app.databasePath, { readOnly: true });
    const row = db.prepare("SELECT password_hash, credential_version FROM auth_users WHERE username = 'pty.trader'").get() as { password_hash: string; credential_version: number };
    db.close();
    assert.equal(row.credential_version, 2);
    assert.equal(await hasher.verify(NEW, row.password_hash), true);
  } finally {
    await app.cleanup();
  }
});
