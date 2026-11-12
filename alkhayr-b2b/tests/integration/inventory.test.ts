import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { Client, count, createAdmin, createTrader, startTestApp, type TestApp } from '../helpers/app.ts';
import { fixtureReserve } from '../helpers/database.ts';

// Synthetic accounts and products only. Reserved stock is set ONLY through the test-only fixture (stage 09 owns reservations).
const MIN = 60_000;
let ipSeq = 0;
const ip = () => `100.90.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

function expectCode(r: { status: number; json: any }, status: number, code: string) {
  assert.equal(r.status, status, JSON.stringify(r.json));
  assert.equal(r.json?.error?.code, code);
}

async function withApp(fn: (app: TestApp) => Promise<void>, options: Parameters<typeof startTestApp>[0] = {}) {
  const app = await startTestApp(options);
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

async function signedIn(app: TestApp, account: { username: string; password: string; code?: (o?: number) => string }) {
  const c = new Client(app, ip());
  const r = await c.login(account.username, account.password, account.code?.());
  assert.equal(r.status, 200, r.body);
  return c;
}

async function setup(app: TestApp, productExtra: Record<string, unknown> = {}) {
  const account = await createAdmin(app);
  const c = await signedIn(app, account);
  const r = await c.request('POST', '/api/v1/admin/products', {
    body: { name: 'كاندي فواكه', brand: 'Candy Co', category: 'candy', cartonPriceCents: 9000, packSize: 48, minimumCartons: 1, ...productExtra },
  });
  assert.equal(r.status, 201, r.body);
  return { account, c, product: r.json.product as { id: string; version: number } };
}

type Body = Record<string, unknown>;
const adjust = (c: Client, productId: string, body: Body) => c.request('POST', `/api/v1/admin/inventory/${productId}/adjustments`, { body });
const op = (type: string, amount: Body, expectedVersion: number, extra: Body = {}): Body => ({
  type,
  ...amount,
  expectedVersion,
  operationKey: randomUUID(),
  reason: 'استلام شحنة من المورد',
  ...extra,
});
const row = (app: TestApp, id: string) => ({ ...(app.fixtureDb.prepare('SELECT on_hand, reserved, version, active, last_ledger_id FROM products WHERE id = ?').get(id) as object) }) as any;
const ledgerCount = (app: TestApp, id: string) => count(app, 'SELECT count(*) FROM inventory_ledger WHERE product_id = ?', id);

describe('access control', () => {
  test('anonymous, trader, pending and suspended users are denied; admin reads need no recency, mutations do', () =>
    withApp(async (app) => {
      const { account, c, product } = await setup(app);
      const paths = ['/api/v1/admin/inventory', `/api/v1/admin/inventory/${product.id}/ledger`];
      const anon = new Client(app, ip());
      for (const p of paths) expectCode(await anon.request('GET', p), 401, 'UNAUTHENTICATED');
      expectCode(await adjust(anon, product.id, op('receipt', { quantity: 5 }, 1)), 401, 'UNAUTHENTICATED');
      for (const status of ['approved', 'pending'] as const) {
        const t = await signedIn(app, await createTrader(app, { status }));
        for (const p of paths) expectCode(await t.request('GET', p), 403, 'FORBIDDEN');
        expectCode(await adjust(t, product.id, op('receipt', { quantity: 5 }, 1)), 403, 'FORBIDDEN');
      }
      const st = await createTrader(app);
      const s = await signedIn(app, st);
      app.fixtureDb.prepare("UPDATE merchants SET status = 'suspended', access_version = access_version + 1, version = version + 1 WHERE id = ?").run(st.merchantId);
      expectCode(await s.request('GET', '/api/v1/admin/inventory'), 401, 'UNAUTHENTICATED');
      assert.equal(row(app, product.id).on_hand, 0);

      app.clock.advance(10 * MIN);
      await c.request('GET', '/api/v1/auth/me');
      app.clock.advance(6 * MIN);
      assert.equal((await c.request('GET', '/api/v1/admin/inventory')).status, 200);
      assert.equal((await c.request('GET', `/api/v1/admin/inventory/${product.id}/ledger`)).status, 200);
      expectCode(await adjust(c, product.id, op('receipt', { quantity: 5 }, 1)), 428, 'RECENT_AUTH_REQUIRED');
      app.clock.advance(30_000);
      await c.login(account.username, account.password, account.code());
      assert.equal((await adjust(c, product.id, op('receipt', { quantity: 5 }, 1))).status, 201);
    }));

  test('logout or recency expiry while the request body arrives prevents the movement', () =>
    withApp(async (app) => {
      const { account, c, product } = await setup(app);
      const r1 = await c.requestSlow('POST', `/api/v1/admin/inventory/${product.id}/adjustments`, op('receipt', { quantity: 5 }, 1), () => {
        app.fixtureDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(account.id);
      });
      expectCode(r1, 401, 'UNAUTHENTICATED');
      const c2 = await signedIn(app, { ...account, code: () => account.code(1) });
      app.clock.advance(14 * MIN + 50_000);
      await c2.request('GET', '/api/v1/auth/me');
      const r2 = await c2.requestSlow('POST', `/api/v1/admin/inventory/${product.id}/adjustments`, op('receipt', { quantity: 5 }, 1), () => app.clock.advance(20_000));
      expectCode(r2, 428, 'RECENT_AUTH_REQUIRED');
      assert.deepEqual([row(app, product.id).on_hand, ledgerCount(app, product.id)], [0, 0]);
    }));
});

describe('operations', () => {
  test('receipt, positive/negative correction and set_total; inactive product stays inactive; ledger, version and audit', () =>
    withApp(async (app) => {
      const { account, c, product } = await setup(app);
      const r1 = await adjust(c, product.id, op('receipt', { quantity: 24 }, 1, { reference: 'INV-2026-001' }));
      assert.equal(r1.status, 201, r1.body);
      assert.equal(r1.json.replayed, false);
      assert.deepEqual(
        { onHand: r1.json.product.onHand, reserved: r1.json.product.reserved, available: r1.json.product.available, version: r1.json.product.version, active: r1.json.product.product.active },
        { onHand: 24, reserved: 0, available: 24, version: 2, active: false },
      );
      const e = r1.json.operation;
      assert.deepEqual(
        { kind: e.kind, type: e.adjustmentType, d: e.onHandDelta, rd: e.reservedDelta, after: e.onHandAfter, ra: e.reservedAfter, reason: e.reason, ref: e.reference, actor: e.actor, v: e.productVersionAfter, order: e.orderId },
        { kind: 'receipt', type: 'receipt', d: 24, rd: 0, after: 24, ra: 0, reason: 'استلام شحنة من المورد', ref: 'INV-2026-001', actor: account.username, v: 2, order: null },
      );
      assert.equal(row(app, product.id).last_ledger_id, e.id);
      const r2 = await adjust(c, product.id, op('correction_delta', { delta: 5 }, 2, { reason: 'جرد: زيادة' }));
      const r3 = await adjust(c, product.id, op('correction_delta', { delta: -3 }, 3, { reason: 'تالف' }));
      const r4 = await adjust(c, product.id, op('set_total', { total: 10 }, 4, { reason: 'جرد فعلي' }));
      assert.deepEqual([r2.json.product.onHand, r3.json.product.onHand, r4.json.product.onHand], [29, 26, 10]);
      assert.equal(r4.json.operation.onHandDelta, -16, 'set_total stores the computed delta');
      assert.equal(r4.json.operation.kind, 'correction');
      assert.deepEqual(row(app, product.id), { on_hand: 10, reserved: 0, version: 5, active: 0, last_ledger_id: r4.json.operation.id });
      const audits = app.fixtureDb.prepare("SELECT metadata FROM audit_logs WHERE action = 'inventory.adjusted' ORDER BY id").all().map((a: any) => JSON.parse(a.metadata));
      assert.deepEqual(audits.map((a: any) => [a.type, a.on_hand_delta, a.on_hand_after, a.version]), [
        ['receipt', 24, 24, 2],
        ['correction_delta', 5, 29, 3],
        ['correction_delta', -3, 26, 4],
        ['set_total', -16, 10, 5],
      ]);
      assert.ok(audits.every((a: any) => !('reason' in a)), 'reason lives in the ledger, not the audit row');
    }));

  test('integer/type/overflow bounds; missing fields; unexpected and reservation fields rejected', () =>
    withApp(async (app) => {
      const { c, product } = await setup(app);
      const bad: Body[] = [
        op('receipt', { quantity: '5' }, 1),
        op('receipt', { quantity: 5.5 }, 1),
        op('receipt', { quantity: 0 }, 1),
        op('receipt', { quantity: -1 }, 1),
        op('receipt', { quantity: 1_000_000_001 }, 1),
        op('receipt', { quantity: true }, 1),
        op('receipt', { quantity: null }, 1),
        op('receipt', { quantity: 2 ** 53 }, 1),
        op('correction_delta', { delta: 0 }, 1),
        op('correction_delta', { delta: 2.5 }, 1),
        op('set_total', { total: -1 }, 1),
        op('set_total', { total: 1.5 }, 1),
        op('receipt', { delta: 5 }, 1),
        op('set_total', { quantity: 5 }, 1),
        op('reserve', { quantity: 5 }, 1),
        op('opening', { quantity: 5 }, 1),
        { ...op('receipt', { quantity: 5 }, 1), reason: undefined },
        op('receipt', { quantity: 5 }, 1, { reason: 'x' }),
        op('receipt', { quantity: 5 }, 1, { reason: 'x'.repeat(301) }),
        op('receipt', { quantity: 5 }, 1, { reference: '' }),
        op('receipt', { quantity: 5 }, 1, { operationKey: 'not-a-uuid' }),
        { ...op('receipt', { quantity: 5 }, 1), operationKey: undefined },
        { ...op('receipt', { quantity: 5 }, 1), expectedVersion: undefined },
        op('receipt', { quantity: 5 }, 1, { reserved: 3 }),
        op('receipt', { quantity: 5 }, 1, { available: 5 }),
        op('receipt', { quantity: 5 }, 1, { orderId: randomUUID() }),
        op('receipt', { quantity: 5 }, 1, { actorUserId: randomUUID() }),
        op('receipt', { quantity: 5 }, 1, { onHandAfter: 5 }),
        op('receipt', { quantity: 5 }, 1, { productId: randomUUID() }),
        op('correction_delta', { delta: 5 }, 1, { reservedDelta: -2 }),
      ];
      for (const body of bad) expectCode(await adjust(c, product.id, JSON.parse(JSON.stringify(body))), 400, 'VALIDATION_FAILED');
      expectCode(await c.request('POST', `/api/v1/admin/inventory/${product.id}/adjustments`, { rawBody: JSON.stringify(op('receipt', { quantity: 5 }, 1)).replace('"quantity":5', '"quantity":1e400') }), 400, 'VALIDATION_FAILED');
      expectCode(await c.request('POST', `/api/v1/admin/inventory/${product.id}/adjustments`, { rawBody: 'quantity=5', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), 415, 'UNSUPPORTED_MEDIA_TYPE');
      expectCode(await c.request('POST', `/api/v1/admin/inventory/${product.id}/adjustments`, { body: op('receipt', { quantity: 5 }, 1), csrf: null }), 403, 'CSRF_FAILED');
      expectCode(await c.request('POST', `/api/v1/admin/inventory/${product.id}/adjustments`, { body: op('receipt', { quantity: 5 }, 1), noOrigin: true }), 403, 'ORIGIN_REJECTED');
      expectCode(await adjust(c, randomUUID(), op('receipt', { quantity: 5 }, 1)), 404, 'NOT_FOUND');
      assert.deepEqual([row(app, product.id).on_hand, ledgerCount(app, product.id)], [0, 0]);
      // Overflow above the maximum physical total.
      assert.equal((await adjust(c, product.id, op('set_total', { total: 1_000_000_000 }, 1))).status, 201);
      expectCode(await adjust(c, product.id, op('receipt', { quantity: 1 }, 2)), 422, 'INVENTORY_LIMIT');
    }));

  test('no-op, negative total and totals below reserved are rejected; reserved never changes', () =>
    withApp(async (app) => {
      const { c, product } = await setup(app);
      assert.equal((await adjust(c, product.id, op('receipt', { quantity: 10 }, 1))).status, 201);
      expectCode(await adjust(c, product.id, op('set_total', { total: 10 }, 2)), 422, 'NO_CHANGE');
      fixtureReserve(app.fixtureDb, product.id, 8); // TEST-ONLY reservation (stage 09 owns real ones); version → 3
      const v = row(app, product.id).version;
      const below = await adjust(c, product.id, op('set_total', { total: 7 }, v));
      expectCode(below, 422, 'INVENTORY_BELOW_RESERVED');
      assert.deepEqual(below.json.error.details.current.product.stock, { onHand: 10, reserved: 8, available: 2 });
      expectCode(await adjust(c, product.id, op('correction_delta', { delta: -3 }, v)), 422, 'INVENTORY_BELOW_RESERVED');
      expectCode(await adjust(c, product.id, op('correction_delta', { delta: -11 }, v)), 422, 'INVENTORY_NEGATIVE');
      const ok = await adjust(c, product.id, op('set_total', { total: 8 }, v));
      assert.equal(ok.status, 201);
      assert.deepEqual({ ...ok.json.product, product: undefined, updatedAt: undefined, statusLabelAr: undefined }, { product: undefined, onHand: 8, reserved: 8, available: 0, status: 'out_of_stock', statusLabelAr: undefined, version: v + 1, updatedAt: undefined });
      assert.equal(row(app, product.id).reserved, 8, 'manual adjustments never touch reserved');
    }));
});

describe('database-level protections (migration 0003)', () => {
  test('the database rejects defaulted/active/stocked product inserts and stock changes without a ledger row', () =>
    withApp(async (app) => {
      const { c, product } = await setup(app);
      const insert = (extraCols: string, extraVals: string) =>
        app.fixtureDb
          .prepare(`INSERT INTO products (id, name, brand, category, price_cents, pack_size, created_at, updated_at${extraCols}) VALUES (?, 'منتج', 'B', 'candy', 100, 1, 1, 1${extraVals})`)
          .run(randomUUID());
      assert.throws(() => insert('', ''), /inserted inactive/, 'column default active = 1 is refused');
      assert.throws(() => insert(', active', ', 1'), /inserted inactive/);
      assert.throws(() => insert(', active, on_hand', ', 0, 5'), /inserted inactive/);
      assert.doesNotThrow(() => insert(', active', ', 0'));
      assert.throws(() => app.fixtureDb.prepare('UPDATE products SET on_hand = 50, version = version + 1 WHERE id = ?').run(product.id), /inventory_ledger/);
      // Product metadata endpoints still refuse stock fields.
      expectCode(await c.request('PATCH', `/api/v1/admin/products/${product.id}`, { body: { expectedVersion: 1, onHand: 50 } }), 400, 'VALIDATION_FAILED');
      expectCode(await c.request('POST', '/api/v1/admin/products', { body: { name: 'منتج آخر', brand: 'B', category: 'candy', cartonPriceCents: 1, packSize: 1, minimumCartons: 1, onHand: 5 } }), 400, 'VALIDATION_FAILED');
      assert.equal(row(app, product.id).on_hand, 0);
    }));

  test('ledger entries are immutable over SQL and HTTP; mistakes are fixed by a compensating movement', () =>
    withApp(async (app) => {
      const { c, product } = await setup(app);
      const wrong = await adjust(c, product.id, op('receipt', { quantity: 30 }, 1, { reason: 'استلام (خطأ: كان 3)' }));
      assert.throws(() => app.fixtureDb.prepare('UPDATE inventory_ledger SET on_hand_delta = 3 WHERE id = ?').run(wrong.json.operation.id), /append-only/);
      assert.throws(() => app.fixtureDb.prepare('DELETE FROM inventory_ledger WHERE id = ?').run(wrong.json.operation.id), /append-only/);
      expectCode(await c.request('DELETE', `/api/v1/admin/inventory/${product.id}/ledger`), 405, 'METHOD_NOT_ALLOWED');
      expectCode(await c.request('PATCH', `/api/v1/admin/inventory/${product.id}/ledger`, { body: {} }), 405, 'METHOD_NOT_ALLOWED');
      const fix = await adjust(c, product.id, op('correction_delta', { delta: -27 }, 2, { reason: `تصحيح العملية ${wrong.json.operation.id}: الكمية الصحيحة 3` }));
      assert.equal(fix.json.product.onHand, 3);
      const ledger = await c.request('GET', `/api/v1/admin/inventory/${product.id}/ledger`);
      assert.deepEqual(ledger.json.items.map((e: any) => [e.onHandDelta, e.onHandAfter]), [[-27, 3], [30, 30]]);
    }));
});

describe('concurrency and idempotency', () => {
  test('a metadata edit and an inventory change from the same version: the later one gets 409 with the current record', () =>
    withApp(async (app) => {
      const { c, product } = await setup(app);
      assert.equal((await adjust(c, product.id, op('receipt', { quantity: 5 }, 1))).status, 201);
      const stale = await c.request('PATCH', `/api/v1/admin/products/${product.id}`, { body: { expectedVersion: 1, cartonPriceCents: 1 } });
      expectCode(stale, 409, 'VERSION_CONFLICT');
      assert.equal(stale.json.error.details.current.product.stock.onHand, 5);
      assert.equal((await c.request('PATCH', `/api/v1/admin/products/${product.id}`, { body: { expectedVersion: 2, name: 'اسم جديد للمنتج' } })).status, 200);
      const staleStock = await adjust(c, product.id, op('receipt', { quantity: 5 }, 2));
      expectCode(staleStock, 409, 'VERSION_CONFLICT');
      assert.equal(staleStock.json.error.details.current.product.version, 3);
      assert.equal(row(app, product.id).on_hand, 5);
    }));

  test('two different concurrent adjustments from the same version: one commits, the other gets 409', () =>
    withApp(async (app) => {
      const { c, product } = await setup(app);
      const results = await Promise.all([adjust(c, product.id, op('receipt', { quantity: 5 }, 1)), adjust(c, product.id, op('receipt', { quantity: 7 }, 1))]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal(ledgerCount(app, product.id), 1);
      assert.ok([5, 7].includes(row(app, product.id).on_hand));
    }));

  test('identical retries (sequential and concurrent) replay; changed content with the same key is 409', () =>
    withApp(async (app) => {
      const { c, product } = await setup(app);
      const body = op('receipt', { quantity: 12 }, 1);
      const first = await adjust(c, product.id, body);
      assert.equal(first.status, 201);
      const again = await adjust(c, product.id, body);
      assert.equal(again.status, 200);
      assert.equal(again.json.replayed, true);
      assert.deepEqual(again.json.operation, first.json.operation, 'same operation identity and committed result');
      assert.deepEqual([row(app, product.id).on_hand, ledgerCount(app, product.id), count(app, "SELECT count(*) FROM audit_logs WHERE action = 'inventory.adjusted'")], [12, 1, 1]);
      const concurrent = op('receipt', { quantity: 3 }, 2);
      const results = await Promise.all([1, 2, 3].map(() => adjust(c, product.id, concurrent)));
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 201]);
      assert.equal(new Set(results.map((r) => r.json.operation.id)).size, 1);
      assert.deepEqual([row(app, product.id).on_hand, ledgerCount(app, product.id)], [15, 2]);
      for (const changed of [{ ...body, quantity: 13 }, { ...body, reason: 'سبب مختلف للعملية' }, { ...body, reference: 'X-1' }, { ...body, expectedVersion: 3 }]) {
        expectCode(await adjust(c, product.id, changed), 409, 'IDEMPOTENCY_KEY_REUSED');
      }
      const other = await (await setup(app, { name: 'منتج آخر' })).product;
      expectCode(await adjust(c, other.id, body), 409, 'IDEMPOTENCY_KEY_REUSED');
      assert.equal(row(app, product.id).on_hand, 15);
    }));

  test('lost-response retry: the committed operation is returned even after later changes made its version stale', () =>
    withApp(async (app) => {
      const { account, c, product } = await setup(app);
      const lost = op('receipt', { quantity: 20 }, 1);
      assert.equal((await adjust(c, product.id, lost)).status, 201); // response "lost"
      assert.equal((await adjust(c, product.id, op('correction_delta', { delta: -2 }, 2))).status, 201);
      const retry = await adjust(c, product.id, lost);
      assert.equal(retry.status, 200, retry.body);
      assert.equal(retry.json.replayed, true);
      assert.equal(retry.json.operation.onHandAfter, 20, 'original committed result');
      assert.equal(retry.json.product.onHand, 18, 'current state');
      assert.equal(ledgerCount(app, product.id), 2);
      // The replay still requires current eligibility.
      app.clock.advance(16 * MIN);
      expectCode(await adjust(c, product.id, lost), 401, 'UNAUTHENTICATED');
      const c2 = await signedIn(app, account);
      app.clock.advance(14 * MIN);
      await c2.request('GET', '/api/v1/auth/me');
      app.clock.advance(2 * MIN);
      expectCode(await adjust(c2, product.id, lost), 428, 'RECENT_AUTH_REQUIRED');
      // Keys are scoped to the administrator: another admin's identical body is a NEW operation (stale here).
      const other = await signedIn(app, await createAdmin(app));
      expectCode(await adjust(other, product.id, lost), 409, 'VERSION_CONFLICT');
    }));

  test('a failure of the ledger insert, the balance update or the audit write rolls back everything', () =>
    withApp(async (app) => {
      const { c, product } = await setup(app);
      assert.equal((await adjust(c, product.id, op('receipt', { quantity: 10 }, 1))).status, 201);
      for (const trigger of [
        "CREATE TRIGGER t_fail BEFORE INSERT ON inventory_ledger BEGIN SELECT RAISE(ABORT, 'simulated ledger failure'); END",
        "CREATE TRIGGER t_fail BEFORE UPDATE OF on_hand ON products BEGIN SELECT RAISE(ABORT, 'simulated balance failure'); END",
        "CREATE TRIGGER t_fail BEFORE INSERT ON audit_logs WHEN NEW.action = 'inventory.adjusted' BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END",
      ]) {
        const before = row(app, product.id);
        const ledgers = ledgerCount(app, product.id);
        const audits = count(app, "SELECT count(*) FROM audit_logs WHERE action = 'inventory.adjusted'");
        app.fixtureDb.exec(trigger);
        const body = op('receipt', { quantity: 5 }, before.version);
        assert.equal((await adjust(c, product.id, body)).status, 500);
        app.fixtureDb.exec('DROP TRIGGER t_fail');
        assert.deepEqual(row(app, product.id), before);
        assert.equal(ledgerCount(app, product.id), ledgers);
        assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'inventory.adjusted'"), audits);
        // The key was not consumed by the failed attempt: the same request can now succeed.
        assert.equal((await adjust(c, product.id, body)).status, 201);
        const after = row(app, product.id);
        // Undo for the next round with a compensating correction.
        assert.equal((await adjust(c, product.id, op('correction_delta', { delta: -5 }, after.version, { reason: 'إلغاء تجربة' }))).status, 201);
      }
    }));
});

describe('reads, pagination and trader view', () => {
  test('inventory list: numbers, status, filters, sorts, stable pagination and cursor scope; ledger pagination', () =>
    withApp(async (app) => {
      const { c } = await setup(app, { name: 'منتج 0' });
      const ids: string[] = [];
      for (let i = 1; i <= 6; i++) {
        const p = (await c.request('POST', '/api/v1/admin/products', { body: { name: `منتج ${i}`, brand: 'B', category: 'candy', cartonPriceCents: 100, packSize: 1, minimumCartons: 1 } })).json.product;
        ids.push(p.id);
        await adjust(c, p.id, op('receipt', { quantity: i * 4 }, 1));
      }
      const list = await c.request('GET', '/api/v1/admin/inventory?sort=available_desc&limit=100');
      assert.deepEqual(list.json.items.map((i: any) => i.available), [24, 20, 16, 12, 8, 4, 0]);
      const top = list.json.items[0];
      assert.deepEqual([top.onHand, top.reserved, top.available, top.status, top.product.active], [24, 0, 24, 'normal', false], 'inactive products included');
      assert.deepEqual((await c.request('GET', '/api/v1/admin/inventory?status=low_stock&sort=available_asc')).json.items.map((i: any) => i.available), [4, 8]);
      assert.deepEqual((await c.request('GET', '/api/v1/admin/inventory?status=out_of_stock')).json.items.map((i: any) => i.available), [0]);
      for (const bad of ['sort=on_hand', 'status=empty', 'limit=0', 'reserved=1', 'q=']) expectCode(await c.request('GET', `/api/v1/admin/inventory?${bad}`), 400, 'VALIDATION_FAILED');
      for (const sort of ['name', 'available_asc', 'available_desc', 'updated']) {
        const seen: string[] = [];
        let cursor: string | null = null;
        let guard = 0;
        do {
          const r = await c.request('GET', `/api/v1/admin/inventory?sort=${sort}&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
          seen.push(...r.json.items.map((i: any) => i.product.id));
          cursor = r.json.nextCursor;
        } while (cursor && ++guard < 10);
        const all = (await c.request('GET', `/api/v1/admin/inventory?sort=${sort}&limit=100`)).json.items.map((i: any) => i.product.id);
        assert.deepEqual(seen, all, sort);
      }
      // Ledger: 7 movements on one product, paginated newest first.
      const p = ids[0]!;
      for (let i = 0; i < 6; i++) await adjust(c, p, op('receipt', { quantity: 1 }, row(app, p).version));
      const pages: number[] = [];
      let cursor: string | null = null;
      do {
        const r = await c.request('GET', `/api/v1/admin/inventory/${p}/ledger?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        pages.push(...r.json.items.map((e: any) => e.id));
        cursor = r.json.nextCursor;
      } while (cursor);
      assert.equal(pages.length, 7);
      assert.deepEqual(pages, [...pages].sort((a, b) => b - a));
      const firstPage = await c.request('GET', `/api/v1/admin/inventory/${p}/ledger?limit=2`);
      expectCode(await c.request('GET', `/api/v1/admin/inventory/${ids[1]}/ledger?limit=2&cursor=${encodeURIComponent(firstPage.json.nextCursor)}`), 400, 'VALIDATION_FAILED');
      const other = await signedIn(app, await createAdmin(app));
      expectCode(await other.request('GET', `/api/v1/admin/inventory/${p}/ledger?limit=2&cursor=${encodeURIComponent(firstPage.json.nextCursor)}`), 400, 'VALIDATION_FAILED');
      expectCode(await c.request('GET', `/api/v1/admin/inventory/${randomUUID()}/ledger`), 404, 'NOT_FOUND');
    }));

  test('traders see only the status; boundaries 0, 1, 10, 11 with the default threshold', () =>
    withApp(async (app) => {
      const { c, product } = await setup(app);
      const active = await c.request('PATCH', `/api/v1/admin/products/${product.id}`, { body: { expectedVersion: 1, active: true } });
      let version = active.json.product.version;
      const t = await signedIn(app, await createTrader(app));
      const view = async () => (await t.request('GET', `/api/v1/products/${product.id}`));
      const first = await view();
      assert.equal(first.json.product.availability.status, 'out_of_stock', 'available 0');
      for (const [total, expected] of [[1, 'low_stock'], [10, 'low_stock'], [11, 'normal'], [0, 'out_of_stock']] as const) {
        const r = await adjust(c, product.id, op('set_total', { total }, version));
        assert.equal(r.status, 201, r.body);
        version = r.json.product.version;
        const v = await view();
        assert.equal(v.json.product.availability.status, expected, `available ${total}`);
        assert.ok(!/onHand|reserved|"available":\d/.test(v.body), 'no exact counts for traders');
      }
      const catalog = await t.request('GET', '/api/v1/products');
      assert.ok(!/onHand|reserved|"available":\d/.test(catalog.body));
    }));
});
