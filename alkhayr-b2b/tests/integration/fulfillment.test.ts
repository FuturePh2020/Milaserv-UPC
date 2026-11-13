import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { Client, count, createAdmin, createTrader, startTestApp, type TestApp } from '../helpers/app.ts';
import { insertOrder } from '../helpers/database.ts';

// Synthetic accounts, products and orders only. Everything goes through the real HTTP API; the
// fixture connection is used only to inspect rows, inject failures and attempt raw SQL bypasses.
const MIN = 60_000;
let ipSeq = 0;
const ip = () => `100.70.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const RELAXED = { order_create_account: { limit: 10_000, windowMs: 600_000 }, api_ip: { limit: 100_000, windowMs: 60_000 } };

function expectCode(r: { status: number; json: any; body?: string }, status: number, code: string) {
  assert.equal(r.status, status, r.body ?? JSON.stringify(r.json));
  assert.equal(r.json?.error?.code, code);
}

async function withApp(fn: (app: TestApp) => Promise<void>, options: Parameters<typeof startTestApp>[0] = {}) {
  const app = await startTestApp({ rules: RELAXED, ...options });
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

async function signedIn(app: TestApp, account: { username: string; password: string; code?: (o?: number) => string }, offset = 0) {
  const c = new Client(app, ip());
  const r = await c.login(account.username, account.password, account.code?.(offset));
  assert.equal(r.status, 200, r.body);
  return c;
}

interface Product {
  id: string;
  price: number;
  pack: number;
}

async function world(app: TestApp) {
  const admin = await createAdmin(app);
  const ac = await signedIn(app, admin);
  let seq = 0;
  const version = (id: string) => (app.fixtureDb.prepare('SELECT version FROM products WHERE id = ?').get(id) as { version: number }).version;
  async function product(spec: { stock?: number; price?: number; pack?: number; category?: string } = {}): Promise<Product> {
    const price = spec.price ?? 10_000;
    const pack = spec.pack ?? 24;
    const r = await ac.request('POST', '/api/v1/admin/products', {
      body: { name: `منتج ${++seq}`, brand: 'براند', category: spec.category ?? 'chocolate', cartonPriceCents: price, packSize: pack, minimumCartons: 1 },
    });
    assert.equal(r.status, 201, r.body);
    const id = r.json.product.id as string;
    if ((spec.stock ?? 100) > 0) await receive(id, spec.stock ?? 100);
    const a = await ac.request('PATCH', `/api/v1/admin/products/${id}`, { body: { expectedVersion: version(id), active: true } });
    assert.equal(a.status, 200, a.body);
    return { id, price, pack };
  }
  async function receive(id: string, quantity: number) {
    const s = await ac.request('POST', `/api/v1/admin/inventory/${id}/adjustments`, {
      body: { type: 'receipt', quantity, expectedVersion: version(id), operationKey: randomUUID(), reason: 'استلام للاختبار' },
    });
    assert.equal(s.status, 201, s.body);
  }
  async function trader() {
    const account = await createTrader(app);
    return { account, c: await signedIn(app, account) };
  }
  async function order(c: Client, lines: Array<[Product, number]>) {
    const r = await c.request('POST', '/api/v1/orders', {
      body: {
        requestKey: randomUUID(),
        expectedTerms: (() => {
          const t = app.fixtureDb.prepare('SELECT shipping_cents, shipping_taxable, tax_bps FROM business_settings WHERE id = 1').get() as { shipping_cents: number; shipping_taxable: number; tax_bps: number };
          return { shippingCents: t.shipping_cents, shippingTaxable: t.shipping_taxable === 1, taxBps: t.tax_bps };
        })(),
        items: lines.map(([p, cartons]) => ({ productId: p.id, cartons, expectedCartonPriceCents: p.price, expectedPackSize: p.pack })),
      },
    });
    assert.equal(r.status, 201, r.body);
    return r.json.order as { id: string; version: number; [k: string]: any };
  }
  return { admin, ac, product, receive, trader, order, version };
}

type Body = Record<string, unknown>;
const transition = (c: Client, orderId: string, body: Body) => c.request('POST', `/api/v1/admin/orders/${orderId}/transitions`, { body });
const op = (to: string, expectedVersion: number, extra: Body = {}): Body => ({ to, expectedVersion, operationKey: randomUUID(), ...(to === 'cancelled' ? { reason: 'طلب التاجر الإلغاء' } : {}), ...extra });
const stock = (app: TestApp, id: string) => ({ ...(app.fixtureDb.prepare('SELECT on_hand, reserved, version FROM products WHERE id = ?').get(id) as object) }) as { on_hand: number; reserved: number; version: number };
const allocations = (app: TestApp, orderId: string) =>
  (app.fixtureDb.prepare('SELECT product_id, quantity, status FROM order_allocations WHERE order_id = ? ORDER BY product_id').all(orderId) as Array<Record<string, unknown>>).map((r) => ({ ...r }));
const orderState = (app: TestApp, id: string) => ({ ...(app.fixtureDb.prepare('SELECT state, version FROM orders WHERE id = ?').get(id) as object) }) as { state: string; version: number };
const totals = (app: TestApp) =>
  ['inventory_ledger', 'order_allocations', 'order_events'].map((t) => count(app, `SELECT count(*) FROM ${t}`)).concat(
    count(app, "SELECT count(*) FROM audit_logs WHERE action LIKE 'order.%'"),
    count(app, 'SELECT coalesce(sum(reserved), 0) FROM products'),
    count(app, 'SELECT coalesce(sum(on_hand), 0) FROM products'),
    count(app, 'SELECT coalesce(sum(version), 0) FROM orders'),
  );

async function advance(c: Client, orderId: string, path: string[]) {
  let v = (await c.request('GET', `/api/v1/admin/orders/${orderId}`)).json.order.version as number;
  for (const to of path) {
    const r = await transition(c, orderId, op(to, v));
    assert.equal(r.status, 201, `${to}: ${r.body}`);
    v = r.json.order.version;
  }
  return v;
}

describe('access control', () => {
  test('anonymous, trader, pending and suspended users are denied; reads need a live admin, transitions recent authentication', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product();
      const t = await w.trader();
      const o = await w.order(t.c, [[p, 2]]);
      const paths = ['/api/v1/admin/orders', `/api/v1/admin/orders/${o.id}`];
      const anon = new Client(app, ip());
      for (const path of paths) expectCode(await anon.request('GET', path), 401, 'UNAUTHENTICATED');
      expectCode(await transition(anon, o.id, op('confirmed', 1)), 401, 'UNAUTHENTICATED');
      for (const status of ['approved', 'pending'] as const) {
        const other = await signedIn(app, await createTrader(app, { status }));
        for (const path of paths) expectCode(await other.request('GET', path), 403, 'FORBIDDEN');
        expectCode(await transition(other, o.id, op('confirmed', 1)), 403, 'FORBIDDEN');
      }
      expectCode(await t.c.request('GET', `/api/v1/admin/orders/${o.id}`), 403, 'FORBIDDEN');
      app.fixtureDb.prepare("UPDATE merchants SET status = 'suspended', access_version = access_version + 1, version = version + 1 WHERE id = ?").run(t.account.merchantId);
      app.fixtureDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.account.id);
      expectCode(await t.c.request('GET', '/api/v1/admin/orders'), 401, 'UNAUTHENTICATED');
      expectCode(await w.ac.request('POST', `/api/v1/admin/orders/${o.id}/transitions`, { body: op('confirmed', 1), csrf: null }), 403, 'CSRF_FAILED');
      expectCode(await w.ac.request('POST', `/api/v1/admin/orders/${o.id}/transitions`, { body: op('confirmed', 1), headers: { Origin: 'https://evil.example' } }), 403, 'ORIGIN_REJECTED');
      expectCode(await w.ac.request('POST', `/api/v1/admin/orders/${o.id}/transitions`, { rawBody: JSON.stringify(op('confirmed', 1)), headers: { 'Content-Type': 'text/plain' } }), 415, 'UNSUPPORTED_MEDIA_TYPE');

      app.clock.advance(10 * MIN);
      await w.ac.request('GET', '/api/v1/auth/me');
      app.clock.advance(6 * MIN);
      assert.equal((await w.ac.request('GET', '/api/v1/admin/orders')).status, 200);
      assert.equal((await w.ac.request('GET', `/api/v1/admin/orders/${o.id}`)).status, 200);
      expectCode(await transition(w.ac, o.id, op('confirmed', 1)), 428, 'RECENT_AUTH_REQUIRED');
      assert.deepEqual(orderState(app, o.id), { state: 'pending', version: 1 });
      const fresh = await signedIn(app, w.admin, 1);
      // Re-authenticated: the request now passes every access check and reaches the business rules
      // (this buyer was suspended above, so the confirmation itself is refused).
      expectCode(await transition(fresh, o.id, op('confirmed', 1)), 409, 'BUYER_NOT_APPROVED');
      const t2 = await w.trader();
      const o2 = await w.order(t2.c, [[p, 1]]);
      assert.equal((await transition(fresh, o2.id, op('confirmed', 1))).status, 201);
    }));

  test('logout, suspension and recent-authentication expiry while the body is in flight prevent the transition', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product();
      const t = await w.trader();
      const o = await w.order(t.c, [[p, 2]]);
      const before = totals(app);
      const r1 = await w.ac.requestSlow('POST', `/api/v1/admin/orders/${o.id}/transitions`, op('confirmed', 1), () => {
        app.fixtureDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(w.admin.id);
      });
      expectCode(r1, 401, 'UNAUTHENTICATED');
      // Administrators cannot be suspended through the merchant controls; a suspension at the
      // database level revokes their sessions in the same way.
      app.clock.advance(30_000);
      const c2 = await signedIn(app, w.admin);
      const r2 = await c2.requestSlow('POST', `/api/v1/admin/orders/${o.id}/transitions`, op('confirmed', 1), () => {
        app.fixtureDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(w.admin.id);
      });
      expectCode(r2, 401, 'UNAUTHENTICATED');
      app.clock.advance(30_000);
      const c3 = await signedIn(app, w.admin);
      app.clock.advance(14 * MIN + 50_000);
      await c3.request('GET', '/api/v1/auth/me');
      const r3 = await c3.requestSlow('POST', `/api/v1/admin/orders/${o.id}/transitions`, op('confirmed', 1), () => app.clock.advance(20_000));
      expectCode(r3, 428, 'RECENT_AUTH_REQUIRED');
      assert.deepEqual(totals(app), before);
      assert.deepEqual(orderState(app, o.id), { state: 'pending', version: 1 });
    }));

  test('strict transition body: internal fields, unknown targets and missing cancellation reason are rejected', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product();
      const t = await w.trader();
      const o = await w.order(t.c, [[p, 2]]);
      const bad: Body[] = [
        ...['actorUserId', 'merchantId', 'fromState', 'state', 'priceCents', 'totalCents', 'onHand', 'reserved', 'quantity', 'cartons', 'items', 'version', 'orderId'].map((f) => op('confirmed', 1, { [f]: 1 })),
        op('pending', 1),
        op('archived', 1),
        { to: 'confirmed', expectedVersion: '1', operationKey: randomUUID() },
        { to: 'confirmed', expectedVersion: 1.5, operationKey: randomUUID() },
        { to: 'confirmed', expectedVersion: 1 },
        { to: 'confirmed', expectedVersion: 1, operationKey: randomUUID().toUpperCase() },
        { to: 'cancelled', expectedVersion: 1, operationKey: randomUUID() },
        { to: 'cancelled', expectedVersion: 1, operationKey: randomUUID(), reason: '  ' },
        { to: 'cancelled', expectedVersion: 1, operationKey: randomUUID(), reason: 'س'.repeat(301) },
        { to: 'cancelled', expectedVersion: 1, operationKey: randomUUID(), reason: 'سبب‮' },
      ];
      for (const body of bad) expectCode(await transition(w.ac, o.id, body), 400, 'VALIDATION_FAILED');
      expectCode(await transition(w.ac, randomUUID(), op('confirmed', 1)), 404, 'NOT_FOUND');
      expectCode(await transition(w.ac, 'not-a-uuid', op('confirmed', 1)), 404, 'NOT_FOUND');
      expectCode(await w.ac.request('POST', `/api/v1/admin/orders/${o.id}/transitions`, { rawBody: JSON.stringify({ ...op('confirmed', 1), pad: 'x'.repeat(5000) }) }), 413, 'PAYLOAD_TOO_LARGE');
      for (const m of ['PATCH', 'PUT', 'DELETE']) expectCode(await w.ac.request(m, `/api/v1/admin/orders/${o.id}`), 405, 'METHOD_NOT_ALLOWED');
      assert.deepEqual(orderState(app, o.id), { state: 'pending', version: 1 });
    }));
});

describe('state machine and stock movements', () => {
  test('full lifecycle: reserve on confirm, no movement on prepare, one deduction on ship, none on delivery', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 40 });
      const q = await w.product({ stock: 10 });
      const t = await w.trader();
      const o = await w.order(t.c, [[p, 12], [q, 3]]);
      const s0 = [stock(app, p.id), stock(app, q.id)];
      assert.deepEqual([s0[0]!.on_hand, s0[0]!.reserved, s0[1]!.on_hand, s0[1]!.reserved], [40, 0, 10, 0]);

      const c = await transition(w.ac, o.id, op('confirmed', 1));
      assert.equal(c.status, 201, c.body);
      assert.deepEqual({ ...c.json.operation, eventId: 0, at: 0 }, { eventId: 0, fromState: 'pending', toState: 'confirmed', orderVersionAfter: 2, reason: null, actor: w.admin.username, at: 0 });
      assert.deepEqual([stock(app, p.id).on_hand, stock(app, p.id).reserved, stock(app, q.id).on_hand, stock(app, q.id).reserved], [40, 12, 10, 3]);
      assert.equal(stock(app, p.id).version, s0[0]!.version + 1);
      assert.deepEqual(allocations(app, o.id).map((a) => a.status), ['reserved', 'reserved']);
      assert.deepEqual(c.json.order.items.map((i: any) => i.allocation), [
        { status: 'reserved', quantity: 12, outstanding: 12 },
        { status: 'reserved', quantity: 3, outstanding: 3 },
      ]);
      const ledger = (kind: string) => count(app, 'SELECT count(*) FROM inventory_ledger WHERE order_id = ? AND kind = ?', o.id, kind);
      assert.equal(ledger('reserve'), 2);

      const before = [stock(app, p.id), stock(app, q.id)];
      const ledgerBefore = count(app, 'SELECT count(*) FROM inventory_ledger');
      const prep = await transition(w.ac, o.id, op('preparing', 2));
      assert.equal(prep.status, 201, prep.body);
      assert.deepEqual([stock(app, p.id), stock(app, q.id)], before, 'preparation moves no stock and bumps no product version');
      assert.equal(count(app, 'SELECT count(*) FROM inventory_ledger'), ledgerBefore);

      const ship = await transition(w.ac, o.id, op('shipped', 3));
      assert.equal(ship.status, 201, ship.body);
      assert.deepEqual([stock(app, p.id).on_hand, stock(app, p.id).reserved, stock(app, q.id).on_hand, stock(app, q.id).reserved], [28, 0, 7, 0]);
      assert.deepEqual(allocations(app, o.id).map((a) => a.status), ['consumed', 'consumed']);
      assert.equal(ledger('ship'), 2);
      const shipped = [stock(app, p.id), stock(app, q.id)];

      const del = await transition(w.ac, o.id, op('delivered', 4));
      assert.equal(del.status, 201, del.body);
      assert.deepEqual([stock(app, p.id), stock(app, q.id)], shipped, 'delivery deducts nothing');
      assert.deepEqual(orderState(app, o.id), { state: 'delivered', version: 5 });
      assert.deepEqual(
        del.json.order.events.map((e: any) => [e.fromState, e.toState, e.versionAfter]),
        [[null, 'pending', 1], ['pending', 'confirmed', 2], ['confirmed', 'preparing', 3], ['preparing', 'shipped', 4], ['shipped', 'delivered', 5]],
      );
      assert.deepEqual(del.json.order.allowedTransitions, []);
      const audits = app.fixtureDb.prepare("SELECT metadata FROM audit_logs WHERE action = 'order.transitioned' ORDER BY id").all() as Array<{ metadata: string }>;
      assert.deepEqual(audits.map((a) => JSON.parse(a.metadata).movement), ['reserve', 'none', 'ship', 'none']);
      // The trader sees the history without administrator identities or reasons.
      const own = await t.c.request('GET', `/api/v1/orders/${o.id}`);
      assert.deepEqual(own.json.order.events.map((e: any) => Object.keys(e).sort()), Array(5).fill(['at', 'fromState', 'toState']));
      assert.equal(own.json.order.state, 'delivered');
    }));

  test('every forbidden transition is refused without any change (skipped, backward, repeated, terminal)', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 500 });
      const t = await w.trader();
      const paths: Record<string, string[]> = {
        pending: [],
        confirmed: ['confirmed'],
        preparing: ['confirmed', 'preparing'],
        shipped: ['confirmed', 'preparing', 'shipped'],
        delivered: ['confirmed', 'preparing', 'shipped', 'delivered'],
        cancelled: ['cancelled'],
      };
      const allowed: Record<string, string[]> = { pending: ['confirmed', 'cancelled'], confirmed: ['preparing', 'cancelled'], preparing: ['shipped', 'cancelled'], shipped: ['delivered'], delivered: [], cancelled: [] };
      for (const [state, path] of Object.entries(paths)) {
        const o = await w.order(t.c, [[p, 1]]);
        const v = await advance(w.ac, o.id, path);
        const before = totals(app);
        for (const to of ['confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'].filter((s) => !allowed[state]!.includes(s))) {
          const r = await transition(w.ac, o.id, op(to, v));
          expectCode(r, 409, 'ORDER_STATE_CONFLICT');
          assert.deepEqual(r.json.error.details.current, { order: { state, version: v } }, `${state} -> ${to}`);
        }
        assert.deepEqual(totals(app), before, `${state}: nothing changed`);
      }
    }));

  test('stale versions and simultaneous administrators: exactly one transition commits', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 50 });
      const t = await w.trader();
      const second = await createAdmin(app);
      const ac2 = await signedIn(app, second);
      const o = await w.order(t.c, [[p, 10]]);
      // Confirm vs cancel from the same expected version, concurrently from two administrators.
      const results = await Promise.all([transition(w.ac, o.id, op('confirmed', 1)), transition(ac2, o.id, op('cancelled', 1))]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      const loser = results.find((r) => r.status === 409)!;
      assert.equal(loser.json.error.code, 'VERSION_CONFLICT');
      const state = orderState(app, o.id);
      assert.equal(state.version, 2);
      assert.equal(stock(app, p.id).reserved, state.state === 'confirmed' ? 10 : 0);
      assert.equal(count(app, 'SELECT count(*) FROM order_events WHERE order_id = ?', o.id), 2);
      // A stale version is refused before anything happens.
      const before = totals(app);
      expectCode(await transition(w.ac, o.id, op(state.state === 'confirmed' ? 'preparing' : 'confirmed', 1)), 409, 'VERSION_CONFLICT');
      assert.deepEqual(totals(app), before);
      // Several identical-looking confirmations with different keys: one wins.
      const o2 = await w.order(t.c, [[p, 4]]);
      const many = await Promise.all(Array.from({ length: 6 }, (_, i) => transition(i % 2 ? ac2 : w.ac, o2.id, op('confirmed', 1))));
      assert.deepEqual(many.map((r) => r.status).sort(), [201, 409, 409, 409, 409, 409]);
      assert.deepEqual(allocations(app, o2.id), [{ product_id: p.id, quantity: 4, status: 'reserved' }]);
    }));
});

describe('idempotency', () => {
  test('identical retry replays without reapplying; works after the order advanced; changed content is refused', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 20 });
      const t = await w.trader();
      const o = await w.order(t.c, [[p, 5]]);
      const body = op('confirmed', 1);
      const first = await transition(w.ac, o.id, body);
      assert.equal(first.status, 201);
      const after = totals(app);
      const retry = await transition(w.ac, o.id, body);
      assert.equal(retry.status, 200, retry.body);
      assert.equal(retry.json.replayed, true);
      assert.deepEqual(retry.json.operation, first.json.operation);
      assert.deepEqual(totals(app), after, 'no movement, event or audit row on replay');
      // The order advances further; the original operation is still returned and the CURRENT order is distinct.
      await advance(w.ac, o.id, ['preparing', 'shipped']);
      const late = await transition(w.ac, o.id, body);
      assert.equal(late.status, 200, late.body);
      assert.equal(late.json.operation.toState, 'confirmed');
      assert.equal(late.json.operation.orderVersionAfter, 2);
      assert.equal(late.json.order.state, 'shipped');
      assert.equal(late.json.order.version, 4);
      assert.equal(stock(app, p.id).on_hand, 15);
      // Same key with different content (target, version, reason or order) -> 409, nothing written.
      const other = await w.order(t.c, [[p, 1]]);
      const before = totals(app);
      for (const changed of [{ ...body, to: 'cancelled', reason: 'سبب مختلف' }, { ...body, expectedVersion: 4 }, { ...body, reason: 'سبب إضافي' }]) {
        expectCode(await transition(w.ac, o.id, changed), 409, 'IDEMPOTENCY_KEY_REUSED');
      }
      expectCode(await transition(w.ac, other.id, body), 409, 'IDEMPOTENCY_KEY_REUSED');
      assert.deepEqual(totals(app), before);
      // Replays still require current eligibility (recent authentication).
      app.clock.advance(10 * MIN);
      await w.ac.request('GET', '/api/v1/auth/me'); // keep the session alive (15-minute idle limit)
      app.clock.advance(6 * MIN);
      expectCode(await transition(w.ac, o.id, body), 428, 'RECENT_AUTH_REQUIRED');
    }));

  test('a failed attempt leaves the key reusable; keys are scoped per administrator', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 3 });
      const t = await w.trader();
      const o = await w.order(t.c, [[p, 3]]);
      await w.receive(p.id, 0 + 2); // 5 on hand
      // Another order takes the stock first.
      const rival = await w.order(t.c, [[p, 4]]);
      assert.equal((await transition(w.ac, rival.id, op('confirmed', 1))).status, 201);
      const body = op('confirmed', 1);
      const failed = await transition(w.ac, o.id, body);
      expectCode(failed, 409, 'CONFIRM_STOCK_INSUFFICIENT');
      assert.deepEqual(failed.json.error.details.current.items, [{ productId: p.id, lineNo: 1, requested: 3, available: 1 }]);
      await w.receive(p.id, 2);
      const ok = await transition(w.ac, o.id, body);
      assert.equal(ok.status, 201, ok.body);
      // The same key from another administrator is a different operation (refused here only by the version).
      const second = await createAdmin(app);
      const ac2 = await signedIn(app, second);
      expectCode(await transition(ac2, o.id, body), 409, 'VERSION_CONFLICT');
    }));
});

describe('reservations', () => {
  test('two orders competing for insufficient stock: only one is confirmed; concurrent confirmations never oversell', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 10 });
      const t = await w.trader();
      const a = await w.order(t.c, [[p, 7]]);
      const b = await w.order(t.c, [[p, 6]]);
      const results = await Promise.all([transition(w.ac, a.id, op('confirmed', 1)), transition(w.ac, b.id, op('confirmed', 1))]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal(results.find((r) => r.status === 409)!.json.error.code, 'CONFIRM_STOCK_INSUFFICIENT');
      const s = stock(app, p.id);
      assert.ok(s.reserved === 7 || s.reserved === 6);
      assert.ok(s.reserved <= s.on_hand);
      assert.equal(count(app, 'SELECT count(*) FROM order_allocations'), 1);
    }));

  test('multi-line confirmation where a later line fails reserves nothing', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p1 = await w.product({ stock: 10 });
      const p2 = await w.product({ stock: 10 });
      const p3 = await w.product({ stock: 10 });
      const t = await w.trader();
      const o = await w.order(t.c, [[p1, 5], [p2, 5], [p3, 9]]);
      const rival = await w.order(t.c, [[p3, 5]]);
      assert.equal((await transition(w.ac, rival.id, op('confirmed', 1))).status, 201);
      const before = totals(app);
      const r = await transition(w.ac, o.id, op('confirmed', 1));
      expectCode(r, 409, 'CONFIRM_STOCK_INSUFFICIENT');
      assert.deepEqual(r.json.error.details.current.items, [{ productId: p3.id, lineNo: 3, requested: 9, available: 5 }]);
      assert.deepEqual(totals(app), before);
      assert.deepEqual([stock(app, p1.id).reserved, stock(app, p2.id).reserved], [0, 0]);
    }));

  test('injected failures at ledger, allocation, product, event, order and audit steps roll everything back', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p1 = await w.product({ stock: 10 });
      const p2 = await w.product({ stock: 10 });
      const t = await w.trader();
      const o = await w.order(t.c, [[p1, 2], [p2, 3]]);
      const injections: Array<[string, string]> = [
        ['ledger (second line)', `BEFORE INSERT ON inventory_ledger WHEN NEW.product_id = '${p2.id}' AND NEW.kind = 'reserve'`],
        ['allocation (second line)', `BEFORE INSERT ON order_allocations WHEN NEW.product_id = '${p2.id}'`],
        ['product update (second line)', `BEFORE UPDATE OF reserved ON products WHEN NEW.id = '${p2.id}'`],
        ['event', `BEFORE INSERT ON order_events WHEN NEW.new_state = 'confirmed'`],
        ['order update', `BEFORE UPDATE OF state ON orders WHEN NEW.state = 'confirmed'`],
        ['audit', `BEFORE INSERT ON audit_logs WHEN NEW.action = 'order.transitioned'`],
      ];
      const body = op('confirmed', 1);
      for (const [label, when] of injections) {
        const before = totals(app);
        app.fixtureDb.exec(`CREATE TRIGGER test_injected ${when} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
        try {
          expectCode(await transition(w.ac, o.id, body), 500, 'INTERNAL');
        } finally {
          app.fixtureDb.exec('DROP TRIGGER test_injected');
        }
        assert.deepEqual(totals(app), before, label);
        assert.deepEqual(orderState(app, o.id), { state: 'pending', version: 1 }, label);
      }
      // Same for shipment and cancellation movements.
      assert.equal((await transition(w.ac, o.id, body)).status, 201, 'the key stayed usable');
      await advance(w.ac, o.id, ['preparing']);
      for (const [to, kind] of [['shipped', 'ship'], ['cancelled', 'release']] as const) {
        const before = totals(app);
        app.fixtureDb.exec(`CREATE TRIGGER test_injected BEFORE UPDATE ON order_allocations WHEN NEW.product_id = '${p2.id}' AND NEW.status <> 'reserved' BEGIN SELECT RAISE(ABORT, 'injected'); END`);
        try {
          expectCode(await transition(w.ac, o.id, op(to, 3)), 500, 'INTERNAL');
        } finally {
          app.fixtureDb.exec('DROP TRIGGER test_injected');
        }
        assert.deepEqual(totals(app), before, kind);
        assert.deepEqual(allocations(app, o.id).map((a) => a.status), ['reserved', 'reserved']);
      }
    }));

  test('reservations are attributed per order for shared products; another order’s reservation is never used', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 20 });
      const t = await w.trader();
      const a = await w.order(t.c, [[p, 5]]);
      const b = await w.order(t.c, [[p, 7]]);
      const c = await w.order(t.c, [[p, 7]]);
      await advance(w.ac, a.id, ['confirmed', 'preparing']);
      await advance(w.ac, b.id, ['confirmed']);
      assert.equal(stock(app, p.id).reserved, 12);
      assert.deepEqual(allocations(app, a.id), [{ product_id: p.id, quantity: 5, status: 'reserved' }]);
      assert.deepEqual(allocations(app, b.id), [{ product_id: p.id, quantity: 7, status: 'reserved' }]);
      await advance(w.ac, a.id, ['shipped']);
      assert.deepEqual([stock(app, p.id).on_hand, stock(app, p.id).reserved], [15, 7]);
      assert.deepEqual(allocations(app, b.id), [{ product_id: p.id, quantity: 7, status: 'reserved' }], 'B keeps its reservation');

      // Raw SQL attempts to consume or release reservations that do not belong to the order are refused
      // by the database (migration 0005), although the product's aggregate reserved balance (7) would suffice.
      const s = stock(app, p.id);
      const raw = (orderId: string, kind: string, dOn: number, dRes: number) =>
        app.fixtureDb
          .prepare(
            `INSERT INTO inventory_ledger (product_id, actor_user_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after, order_id, product_version_after, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(p.id, w.admin.id, kind, dOn, dRes, s.on_hand + dOn, s.reserved + dRes, orderId, s.version + 1, app.clock.now());
      assert.throws(() => raw(c.id, 'release', 0, -7), /own outstanding allocation/, 'pending order C owns nothing');
      assert.throws(() => raw(c.id, 'ship', -7, -7), /own outstanding allocation/);
      assert.throws(() => raw(a.id, 'release', 0, -5), /own outstanding allocation|UNIQUE/, 'A was already consumed');
      assert.throws(() => raw(b.id, 'release', 0, -3), /own outstanding allocation/, 'partial release is not an allocation');
      assert.throws(
        () => app.fixtureDb.prepare('UPDATE order_allocations SET status = ? , settle_ledger_id = ?, settled_at = 1 WHERE order_id = ?').run('released', 1, b.id),
        /settled once/,
      );
      // C is confirmed normally from the free stock (available = 15 - 7 = 8 >= 7), with its own allocation.
      await advance(w.ac, c.id, ['confirmed']);
      assert.deepEqual([stock(app, p.id).on_hand, stock(app, p.id).reserved], [15, 14]);
      // Cancelling B releases exactly B's 7, once.
      const vb = orderState(app, b.id).version;
      const cancel = op('cancelled', vb);
      assert.equal((await transition(w.ac, b.id, cancel)).status, 201);
      assert.equal((await transition(w.ac, b.id, cancel)).status, 200);
      expectCode(await transition(w.ac, b.id, op('cancelled', vb + 1)), 409, 'ORDER_STATE_CONFLICT');
      assert.deepEqual([stock(app, p.id).on_hand, stock(app, p.id).reserved], [15, 7]);
      assert.deepEqual(allocations(app, b.id), [{ product_id: p.id, quantity: 7, status: 'released' }]);
      // Reconciliation: reserved = sum of outstanding allocations; per-allocation ledger trail.
      assert.equal(count(app, "SELECT coalesce(sum(quantity), 0) FROM order_allocations WHERE product_id = ? AND status = 'reserved'", p.id), stock(app, p.id).reserved);
    }));

  test('cancellation: pending moves no stock; confirmed and preparing release exactly once, never adding physical stock', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 30 });
      const t = await w.trader();
      const pend = await w.order(t.c, [[p, 4]]);
      const before = stock(app, p.id);
      const ledgerBefore = count(app, 'SELECT count(*) FROM inventory_ledger');
      const r = await transition(w.ac, pend.id, op('cancelled', 1, { reason: 'التاجر ألغى الطلب هاتفيًا' }));
      assert.equal(r.status, 201, r.body);
      assert.deepEqual(stock(app, p.id), before);
      assert.equal(count(app, 'SELECT count(*) FROM inventory_ledger'), ledgerBefore);
      assert.equal(r.json.order.events.at(-1).reason, 'التاجر ألغى الطلب هاتفيًا');
      assert.deepEqual(allocations(app, pend.id), []);
      for (const path of [['confirmed'], ['confirmed', 'preparing']]) {
        const o = await w.order(t.c, [[p, 6]]);
        const v = await advance(w.ac, o.id, path);
        const reserved = stock(app, p.id);
        const body = op('cancelled', v);
        const results = await Promise.all([transition(w.ac, o.id, body), transition(w.ac, o.id, body), transition(w.ac, o.id, op('cancelled', v))]);
        assert.deepEqual(results.map((x) => x.status).sort(), [200, 201, 409]);
        const s = stock(app, p.id);
        assert.deepEqual([s.on_hand, s.reserved], [reserved.on_hand, reserved.reserved - 6], path.join('>'));
        assert.equal(count(app, "SELECT count(*) FROM inventory_ledger WHERE order_id = ? AND kind = 'release'", o.id), 1);
      }
    }));
});

describe('product, packaging and buyer changes', () => {
  test('deactivated product or category blocks confirmation; deactivation after reservation never traps the allocation', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 30 });
      const q = await w.product({ stock: 30, category: 'candy' });
      const t = await w.trader();
      const o1 = await w.order(t.c, [[p, 2]]);
      const o2 = await w.order(t.c, [[q, 2]]);
      const o3 = await w.order(t.c, [[p, 3]]);
      const o4 = await w.order(t.c, [[p, 4]]);
      await advance(w.ac, o3.id, ['confirmed']);
      await advance(w.ac, o4.id, ['confirmed', 'preparing']);
      assert.equal((await w.ac.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: w.version(p.id), active: false } })).status, 200);
      app.fixtureDb.prepare("UPDATE product_categories SET active = 0 WHERE id = 'candy'").run();
      const before = totals(app);
      expectCode(await transition(w.ac, o1.id, op('confirmed', 1)), 409, 'CONFIRM_PRODUCT_UNAVAILABLE');
      expectCode(await transition(w.ac, o2.id, op('confirmed', 1)), 409, 'CONFIRM_PRODUCT_UNAVAILABLE');
      assert.deepEqual(totals(app), before);
      // Already-reserved orders of the inactive product can still be prepared, shipped or cancelled.
      await advance(w.ac, o3.id, ['preparing', 'shipped', 'delivered']);
      assert.equal((await transition(w.ac, o4.id, op('cancelled', 3))).status, 201);
      assert.deepEqual([stock(app, p.id).on_hand, stock(app, p.id).reserved], [27, 0]);
      // Pending orders of the inactive product can be cancelled.
      assert.equal((await transition(w.ac, o1.id, op('cancelled', 1))).status, 201);
    }));

  test('pieces-per-carton is locked while stocked or reserved; a repacked product cannot confirm older orders', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 10, pack: 24 });
      const t = await w.trader();
      const o = await w.order(t.c, [[p, 2]]);
      expectCode(await w.ac.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: w.version(p.id), packSize: 12 } }), 409, 'PACKAGING_LOCKED');
      // Harmless description corrections stay possible while stocked.
      assert.equal((await w.ac.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: w.version(p.id), name: 'اسم مصحح' } })).status, 200);
      // The database refuses a raw repack while stocked, too.
      assert.throws(() => app.fixtureDb.prepare('UPDATE products SET pack_size = 12, version = version + 1 WHERE id = ?').run(p.id), /pack_size cannot change/);
      // While reserved: confirm another order, then try to empty the stock (refused below reserved) and repack.
      const other = await w.order(t.c, [[p, 3]]);
      await advance(w.ac, other.id, ['confirmed']);
      expectCode(
        await w.ac.request('POST', `/api/v1/admin/inventory/${p.id}/adjustments`, { body: { type: 'set_total', total: 0, expectedVersion: w.version(p.id), operationKey: randomUUID(), reason: 'تفريغ' } }),
        422,
        'INVENTORY_BELOW_RESERVED',
      );
      expectCode(await w.ac.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: w.version(p.id), packSize: 12 } }), 409, 'PACKAGING_LOCKED');
      // After the reservation is released and the stock emptied through a traceable adjustment, repacking is allowed.
      assert.equal((await transition(w.ac, other.id, op('cancelled', 2))).status, 201);
      const empty = await w.ac.request('POST', `/api/v1/admin/inventory/${p.id}/adjustments`, {
        body: { type: 'set_total', total: 0, expectedVersion: w.version(p.id), operationKey: randomUUID(), reason: 'تفريغ قبل تغيير التعبئة' },
      });
      assert.equal(empty.status, 201, empty.body);
      assert.equal((await w.ac.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: w.version(p.id), packSize: 12 } })).status, 200);
      await w.receive(p.id, 10);
      const r = await transition(w.ac, o.id, op('confirmed', 1));
      expectCode(r, 409, 'CONFIRM_PACKAGING_CHANGED');
      assert.deepEqual(r.json.error.details.current.items, [{ productId: p.id, lineNo: 1, orderedPackSize: 24, currentPackSize: 12 }]);
      assert.equal(stock(app, p.id).reserved, 0);
      // The old order keeps its snapshot and can only be cancelled.
      const detail = await w.ac.request('GET', `/api/v1/admin/orders/${o.id}`);
      assert.equal(detail.json.order.items[0].packSize, 24);
      assert.equal(detail.json.order.items[0].currentProduct.packSize, 12);
      assert.equal((await transition(w.ac, o.id, op('cancelled', 1))).status, 201);
    }));

  test('buyer suspension: no automatic cancellation or release; confirmation and forward processing blocked; cancel and delivery allowed', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 50 });
      const t = await w.trader();
      const pending = await w.order(t.c, [[p, 2]]);
      const confirmed = await w.order(t.c, [[p, 3]]);
      const preparing = await w.order(t.c, [[p, 4]]);
      const shipped = await w.order(t.c, [[p, 5]]);
      await advance(w.ac, confirmed.id, ['confirmed']);
      await advance(w.ac, preparing.id, ['confirmed', 'preparing']);
      await advance(w.ac, shipped.id, ['confirmed', 'preparing', 'shipped']);
      const m = await w.ac.request('GET', `/api/v1/admin/merchants/${t.account.merchantId}`);
      const suspend = await w.ac.request('PATCH', `/api/v1/admin/merchants/${t.account.merchantId}`, { body: { status: 'suspended', expectedVersion: m.json.merchant.version, reason: 'مخالفة شروط التعامل' } });
      assert.equal(suspend.status, 200, suspend.body);
      const before = totals(app);
      assert.deepEqual([pending, confirmed, preparing, shipped].map((o) => orderState(app, o.id).state), ['pending', 'confirmed', 'preparing', 'shipped']);
      assert.equal(stock(app, p.id).reserved, 7, 'nothing released by the suspension');
      for (const [o, to, v] of [[pending, 'confirmed', 1], [confirmed, 'preparing', 2], [preparing, 'shipped', 3]] as const) {
        const r = await transition(w.ac, o.id, op(to, v));
        expectCode(r, 409, 'BUYER_NOT_APPROVED');
        assert.equal(r.json.error.details.current.buyerStatus, 'suspended');
      }
      assert.deepEqual(totals(app), before);
      assert.equal((await transition(w.ac, shipped.id, op('delivered', 4))).status, 201);
      assert.equal((await transition(w.ac, confirmed.id, op('cancelled', 2))).status, 201);
      assert.equal((await transition(w.ac, preparing.id, op('cancelled', 3))).status, 201);
      assert.equal((await transition(w.ac, pending.id, op('cancelled', 1))).status, 201);
      assert.equal(stock(app, p.id).reserved, 0);
      // A buyer returned to review (pending) is blocked the same way.
      const t3 = await w.trader();
      const o = await w.order(t3.c, [[p, 1]]);
      const buyer = app.fixtureDb.prepare('SELECT merchant_id FROM orders WHERE id = ?').get(o.id) as { merchant_id: string };
      app.fixtureDb.prepare("UPDATE merchants SET status = 'pending', access_version = access_version + 1, version = version + 1 WHERE id = ?").run(buyer.merchant_id);
      expectCode(await transition(w.ac, o.id, op('confirmed', 1)), 409, 'BUYER_NOT_APPROVED');
    }));
});

describe('snapshots, availability and reads', () => {
  test('fulfillment never reprices: price, tax, shipping, buyer and item snapshots are unchanged', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 50, price: 12_345 });
      const t = await w.trader();
      const o = await w.order(t.c, [[p, 3]]);
      const snapshot = (await t.c.request('GET', `/api/v1/orders/${o.id}`)).json.order;
      assert.equal((await w.ac.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: w.version(p.id), cartonPriceCents: 99_999, name: 'اسم جديد' } })).status, 200);
      app.fixtureDb.exec('UPDATE business_settings SET tax_bps = 1400, shipping_cents = 5000, shipping_taxable = 1, version = version + 1');
      assert.equal((await t.c.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, address: 'عنوان آخر تمامًا للمحل' } })).status, 200);
      await advance(w.ac, o.id, ['confirmed', 'preparing', 'shipped', 'delivered']);
      const admin = (await w.ac.request('GET', `/api/v1/admin/orders/${o.id}`)).json.order;
      const own = (await t.c.request('GET', `/api/v1/orders/${o.id}`)).json.order;
      for (const view of [admin, own]) {
        assert.deepEqual(view.amounts, snapshot.amounts);
        assert.deepEqual(view.buyer, snapshot.buyer);
        assert.deepEqual(
          view.items.map((i: any) => ({ ...i, allocation: undefined, currentProduct: undefined })),
          snapshot.items.map((i: any) => ({ ...i, allocation: undefined, currentProduct: undefined })),
        );
      }
      assert.equal(admin.merchant.currentBusinessName, 'محل الاختبار');
    }));

  test('trader availability statuses follow reservations and shipments without disclosing counts', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 15 });
      const t = await w.trader();
      const status = async () => {
        const r = await t.c.request('GET', `/api/v1/products/${p.id}`);
        assert.doesNotMatch(r.body, /onHand|reserved|available"|"stock"/);
        return r.json.product.availability.status;
      };
      assert.equal(await status(), 'normal');
      const o = await w.order(t.c, [[p, 10]]);
      assert.equal(await status(), 'normal', 'pending orders reserve nothing');
      await advance(w.ac, o.id, ['confirmed']);
      assert.equal(await status(), 'low_stock');
      const o2 = await w.order(t.c, [[p, 5]]);
      await advance(w.ac, o2.id, ['confirmed']);
      assert.equal(await status(), 'out_of_stock');
      await advance(w.ac, o2.id, ['preparing', 'shipped']);
      assert.equal(await status(), 'out_of_stock');
      assert.equal((await transition(w.ac, o.id, op('cancelled', 2))).status, 201);
      assert.equal(await status(), 'low_stock'); // 15 - 5 shipped = 10 available, reservation of 10 released
    }));

  test('admin list: filters, search, stable pagination and bound cursors; own-order routes stay scoped', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 500 });
      const a = await w.trader();
      const b = await w.trader();
      app.fixtureDb.prepare("UPDATE merchants SET business_name = 'متجر النور', version = version + 1 WHERE id = ?").run(b.account.merchantId);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        if (i % 2 === 0) app.clock.advance(1000);
        ids.push((await w.order(a.c, [[p, 1]])).id);
      }
      const bo = await w.order(b.c, [[p, 1]]);
      await advance(w.ac, ids[0]!, ['confirmed']);
      const all = await w.ac.request('GET', '/api/v1/admin/orders?limit=100');
      assert.equal(all.json.items.length, 6);
      const expected = (app.fixtureDb.prepare('SELECT id FROM orders ORDER BY created_at DESC, id DESC').all() as Array<{ id: string }>).map((r) => r.id);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const r: any = await w.ac.request('GET', `/api/v1/admin/orders?limit=4${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        assert.equal(r.status, 200, r.body);
        seen.push(...r.json.items.map((o: any) => o.id));
        if (!cursor && r.json.nextCursor) {
          const first = r.json.nextCursor as string;
          const second = await createAdmin(app);
          const ac2 = await signedIn(app, second);
          expectCode(await ac2.request('GET', `/api/v1/admin/orders?limit=4&cursor=${encodeURIComponent(first)}`), 400, 'VALIDATION_FAILED');
          expectCode(await w.ac.request('GET', `/api/v1/admin/orders?limit=4&state=pending&cursor=${encodeURIComponent(first)}`), 400, 'VALIDATION_FAILED');
          expectCode(await w.ac.request('GET', `/api/v1/admin/orders?limit=4&sort=oldest&cursor=${encodeURIComponent(first)}`), 400, 'VALIDATION_FAILED');
        }
        cursor = r.json.nextCursor;
      } while (cursor);
      assert.deepEqual(seen, expected);
      const oldest = await w.ac.request('GET', '/api/v1/admin/orders?sort=oldest&limit=100');
      assert.deepEqual(oldest.json.items.map((o: any) => o.id), [...expected].reverse());
      assert.deepEqual((await w.ac.request('GET', '/api/v1/admin/orders?state=confirmed')).json.items.map((o: any) => o.id), [ids[0]]);
      assert.deepEqual((await w.ac.request('GET', `/api/v1/admin/orders?merchantId=${b.account.merchantId}`)).json.items.map((o: any) => o.id), [bo.id]);
      assert.deepEqual((await w.ac.request('GET', `/api/v1/admin/orders?q=${encodeURIComponent('النور')}`)).json.items.map((o: any) => o.id), [bo.id]);
      assert.deepEqual((await w.ac.request('GET', `/api/v1/admin/orders?q=${encodeURIComponent(bo.displayNumber.toLowerCase())}`)).json.items.map((o: any) => o.id), [bo.id]);
      assert.equal((await w.ac.request('GET', '/api/v1/admin/orders?q=%25')).json.items.length, 0, 'LIKE wildcards are literal');
      assert.equal((await w.ac.request('GET', '/api/v1/admin/orders?demo=true')).json.items.length, 0);
      for (const bad of ['state=archived', 'merchantId=x', 'sort=price', 'limit=0', 'limit=101', 'foo=1', 'state=pending&state=confirmed']) {
        expectCode(await w.ac.request('GET', `/api/v1/admin/orders?${bad}`), 400, 'VALIDATION_FAILED');
      }
      expectCode(await w.ac.request('GET', `/api/v1/admin/orders/${randomUUID()}`), 404, 'NOT_FOUND');
      // Unfinished orders (no creation event) are invisible to administrators as well.
      const unfinished = insertOrder(app.fixtureDb, { userId: a.account.id, merchantId: a.account.merchantId, items: [{ productId: p.id, cartons: 1, unitPrice: p.price }] });
      expectCode(await w.ac.request('GET', `/api/v1/admin/orders/${unfinished}`), 404, 'NOT_FOUND');
      assert.equal((await w.ac.request('GET', '/api/v1/admin/orders?limit=100')).json.items.length, 6);
      expectCode(await transition(w.ac, unfinished, op('cancelled', 1)), 404, 'NOT_FOUND');
      // Own-order routes remain scoped to the caller's merchant (the administrator has no own orders here).
      assert.deepEqual((await w.ac.request('GET', '/api/v1/orders')).json.items, []);
      expectCode(await w.ac.request('GET', `/api/v1/orders/${bo.id}`), 404, 'NOT_FOUND');
      assert.deepEqual((await b.c.request('GET', '/api/v1/orders')).json.items.map((o: any) => o.id), [bo.id]);
      expectCode(await a.c.request('GET', '/api/v1/admin/orders'), 403, 'FORBIDDEN');
    }));

  test('admin detail exposes allocations and current stock; audit metadata is minimal', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 9 });
      const t = await w.trader();
      const o = await w.order(t.c, [[p, 4]]);
      const pendingView = (await w.ac.request('GET', `/api/v1/admin/orders/${o.id}`)).json.order;
      assert.equal(pendingView.items[0].allocation, null);
      assert.deepEqual(pendingView.items[0].currentProduct, { active: true, packSize: 24, onHand: 9, reserved: 0, available: 9 });
      assert.deepEqual(pendingView.allowedTransitions, ['confirmed', 'cancelled']);
      assert.equal(pendingView.merchant.id, t.account.merchantId);
      assert.doesNotMatch(JSON.stringify(pendingView), /digest|[0-9a-f]{64}/);
      await advance(w.ac, o.id, ['confirmed']);
      const r = await transition(w.ac, o.id, op('cancelled', 2, { reason: 'لا يوجد من يستلم الطلب' }));
      const audit = app.fixtureDb.prepare("SELECT target_id, metadata FROM audit_logs WHERE action = 'order.transitioned' ORDER BY id DESC LIMIT 1").get() as { target_id: string; metadata: string };
      assert.equal(audit.target_id, o.id);
      assert.deepEqual(JSON.parse(audit.metadata), { from: 'confirmed', to: 'cancelled', version: 3, event_id: r.json.operation.eventId, movement: 'release', lines_moved: 1 });
      assert.doesNotMatch(audit.metadata, /يستلم/);
    }));
});
