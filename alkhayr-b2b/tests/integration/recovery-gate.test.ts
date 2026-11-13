import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { runCli } from '../../src/server/cli/index.ts';
import { applyMigrations, loadMigrations } from '../../src/server/database/migrations.ts';
import { Client, count, createAdmin, createTrader, startTestApp, type Response, type TestApp, type TestAppOptions } from '../helpers/app.ts';
import { insertProduct, MIGRATIONS_DIR, tempDir } from '../helpers/database.ts';
import { scriptedPrompter, type Answer } from '../helpers/prompter.ts';
import path from 'node:path';

// Stage 16: post-restore recovery gate, recovery epoch, integrity hold and scoped write guards.

let ipSeq = 0;
const ip = () => `100.95.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const b64 = (s: string) => Buffer.from(s).toString('base64');

async function withApp(fn: (app: TestApp) => Promise<void>, options: TestAppOptions = {}) {
  const app = await startTestApp(options);
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

function expectCode(r: Response, status: number, code: string) {
  assert.equal(r.status, status, r.body);
  assert.equal(r.json?.error?.code, code, r.body);
}

/** Simulates what backup:restore writes into the restored database (recovery mode, new epoch). */
function enterRecovery(app: TestApp, epoch: number) {
  app.fixtureDb
    .prepare("UPDATE system_state SET write_mode = 'recovery', recovery_epoch = ?, restored_backup_id = ?, restored_backup_at = ?, recovery_started_at = ?, version = version + 1 WHERE id = 1")
    .run(epoch, randomUUID(), app.clock.now() - 3_600_000, app.clock.now());
}

async function cli(app: TestApp, args: string[], answers: Answer[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(args, {
    config: app.config,
    migrationsDir: MIGRATIONS_DIR,
    io: { out: (l) => void out.push(l), err: (l) => void err.push(l) },
    createPrompter: () => scriptedPrompter([...answers]),
    now: app.clock.now,
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

async function world(app: TestApp) {
  const adminAccount = await createAdmin(app);
  const ac = new Client(app, ip());
  assert.equal((await ac.login(adminAccount.username, adminAccount.password, adminAccount.code())).status, 200);
  const trader = await createTrader(app);
  const tc = new Client(app, ip());
  assert.equal((await tc.login(trader.username, trader.password)).status, 200);
  const productId = insertProduct(app.fixtureDb, { onHand: 100, price: 12_550, pack: 24 });
  const terms = app.fixtureDb.prepare('SELECT shipping_cents, shipping_taxable, tax_bps FROM business_settings WHERE id = 1').get() as { shipping_cents: number; shipping_taxable: number; tax_bps: number };
  const orderBody = (cartons = 1) => ({
    requestKey: randomUUID(),
    items: [{ productId, cartons, expectedCartonPriceCents: 12_550, expectedPackSize: 24 }],
    expectedTerms: { shippingCents: terms.shipping_cents, shippingTaxable: terms.shipping_taxable === 1, taxBps: terms.tax_bps },
  });
  const version = (id: string) => Number((app.fixtureDb.prepare('SELECT version FROM products WHERE id = ?').get(id) as { version: number }).version);
  const orderVersion = (id: string) => Number((app.fixtureDb.prepare('SELECT version FROM orders WHERE id = ?').get(id) as { version: number }).version);
  const adjustment = (epoch?: number, operationKey = randomUUID()) =>
    ac.request('POST', `/api/v1/admin/inventory/${productId}/adjustments`, {
      body: { type: 'receipt', quantity: 5, expectedVersion: version(productId), operationKey, reason: 'استلام شحنة' },
      ...(epoch === undefined ? {} : { headers: { 'X-Recovery-Epoch': String(epoch) } }),
    });
  const csv = () => `productId,expectedVersion,quantity,reason\n${productId},${version(productId)},3,استلام\n`;
  const importCommit = async (epoch?: number, operationKey = randomUUID(), file = csv()) => {
    const p = await ac.request('POST', '/api/v1/admin/imports/preview', { body: { mode: 'receive_stock', file: b64(file) } });
    assert.equal(p.status, 200, p.body);
    return {
      file,
      operationKey,
      res: await ac.request('POST', '/api/v1/admin/imports/commit', {
        body: { mode: 'receive_stock', file: b64(file), previewToken: p.json.previewToken, operationKey },
        ...(epoch === undefined ? {} : { headers: { 'X-Recovery-Epoch': String(epoch) } }),
      }),
    };
  };
  const transition = (orderId: string, to: string, epoch?: number, operationKey = randomUUID()) =>
    ac.request('POST', `/api/v1/admin/orders/${orderId}/transitions`, {
      body: { to, expectedVersion: orderVersion(orderId), operationKey },
      ...(epoch === undefined ? {} : { headers: { 'X-Recovery-Epoch': String(epoch) } }),
    });
  return { adminAccount, ac, trader, tc, productId, orderBody, adjustment, importCommit, transition, version };
}

const totals = (app: TestApp) => ({
  orders: count(app, 'SELECT count(*) FROM orders'),
  events: count(app, 'SELECT count(*) FROM order_events'),
  ledger: count(app, 'SELECT count(*) FROM inventory_ledger'),
  imports: count(app, 'SELECT count(*) FROM import_operations'),
  products: count(app, 'SELECT coalesce(sum(version), 0) FROM products'),
  merchants: count(app, 'SELECT coalesce(sum(version), 0) FROM merchants'),
  settings: count(app, 'SELECT version FROM business_settings WHERE id = 1'),
  users: count(app, 'SELECT count(*) FROM auth_users'),
});

describe('recovery mode (restored installation)', () => {
  test('every business-write family is refused; reads, sign-in and identical replays of existing operations still work', () =>
    withApp(async (app) => {
      const w = await world(app);
      // Operations committed BEFORE the (simulated) restore: they exist in the restored data.
      const orderBody = w.orderBody();
      const placed = await w.tc.request('POST', '/api/v1/orders', { body: orderBody });
      assert.equal(placed.status, 201, placed.body);
      const orderId = placed.json.order.id as string;
      const tKey = randomUUID();
      assert.equal((await w.transition(orderId, 'confirmed', undefined, tKey)).status, 201);
      const tBody = { to: 'confirmed', expectedVersion: 1, operationKey: tKey };
      const aKey = randomUUID();
      const adj = await w.adjustment(undefined, aKey);
      assert.equal(adj.status, 201, adj.body);
      const imp = await w.importCommit(undefined);
      assert.equal(imp.res.status, 201, imp.res.body);

      const pending = await createTrader(app, { status: 'pending' });
      const epoch = 1_800_000_000_000;
      enterRecovery(app, epoch);
      const before = totals(app);

      // Status is visible to signed-in users and (one word) to the readiness probe.
      const me = await w.tc.request('GET', '/api/v1/auth/me');
      assert.deepEqual(me.json.system, { writes: 'closed', reason: 'recovery', recoveryEpoch: epoch });
      const ready = await new Client(app, ip()).request('GET', '/readyz');
      assert.equal(ready.status, 200);
      assert.deepEqual(ready.json, { status: 'ready', writes: 'closed' });

      // Every NEW write: 503 WRITES_SUSPENDED, nothing written (with or without the current epoch).
      for (const hdr of [{}, { 'X-Recovery-Epoch': String(epoch) }]) {
        expectCode(await w.tc.request('POST', '/api/v1/orders', { body: w.orderBody(), headers: hdr }), 503, 'WRITES_SUSPENDED');
        expectCode(await w.tc.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, phone: '01099999999' }, headers: hdr }), 503, 'WRITES_SUSPENDED');
      }
      expectCode(await w.adjustment(epoch), 503, 'WRITES_SUSPENDED');
      expectCode((await w.importCommit(epoch)).res, 503, 'WRITES_SUSPENDED');
      expectCode(await w.transition(orderId, 'preparing', epoch), 503, 'WRITES_SUSPENDED');
      expectCode(await w.ac.request('POST', '/api/v1/admin/products', { body: { name: 'منتج جديد', brand: 'براند', category: 'chocolate', cartonPriceCents: 1000, packSize: 12, minimumCartons: 1 }, headers: { 'X-Recovery-Epoch': String(epoch) } }), 503, 'WRITES_SUSPENDED');
      expectCode(await w.ac.request('PATCH', `/api/v1/admin/products/${w.productId}`, { body: { expectedVersion: w.version(w.productId), name: 'اسم آخر للمنتج' }, headers: { 'X-Recovery-Epoch': String(epoch) } }), 503, 'WRITES_SUSPENDED');
      const settingsV = count(app, 'SELECT version FROM business_settings WHERE id = 1');
      expectCode(await w.ac.request('PATCH', '/api/v1/admin/settings', { body: { expectedVersion: settingsV, taxBps: 1400 }, headers: { 'X-Recovery-Epoch': String(epoch) } }), 503, 'WRITES_SUSPENDED');
      const mv = count(app, 'SELECT m.version FROM merchants m JOIN auth_users u ON u.id = m.user_id WHERE u.username = ?', pending.username);
      const mid = (app.fixtureDb.prepare('SELECT m.id FROM merchants m JOIN auth_users u ON u.id = m.user_id WHERE u.username = ?').get(pending.username) as { id: string }).id;
      expectCode(await w.ac.request('PATCH', `/api/v1/admin/merchants/${mid}`, { body: { status: 'approved', expectedVersion: mv }, headers: { 'X-Recovery-Epoch': String(epoch) } }), 503, 'WRITES_SUSPENDED');
      const reg = new Client(app, ip());
      await reg.preLogin();
      expectCode(await reg.request('POST', '/api/v1/auth/register', { body: { username: 'new.trader.x', password: 'Registration-Pass-1', businessName: 'محل', contactName: 'أحمد', phone: '01012345678', governorate: 'القاهرة', address: '12 شارع النيل' } }), 503, 'WRITES_SUSPENDED');
      const afterRefusals = totals(app);
      assert.deepEqual(afterRefusals, before, 'nothing written by refused requests');

      // Identical replays of operations that EXIST in the restored data still return their result.
      const replay = await w.tc.request('POST', '/api/v1/orders', { body: orderBody });
      assert.equal(replay.status, 200, replay.body);
      assert.equal(replay.json.replayed, true);
      const tReplay = await w.ac.request('POST', `/api/v1/admin/orders/${orderId}/transitions`, { body: tBody });
      assert.equal(tReplay.status, 200, tReplay.body);
      // Reads and sign-in work.
      assert.equal((await w.tc.request('GET', '/api/v1/orders')).status, 200);
      assert.equal((await w.ac.request('GET', '/api/v1/admin/orders')).status, 200);
      assert.equal((await new Client(app, ip()).login(w.trader.username, w.trader.password)).status, 200);
      assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action LIKE 'order.%' OR action LIKE 'inventory.%'") >= 1, true);
    }));
});

describe('after reopening: the recovery epoch separates pre-restore intents from new ones', () => {
  test('stale epoch + unknown key → refused (no silent write); stale epoch + existing key → replay; current epoch → new write', () =>
    withApp(async (app) => {
      const w = await world(app);
      const existing = w.orderBody();
      const placed = await w.tc.request('POST', '/api/v1/orders', { body: existing });
      assert.equal(placed.status, 201);
      // "Old browser state": an order prepared before the restore whose key is NOT in the restored data.
      const lost = w.orderBody(2);
      const lostAdjKey = randomUUID();
      const epoch = 1_800_000_000_123;
      enterRecovery(app, epoch);
      // Reopen through the operator command (reason + typed confirmation; audited).
      const cancelled = await cli(app, ['recovery:reopen'], ['reconciled with the warehouse', 'no']);
      assert.equal(cancelled.code, 1);
      assert.equal(count(app, "SELECT count(*) FROM system_state WHERE write_mode = 'recovery'"), 1, 'cancel leaves writes closed');
      const r = await cli(app, ['recovery:reopen'], ['reconciled orders and stock with the warehouse', 'REOPEN']);
      assert.equal(r.code, 0, r.err);
      const audit = app.fixtureDb.prepare("SELECT actor_user_id, metadata FROM audit_logs WHERE action = 'recovery.reopened'").get() as { actor_user_id: string | null; metadata: string };
      assert.equal(audit.actor_user_id, null);
      assert.equal(JSON.parse(audit.metadata).recovery_epoch, epoch);
      assert.match(audit.metadata, /reconciled orders and stock/);
      assert.equal((await cli(app, ['recovery:reopen'], [])).code, 0, 'already open: no-op');
      const me = await w.tc.request('GET', '/api/v1/auth/me');
      assert.deepEqual(me.json.system, { writes: 'open', reason: null, recoveryEpoch: epoch });

      const before = totals(app);
      // Old browser retries (no epoch header = prepared before any restore, or an old epoch):
      expectCode(await w.tc.request('POST', '/api/v1/orders', { body: lost }), 409, 'RECOVERY_EPOCH_STALE');
      expectCode(await w.tc.request('POST', '/api/v1/orders', { body: lost, headers: { 'X-Recovery-Epoch': '0' } }), 409, 'RECOVERY_EPOCH_STALE');
      expectCode(await w.tc.request('POST', '/api/v1/orders', { body: lost, headers: { 'X-Recovery-Epoch': String(epoch + 1) } }), 409, 'RECOVERY_EPOCH_STALE');
      expectCode(await w.adjustment(undefined, lostAdjKey), 409, 'RECOVERY_EPOCH_STALE');
      expectCode((await w.importCommit(undefined)).res, 409, 'RECOVERY_EPOCH_STALE');
      expectCode(await w.transition(placed.json.order.id, 'confirmed'), 409, 'RECOVERY_EPOCH_STALE');
      expectCode(await w.ac.request('PATCH', `/api/v1/admin/products/${w.productId}`, { body: { expectedVersion: w.version(w.productId), name: 'اسم آخر للمنتج' } }), 409, 'RECOVERY_EPOCH_STALE');
      expectCode(await w.tc.request('POST', '/api/v1/orders', { body: lost, headers: { 'X-Recovery-Epoch': 'abc' } }), 400, 'BAD_REQUEST');
      assert.deepEqual(totals(app), before, 'no silent new write');
      // An identical retry of an operation that IS in the data replays with its committed result.
      const replay = await w.tc.request('POST', '/api/v1/orders', { body: existing });
      assert.equal(replay.status, 200);
      assert.equal(replay.json.order.id, placed.json.order.id);
      // A fresh, intentional operation under the current epoch (renewed review; NEW key) is accepted.
      const fresh = await w.tc.request('POST', '/api/v1/orders', { body: w.orderBody(2), headers: { 'X-Recovery-Epoch': String(epoch) } });
      assert.equal(fresh.status, 201, fresh.body);
      assert.equal((await w.adjustment(epoch)).status, 201);
      assert.equal((await w.importCommit(epoch)).res.status, 201);
      assert.equal((await w.transition(fresh.json.order.id, 'confirmed', epoch)).status, 201);
      // The stale intent is still refused after other writes (the server never re-keys it).
      expectCode(await w.tc.request('POST', '/api/v1/orders', { body: lost }), 409, 'RECOVERY_EPOCH_STALE');
    }));

  test('a fresh installation (epoch 0) accepts requests without the header (backwards compatible)', () =>
    withApp(async (app) => {
      const w = await world(app);
      assert.equal((await w.tc.request('POST', '/api/v1/orders', { body: w.orderBody() })).status, 201);
      assert.equal((await w.adjustment()).status, 201);
      expectCode(await w.tc.request('POST', '/api/v1/orders', { body: w.orderBody(), headers: { 'X-Recovery-Epoch': '5' } }), 409, 'RECOVERY_EPOCH_STALE');
    }));

  test('recovery:reopen refuses while consistency errors exist; recovery:status reports the mode', () =>
    withApp(async (app) => {
      await world(app);
      enterRecovery(app, 1_800_000_000_999);
      const st = await cli(app, ['recovery:status']);
      assert.equal(st.code, 3);
      assert.match(st.out, /"writeMode": "recovery"/);
      // TEST-ONLY corruption: a ledger row never linked to its product (raw SQL).
      const p = insertProduct(app.fixtureDb, { onHand: 5 });
      app.fixtureDb.prepare("INSERT INTO inventory_ledger (product_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason, created_at) VALUES (?, 'receipt', 1, 0, 6, 0, 'صف يتيم', 1)").run(p);
      const r = await cli(app, ['recovery:reopen'], ['reason here', 'REOPEN']);
      assert.equal(r.code, 1);
      assert.match(r.err, /CONSISTENCY_FAILED.*LEDGER_UNLINKED/);
      assert.equal(count(app, "SELECT count(*) FROM system_state WHERE write_mode = 'recovery'"), 1);
      const check = await cli(app, ['db:check']);
      assert.equal(check.code, 1);
      assert.match(check.out, new RegExp(p));
    }));
});

describe('integrity hold and scoped write guards', () => {
  test('startup consistency errors close every new write (503) but keep reads; no detail is disclosed', () =>
    withApp(
      async (app) => {
        const w = await world(app);
        expectCode(await w.tc.request('POST', '/api/v1/orders', { body: w.orderBody() }), 503, 'WRITES_SUSPENDED');
        expectCode(await w.adjustment(), 503, 'WRITES_SUSPENDED');
        const me = await w.tc.request('GET', '/api/v1/auth/me');
        assert.deepEqual(me.json.system, { writes: 'closed', reason: 'maintenance', recoveryEpoch: 0 });
        assert.doesNotMatch(JSON.stringify(me.json), /LEDGER_UNLINKED/);
        const ready = await new Client(app, ip()).request('GET', '/readyz');
        assert.deepEqual(ready.json, { status: 'ready', writes: 'closed' });
        assert.equal((await w.tc.request('GET', '/api/v1/products')).status, 200);
      },
      { integrityHold: ['LEDGER_UNLINKED'] },
    ));

  test('an inconsistent order or product blocks only its own writes (409 CONSISTENCY_HOLD); nothing is repaired', () =>
    withApp(async (app) => {
      const w = await world(app);
      const a = await w.tc.request('POST', '/api/v1/orders', { body: w.orderBody() });
      const b = await w.tc.request('POST', '/api/v1/orders', { body: w.orderBody() });
      // TEST-ONLY: an event without its state change (raw SQL; documented schema gap).
      app.fixtureDb
        .prepare("INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, note, order_version_after, created_at) VALUES (?, ?, 'pending', 'cancelled', 'إلغاء يدوي', 2, ?)")
        .run(a.json.order.id, w.adminAccount.id, app.clock.now());
      const before = totals(app);
      expectCode(await w.transition(a.json.order.id, 'confirmed'), 409, 'CONSISTENCY_HOLD');
      assert.deepEqual(totals(app), before);
      assert.ok(app.logs.some((l) => l.includes('consistency_hold') && l.includes('ORDER_STATE_MISMATCH')));
      // Order b shares the product: product checks pass, so it can still be confirmed.
      assert.equal((await w.transition(b.json.order.id, 'confirmed')).status, 201);
      // The broken order is still listed (never hidden from reports or lists).
      const list = await w.ac.request('GET', '/api/v1/admin/orders');
      assert.ok((list.json.items as Array<{ id: string }>).some((o) => o.id === a.json.order.id));
      // Product with an orphan ledger row: its movements are held; others continue.
      const other = insertProduct(app.fixtureDb, { onHand: 5 });
      app.fixtureDb.prepare("INSERT INTO inventory_ledger (product_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason, created_at) VALUES (?, 'receipt', 1, 0, 6, 0, 'صف يتيم', 1)").run(other);
      const v = w.version(other);
      expectCode(await w.ac.request('POST', `/api/v1/admin/inventory/${other}/adjustments`, { body: { type: 'receipt', quantity: 1, expectedVersion: v, operationKey: randomUUID(), reason: 'استلام' } }), 409, 'CONSISTENCY_HOLD');
      assert.equal((await w.adjustment()).status, 201);
    }));
});

describe('migration 0008 seeding', () => {
  test('migrating directly after restoring a pre-0008 backup enters recovery mode; otherwise writes are open', () => {
    const all = loadMigrations(MIGRATIONS_DIR);
    const v7 = all.filter((m) => m.version <= 7);
    for (const restored of [true, false]) {
      const dir = tempDir('alkhayr-0008-');
      const db = new DatabaseSync(path.join(dir, 'x.db'));
      try {
        applyMigrations(db, v7);
        db.prepare("INSERT INTO audit_logs (actor_user_id, action, metadata, request_id, created_at) VALUES (NULL, 'auth.login_failed', NULL, ?, 1000)").run(randomUUID());
        if (restored) db.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, metadata, request_id, created_at) VALUES (NULL, 'backup.restored', 'backup', '{}', ?, 2000)").run(randomUUID());
        applyMigrations(db, all);
        const st = db.prepare('SELECT write_mode, recovery_epoch, recovery_started_at FROM system_state').get() as { write_mode: string; recovery_epoch: number; recovery_started_at: number | null };
        assert.deepEqual({ ...st }, restored ? { write_mode: 'recovery', recovery_epoch: 1, recovery_started_at: 2000 } : { write_mode: 'open', recovery_epoch: 0, recovery_started_at: null });
        assert.throws(() => db.exec('DELETE FROM system_state'), /cannot be deleted/);
        assert.throws(() => db.exec("UPDATE system_state SET write_mode = 'open', recovery_epoch = 7, version = version + 1"), /only when entering recovery/);
        assert.throws(() => db.exec('UPDATE system_state SET version = version + 2'), /exactly 1/);
      } finally {
        db.close();
      }
    }
  });
});
