import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { Client, count, createAdmin, createTrader, startTestApp, type TestApp } from '../helpers/app.ts';
import { fixtureAdjustStock, fixtureReserve, insertOrder } from '../helpers/database.ts';
import { computeAmounts } from '../../src/server/services/orders.ts';

// Synthetic accounts, products and orders only. Products are created, stocked and activated through the
// real administrator API; business settings are changed through the fixture connection because the
// settings API arrives in stage 14.
let ipSeq = 0;
const ip = () => `100.80.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const RELAXED = { order_create_account: { limit: 10_000, windowMs: 600_000 } };

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

async function signedIn(app: TestApp, account: { username: string; password: string; code?: (o?: number) => string }) {
  const c = new Client(app, ip());
  const r = await c.login(account.username, account.password, account.code?.());
  assert.equal(r.status, 200, r.body);
  return c;
}

interface ProductSpec {
  name?: string;
  category?: string;
  price?: number;
  pack?: number;
  minimum?: number;
  stock?: number;
  active?: boolean;
  isDemo?: boolean;
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
  async function product(spec: ProductSpec = {}): Promise<Product> {
    const price = spec.price ?? 12_550;
    const pack = spec.pack ?? 24;
    const r = await ac.request('POST', '/api/v1/admin/products', {
      body: {
        name: spec.name ?? `شيكولاتة بالبندق ${++seq}`,
        brand: 'براند الاختبار',
        category: spec.category ?? 'chocolate',
        cartonPriceCents: price,
        packSize: pack,
        minimumCartons: spec.minimum ?? 1,
        ...(spec.isDemo ? { isDemo: true } : {}),
      },
    });
    assert.equal(r.status, 201, r.body);
    let version = 1;
    const stock = spec.stock ?? 100;
    if (stock > 0) {
      const s = await ac.request('POST', `/api/v1/admin/inventory/${r.json.product.id}/adjustments`, {
        body: { type: 'receipt', quantity: stock, expectedVersion: version, operationKey: randomUUID(), reason: 'رصيد افتتاحي للاختبار' },
      });
      assert.equal(s.status, 201, s.body);
      version = s.json.product.version;
    }
    if (spec.active ?? true) {
      const a = await ac.request('PATCH', `/api/v1/admin/products/${r.json.product.id}`, { body: { expectedVersion: version, active: true } });
      assert.equal(a.status, 200, a.body);
    }
    return { id: r.json.product.id, price, pack };
  }
  async function trader(status: 'approved' | 'pending' = 'approved') {
    const account = await createTrader(app, { status });
    return { account, c: await signedIn(app, account) };
  }
  return { admin, ac, product, trader };
}

const line = (p: Product, cartons = 1, extra: Record<string, unknown> = {}) => ({
  productId: p.id,
  cartons,
  expectedCartonPriceCents: p.price,
  expectedPackSize: p.pack,
  ...extra,
});
const orderBody = (items: unknown[], extra: Record<string, unknown> = {}) => ({ requestKey: randomUUID(), items, ...extra });
const place = (c: Client, body: unknown) => c.request('POST', '/api/v1/orders', { body });
const productRow = (app: TestApp, id: string) => ({ ...(app.fixtureDb.prepare('SELECT on_hand, reserved, version, last_ledger_id, price_cents FROM products WHERE id = ?').get(id) as object) });
const orderCount = (app: TestApp) => count(app, 'SELECT count(*) FROM orders') + count(app, 'SELECT count(*) FROM order_items') + count(app, 'SELECT count(*) FROM order_events');
const settings = (app: TestApp, set: string) => app.fixtureDb.exec(`UPDATE business_settings SET ${set}, version = version + 1`);

describe('access and ownership of order creation', () => {
  test('anonymous, missing CSRF, pending and suspended users cannot create orders; nothing is written', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product();
      expectCode(await place(new Client(app, ip()), orderBody([line(p)])), 401, 'UNAUTHENTICATED');
      const pending = await w.trader('pending');
      expectCode(await place(pending.c, orderBody([line(p)])), 403, 'ACCOUNT_PENDING');
      const t = await w.trader();
      expectCode(await t.c.request('POST', '/api/v1/orders', { body: orderBody([line(p)]), csrf: null }), 403, 'CSRF_FAILED');
      app.fixtureDb.prepare("UPDATE merchants SET status = 'suspended', access_version = access_version + 1, version = version + 1 WHERE id = ?").run(t.account.merchantId);
      app.fixtureDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.account.id);
      expectCode(await place(t.c, orderBody([line(p)])), 401, 'UNAUTHENTICATED');
      assert.equal(orderCount(app), 0);
    }));

  test('the order always belongs to the session merchant; target ids in body or headers are rejected or ignored', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product();
      const a = await w.trader();
      const b = await w.trader();
      for (const field of ['merchantId', 'userId', 'actorUserId', 'createdByUserId', 'buyer']) {
        expectCode(await place(a.c, orderBody([line(p)], { [field]: field === 'buyer' ? { businessName: 'x' } : b.account.merchantId })), 400, 'VALIDATION_FAILED');
      }
      const r = await a.c.request('POST', '/api/v1/orders', { body: orderBody([line(p)]), headers: { 'X-Merchant-Id': b.account.merchantId, 'X-User-Id': b.account.id } });
      assert.equal(r.status, 201, r.body);
      const stored = app.fixtureDb.prepare('SELECT merchant_id, created_by_user_id FROM orders WHERE id = ?').get(r.json.order.id) as { merchant_id: string; created_by_user_id: string };
      assert.deepEqual({ ...stored }, { merchant_id: a.account.merchantId, created_by_user_id: a.account.id });
      expectCode(await b.c.request('GET', `/api/v1/orders/${r.json.order.id}`), 404, 'NOT_FOUND');
    }));

  test('an administrator orders only for their own approved profile', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product();
      const r = await place(w.ac, orderBody([line(p, 2)]));
      assert.equal(r.status, 201, r.body);
      assert.equal(r.json.order.buyer.businessName, 'شركة الخير');
      const stored = app.fixtureDb.prepare('SELECT merchant_id FROM orders WHERE id = ?').get(r.json.order.id) as { merchant_id: string };
      assert.equal(stored.merchant_id, w.admin.merchantId);
      const t = await w.trader();
      expectCode(await place(w.ac, orderBody([line(p)], { merchantId: t.account.merchantId })), 400, 'VALIDATION_FAILED');
      // Stage 08 adds no administrator order routes: the trader's orders stay invisible to the admin's own-order list.
      await place(t.c, orderBody([line(p)]));
      const list = await w.ac.request('GET', '/api/v1/orders');
      assert.deepEqual(list.json.items.map((o: { id: string }) => o.id), [r.json.order.id]);
      expectCode(await w.ac.request('GET', '/api/v1/admin/orders'), 404, 'NOT_FOUND');
    }));
});

describe('strict request schema', () => {
  test('server-owned fields, numeric strings, fractions, unsafe/non-finite numbers and malformed lines are rejected', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 500 });
      const q = await w.product({ stock: 500 });
      const { c } = await w.trader();
      const bad: Array<[string, unknown]> = [];
      for (const field of ['state', 'totalCents', 'subtotalCents', 'taxCents', 'taxBps', 'shippingCents', 'reserved', 'isDemo', 'displayNumber', 'version', 'requestDigest', 'createdAt']) {
        bad.push([`top-level ${field}`, orderBody([line(p)], { [field]: field === 'isDemo' ? false : field === 'state' ? 'confirmed' : 0 })]);
      }
      for (const field of ['unitPriceCents', 'lineTotalCents', 'name', 'reserved', 'available', 'isDemo', 'merchantId']) {
        bad.push([`line ${field}`, orderBody([line(p, 1, { [field]: field === 'name' ? 'x' : field === 'isDemo' ? true : 1 })])]);
      }
      const variants: Record<string, unknown>[] = [
        { cartons: '2' },
        { cartons: 1.5 },
        { cartons: 0 },
        { cartons: -1 },
        { cartons: 100_001 },
        { cartons: 2 ** 53 },
        { cartons: null },
        { expectedCartonPriceCents: '12550' },
        { expectedCartonPriceCents: 125.5 },
        { expectedCartonPriceCents: 0 },
        { expectedCartonPriceCents: Number.MAX_SAFE_INTEGER + 2 },
        { expectedPackSize: 24.5 },
        { expectedPackSize: '24' },
        { productId: 'not-a-uuid' },
        { productId: p.id.toUpperCase() },
      ];
      for (const v of variants) bad.push([`line ${JSON.stringify(v)}`, orderBody([{ ...line(p), ...v }])]);
      bad.push(['missing expected price', orderBody([{ productId: p.id, cartons: 1, expectedPackSize: 24 }])]);
      bad.push(['missing expected pack', orderBody([{ productId: p.id, cartons: 1, expectedCartonPriceCents: p.price }])]);
      bad.push(['duplicate lines', orderBody([line(p, 1), line(q, 1), line(p, 2)])]);
      bad.push(['empty items', orderBody([])]);
      bad.push(['items not an array', orderBody({ 0: line(p) } as unknown as unknown[])]);
      bad.push(['missing request key', { items: [line(p)] }]);
      bad.push(['uppercase request key', { requestKey: randomUUID().toUpperCase(), items: [line(p)] }]);
      bad.push(['request key not v4', { requestKey: '00000000-0000-1000-8000-000000000000', items: [line(p)] }]);
      bad.push(['note too long', orderBody([line(p)], { note: 'ن'.repeat(501) })]);
      bad.push(['note not a string', orderBody([line(p)], { note: 5 })]);
      bad.push(['note with control characters', orderBody([line(p)], { note: 'ملاحظة\u0000' })]);
      bad.push(['note with bidi override', orderBody([line(p)], { note: 'ملاحظة ‮abc' })]);
      bad.push(['array body', [line(p)]]);
      for (const [label, body] of bad) {
        const r = await place(c, body);
        assert.equal(r.status, 400, `${label}: ${r.body}`);
        assert.equal(r.json.error.code, 'VALIDATION_FAILED', label);
      }
      // Non-finite numbers cannot be expressed in JSON; an overflowing literal parses to Infinity and is rejected.
      for (const raw of [
        `{"requestKey":"${randomUUID()}","items":[{"productId":"${p.id}","cartons":1e400,"expectedCartonPriceCents":${p.price},"expectedPackSize":24}]}`,
        `{"requestKey":"${randomUUID()}","items":[{"productId":"${p.id}","cartons":NaN,"expectedCartonPriceCents":${p.price},"expectedPackSize":24}]}`,
      ]) {
        const r = await c.request('POST', '/api/v1/orders', { rawBody: raw });
        assert.equal(r.status, 400, r.body);
      }
      const dup = await place(c, orderBody([line(p, 1), line(q, 1), line(p, 2)]));
      assert.deepEqual(dup.json.error.details.fields.map((f: { path: string }) => f.path), ['items.2.productId']);
      assert.equal(orderCount(app), 0);
      // A note is normalized (NFC, trimmed); a blank note is stored as null.
      const ok = await place(c, orderBody([line(p)], { note: '  اتصل قبل التوصيل\n  ' }));
      assert.equal(ok.status, 201, ok.body);
      assert.equal(ok.json.order.note, 'اتصل قبل التوصيل');
      const blank = await place(c, orderBody([line(p)], { note: '   ' }));
      assert.equal(blank.json.order.note, null);
    }));

  test('collection limits are checked before line validation; 100 distinct lines are accepted; oversized bodies are refused', () =>
    withApp(async (app) => {
      const w = await world(app);
      const products: Product[] = [];
      for (let i = 0; i < 100; i++) products.push(await w.product({ stock: 5 }));
      const { c } = await w.trader();
      // 101 lines, every one invalid: a single collection-limit error, no per-line work.
      const tooMany = await place(c, orderBody(Array.from({ length: 101 }, () => ({ productId: 'x', cartons: 'y' }))));
      expectCode(tooMany, 400, 'VALIDATION_FAILED');
      assert.deepEqual(tooMany.json.error.details.fields.map((f: { path: string }) => f.path), ['items']);
      // The limit is checked before ANY other field: an invalid key or note in the same body is not even examined.
      const tooManyAndBadKey = await place(c, { requestKey: 'bad', note: 5, extra: true, items: Array.from({ length: 101 }, () => ({})) });
      assert.deepEqual(tooManyAndBadKey.json.error.details.fields.map((f: { path: string }) => f.path), ['items']);
      const big = await c.request('POST', '/api/v1/orders', { rawBody: JSON.stringify(orderBody([line(products[0]!)], { pad: 'x'.repeat(33 * 1024) })) });
      expectCode(big, 413, 'PAYLOAD_TOO_LARGE');
      const r = await place(c, orderBody(products.map((p) => line(p, 1)), { note: 'ن'.repeat(500) }));
      assert.equal(r.status, 201, r.body);
      assert.equal(r.json.order.items.length, 100);
      assert.deepEqual(r.json.order.items.map((i: { lineNo: number }) => i.lineNo), Array.from({ length: 100 }, (_, i) => i + 1));
      assert.deepEqual(r.json.order.items.map((i: { productId: string }) => i.productId), products.map((p) => p.id));
    }, { rules: { ...RELAXED, api_ip: { limit: 100_000, windowMs: 60_000 } } }));
});

describe('authoritative product rules', () => {
  test('missing, inactive and inactive-category products are indistinguishable; nothing is written', () =>
    withApp(async (app) => {
      const w = await world(app);
      const ok = await w.product();
      const inactive = await w.product({ active: false });
      const inCategory = await w.product({ category: 'candy' });
      const missing: Product = { id: randomUUID(), price: 100, pack: 24 };
      const { c } = await w.trader();
      app.fixtureDb.prepare("UPDATE product_categories SET active = 0 WHERE id = 'candy'").run();
      const bodies = [];
      for (const p of [missing, inactive, inCategory]) {
        const r = await place(c, orderBody([line(ok), line(p)]));
        expectCode(r, 409, 'PRODUCT_UNAVAILABLE');
        assert.deepEqual(r.json.error.details.fields.map((f: { path: string }) => f.path), ['items.1.productId']);
        bodies.push({ ...r.json.error, requestId: null, details: { ...r.json.error.details, current: { items: r.json.error.details.current.items.map(() => 'x') } } });
      }
      assert.deepEqual(bodies[0], bodies[1]);
      assert.deepEqual(bodies[1], bodies[2]);
      assert.equal(orderCount(app), 0);
    }));

  test('stale price or packaging returns the current terms; the trader resubmits with them', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ price: 10_000, pack: 24 });
      const q = await w.product({ price: 20_000, pack: 12 });
      const { c } = await w.trader();
      const priced = await place(c, orderBody([line(p), line({ ...q, price: 19_000 })]));
      expectCode(priced, 409, 'PRICE_CHANGED');
      assert.deepEqual(priced.json.error.details.current.items, [{ productId: q.id, cartonPriceCents: 20_000, packSize: 12 }]);
      const packed = await place(c, orderBody([line({ ...p, pack: 20 })]));
      expectCode(packed, 409, 'PACKAGING_CHANGED');
      assert.deepEqual(packed.json.error.details.current.items, [{ productId: p.id, cartonPriceCents: 10_000, packSize: 24 }]);
      assert.equal(orderCount(app), 0);
      // The client-supplied price is never used for pricing: a correct expectation yields the server price.
      const r = await place(c, orderBody([line(p, 3), line(q, 1)]));
      assert.equal(r.status, 201, r.body);
      assert.deepEqual(r.json.order.items.map((i: { cartonPriceCents: number; lineTotalCents: number }) => [i.cartonPriceCents, i.lineTotalCents]), [
        [10_000, 30_000],
        [20_000, 20_000],
      ]);
    }));

  test('minimum quantity per product is enforced', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ minimum: 5 });
      const { c } = await w.trader();
      const r = await place(c, orderBody([line(p, 4)]));
      expectCode(r, 422, 'MINIMUM_QUANTITY_NOT_MET');
      assert.deepEqual(r.json.error.details.current.items, [{ productId: p.id, minimumCartons: 5 }]);
      assert.equal((await place(c, orderBody([line(p, 5)]))).status, 201);
    }));

  test('insufficient available stock is refused without disclosing counts; reserved stock counts as unavailable', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 7 });
      const { c } = await w.trader();
      const r = await place(c, orderBody([line(p, 8)]));
      expectCode(r, 409, 'INSUFFICIENT_STOCK');
      assert.deepEqual(r.json.error.details.current.items, [{ productId: p.id, availability: { status: 'low_stock', labelAr: r.json.error.details.current.items[0].availability.labelAr } }]);
      assert.doesNotMatch(r.body, /onHand|on_hand|reserved|available"|"7"|:7[,}]/);
      assert.equal((await place(c, orderBody([line(p, 7)]))).status, 201);
      // A pending order reserves nothing: the same 7 cartons can still be ordered by another trader.
      const other = await w.trader();
      assert.equal((await place(other.c, orderBody([line(p, 7)]))).status, 201);
      // Stock committed to confirmed orders (stage 09) is not available (simulated through the ledger fixture).
      const q = await w.product({ stock: 10 });
      fixtureReserve(app.fixtureDb, q.id, 6);
      expectCode(await place(c, orderBody([line(q, 5)])), 409, 'INSUFFICIENT_STOCK');
      assert.equal((await place(c, orderBody([line(q, 4)]))).status, 201);
    }));

  test('creating a pending order changes no stock, reservation, ledger or product version', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 50 });
      const { c } = await w.trader();
      const before = productRow(app, p.id);
      const ledger = count(app, 'SELECT count(*) FROM inventory_ledger');
      const r = await place(c, orderBody([line(p, 10)]));
      assert.equal(r.status, 201, r.body);
      assert.deepEqual(productRow(app, p.id), before);
      assert.equal(count(app, 'SELECT count(*) FROM inventory_ledger'), ledger);
    }));
});

describe('demo classification', () => {
  test('derived from products; mixed orders are refused; the client cannot set it', () =>
    withApp(async (app) => {
      const w = await world(app);
      const real = await w.product();
      const demo = await w.product({ isDemo: true });
      const { c } = await w.trader();
      expectCode(await place(c, orderBody([line(real), line(demo)])), 422, 'MIXED_DEMO_ITEMS');
      expectCode(await place(c, orderBody([line(real)], { isDemo: true })), 400, 'VALIDATION_FAILED');
      const d = await place(c, orderBody([line(demo)]));
      assert.equal(d.status, 201, d.body);
      assert.equal(d.json.order.isDemo, true);
      const r = await place(c, orderBody([line(real)]));
      assert.equal(r.json.order.isDemo, false);
    }));

  test('production refuses demo orders even if a demo product exists', () =>
    withApp(
      async (app) => {
        const w = await world(app);
        const real = await w.product();
        // Demo products cannot be created in production through the API; simulate a leftover row.
        const id = randomUUID();
        const t = app.clock.now();
        app.fixtureDb
          .prepare(
            `INSERT INTO products (id, name, brand, category, price_cents, on_hand, reserved, pack_size, minimum_cartons, active, is_demo, version, created_at, updated_at)
             VALUES (?, 'منتج عرض', 'براند', 'candy', 5000, 0, 0, 24, 1, 0, 1, 1, ?, ?)`,
          )
          .run(id, t, t);
        fixtureAdjustStock(app.fixtureDb, id, 10);
        app.fixtureDb.prepare('UPDATE products SET active = 1, version = version + 1 WHERE id = ?').run(id);
        const { c } = await w.trader();
        expectCode(await place(c, orderBody([line({ id, price: 5000, pack: 24 })])), 422, 'DEMO_NOT_ALLOWED');
        assert.equal((await place(c, orderBody([line(real)]))).status, 201);
      },
      { production: true },
    ));
});

describe('financial calculation', () => {
  test('tax half-up on the configured base, shipping, totals; settings snapshot per order', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ price: 12_345 });
      const q = await w.product({ price: 999 });
      const { c } = await w.trader();
      // Defaults: no tax, no shipping.
      const r0 = await place(c, orderBody([line(p, 3)]));
      assert.deepEqual(r0.json.order.amounts, {
        subtotalCents: 37_035, shippingCents: 0, shippingTaxable: false, taxBps: 0, taxBaseCents: 37_035, taxCents: 0, totalCents: 37_035, minimumOrderCents: 0,
      });
      // 14% tax, shipping not taxable: 37035 + 999*7 = 44028; 44028*0.14 = 6163.92 -> 6164.
      settings(app, 'tax_bps = 1400, shipping_cents = 7500, shipping_taxable = 0');
      const r1 = await place(c, orderBody([line(p, 3), line(q, 7)]));
      assert.deepEqual(r1.json.order.amounts, {
        subtotalCents: 44_028, shippingCents: 7500, shippingTaxable: false, taxBps: 1400, taxBaseCents: 44_028, taxCents: 6164, totalCents: 57_692, minimumOrderCents: 0,
      });
      // Taxable shipping: base 51528 * 0.14 = 7213.92 -> 7214.
      settings(app, 'shipping_taxable = 1');
      const r2 = await place(c, orderBody([line(p, 3), line(q, 7)]));
      assert.equal(r2.json.order.amounts.taxBaseCents, 51_528);
      assert.equal(r2.json.order.amounts.taxCents, 7214);
      assert.equal(r2.json.order.amounts.totalCents, 44_028 + 7500 + 7214);
      // Exactly half rounds up: 25 bps of 200 = 0.5 -> 1; just below half rounds down.
      settings(app, 'tax_bps = 25, shipping_cents = 0, shipping_taxable = 0');
      const half = await w.product({ price: 200 });
      assert.equal((await place(c, orderBody([line(half, 1)]))).json.order.amounts.taxCents, 1);
      const below = await w.product({ price: 199 });
      assert.equal((await place(c, orderBody([line(below, 1)]))).json.order.amounts.taxCents, 0);
      // Earlier orders keep their snapshot.
      const again = await c.request('GET', `/api/v1/orders/${r1.json.order.id}`);
      assert.deepEqual(again.json.order.amounts, r1.json.order.amounts);
    }));

  test('computeAmounts uses exact integer arithmetic beyond 2^53 intermediates', () => {
    const a = computeAmounts([{ price: 100_000_000, cartons: 100_000 }], { shipping_cents: 10_000_000, shipping_taxable: 1, tax_bps: 9999, minimum_order_cents: 0 });
    // base = 1e13 + 1e7; base * 9999 = 99_990_000_099_990_000 (> 2^53), + 5000, / 10000 -> 9_999_000_010_000 (remainder 9_990 + 5000 < 10000? exact check below)
    const base = 10_000_000_000_000n + 10_000_000n;
    assert.equal(a.taxBase, base);
    assert.equal(a.tax, (base * 9999n + 5000n) / 10000n);
    assert.equal(a.total, a.subtotal + a.shipping + a.tax);
    assert.equal(computeAmounts([{ price: 1, cartons: 1 }], { shipping_cents: 0, shipping_taxable: 0, tax_bps: 5000, minimum_order_cents: 0 }).tax, 1n);
    assert.equal(computeAmounts([{ price: 3, cartons: 1 }], { shipping_cents: 0, shipping_taxable: 0, tax_bps: 5000, minimum_order_cents: 0 }).tax, 2n);
  });

  test('order limits are rejected, never clamped; the maximum exact total is accepted', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ price: 100_000_000, stock: 200_000 });
      const q = await w.product({ price: 100_000_000, stock: 200_000 });
      const { c } = await w.trader();
      expectCode(await place(c, orderBody([line(p, 100_000), line(q, 1)])), 422, 'AMOUNT_LIMIT_EXCEEDED');
      const ok = await place(c, orderBody([line(p, 100_000)]));
      assert.equal(ok.status, 201, ok.body);
      assert.equal(ok.json.order.amounts.totalCents, 10_000_000_000_000);
      // The same subtotal plus shipping exceeds the total limit.
      settings(app, 'shipping_cents = 1');
      expectCode(await place(c, orderBody([line(p, 100_000)])), 422, 'AMOUNT_LIMIT_EXCEEDED');
      settings(app, 'shipping_cents = 0, tax_bps = 1');
      expectCode(await place(c, orderBody([line(p, 100_000)])), 422, 'AMOUNT_LIMIT_EXCEEDED');
      assert.equal(count(app, 'SELECT count(*) FROM orders'), 1);
    }));

  test('the minimum order applies to the goods subtotal (shipping and tax excluded)', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ price: 10_000 });
      const { c } = await w.trader();
      settings(app, 'minimum_order_cents = 30000, shipping_cents = 50000, tax_bps = 1400');
      const r = await place(c, orderBody([line(p, 2)]));
      expectCode(r, 422, 'MINIMUM_ORDER_NOT_MET');
      assert.deepEqual(r.json.error.details.current, { minimumOrderCents: 30_000, subtotalCents: 20_000 });
      const ok = await place(c, orderBody([line(p, 3)]));
      assert.equal(ok.status, 201, ok.body);
      assert.equal(ok.json.order.amounts.minimumOrderCents, 30_000);
    }));
});

describe('snapshots', () => {
  test('orders keep product, buyer and settings snapshots after later changes', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ name: 'شيكولاتة الأصل', price: 12_550, pack: 24 });
      const { c } = await w.trader();
      const r = await place(c, orderBody([line(p, 2)], { note: 'التسليم صباحًا' }));
      assert.equal(r.status, 201, r.body);
      const snapshot = r.json.order;
      assert.deepEqual(snapshot.items[0], {
        lineNo: 1, productId: p.id, name: 'شيكولاتة الأصل', brand: 'براند الاختبار', barcode: null, packSize: 24, cartonPriceCents: 12_550, cartons: 2, lineTotalCents: 25_100,
      });
      assert.deepEqual(snapshot.buyer, { businessName: 'محل الاختبار', contactName: 'أحمد علي', phone: '01012345678', governorate: 'القاهرة', address: '12 شارع التجربة' });
      assert.match(snapshot.displayNumber, /^AK-261112-[0-9A-HJKMNP-TV-Z]{6}$/);
      assert.deepEqual(snapshot.events, [{ fromState: null, toState: 'pending', at: snapshot.createdAt }]);
      assert.equal(snapshot.state, 'pending');
      assert.equal(snapshot.version, 1);

      const v = (app.fixtureDb.prepare('SELECT version FROM products WHERE id = ?').get(p.id) as { version: number }).version;
      const patch = await w.ac.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: v, name: 'شيكولاتة جديدة', cartonPriceCents: 15_000, packSize: 12 } });
      assert.equal(patch.status, 200, patch.body);
      const profile = await c.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, address: 'عنوان جديد للمحل في الجيزة' } });
      assert.equal(profile.status, 200, profile.body);
      settings(app, 'tax_bps = 1400, shipping_cents = 9900, shipping_taxable = 1, minimum_order_cents = 100');
      const after = await c.request('GET', `/api/v1/orders/${snapshot.id}`);
      assert.deepEqual(after.json.order, snapshot);
    }));
});

describe('idempotency', () => {
  test('an identical retry returns the original order even after prices, stock, profile and settings changed', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ price: 10_000, stock: 5 });
      const q = await w.product({ price: 3000, stock: 5 });
      const { c } = await w.trader();
      const body = orderBody([line(p, 5), line(q, 1)], { note: 'ملاحظة' });
      const first = await place(c, body);
      assert.equal(first.status, 201, first.body);
      assert.equal(first.json.replayed, false);
      // Change everything that could affect a fresh order.
      const v = (app.fixtureDb.prepare('SELECT version FROM products WHERE id = ?').get(p.id) as { version: number }).version;
      assert.equal((await w.ac.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: v, cartonPriceCents: 11_000, active: false } })).status, 200);
      settings(app, 'tax_bps = 1400, minimum_order_cents = 999999999');
      assert.equal((await c.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, phone: '01099999999' } })).status, 200);
      // Lines in another order and the note with surrounding spaces are the same request.
      const retry = await place(c, { ...body, items: [line(q, 1), line(p, 5)], note: '  ملاحظة ' });
      assert.equal(retry.status, 200, retry.body);
      assert.equal(retry.json.replayed, true);
      assert.deepEqual(retry.json.order, first.json.order);
      assert.equal(count(app, 'SELECT count(*) FROM orders'), 1);
      assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'order.created'"), 1);
    }));

  test('the same key with different content is refused; nothing is written', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product();
      const q = await w.product();
      const { c } = await w.trader();
      const body = orderBody([line(p, 2)]);
      assert.equal((await place(c, body)).status, 201);
      for (const changed of [
        { ...body, items: [line(p, 3)] },
        { ...body, items: [line(p, 2), line(q, 1)] },
        { ...body, items: [line(q, 2)] },
        { ...body, note: 'ملاحظة مختلفة' },
        { ...body, items: [line({ ...p, price: p.price + 1 }, 2)] },
      ]) {
        expectCode(await place(c, changed), 409, 'IDEMPOTENCY_KEY_REUSED');
      }
      assert.equal(count(app, 'SELECT count(*) FROM orders'), 1);
      // The response never exposes the digest.
      const list = await c.request('GET', '/api/v1/orders');
      assert.doesNotMatch(JSON.stringify(list.json), /digest/i);
      const detail = await c.request('GET', `/api/v1/orders/${list.json.items[0].id}`);
      assert.doesNotMatch(detail.body, /digest|[0-9a-f]{64}/);
    }));

  test('a failed attempt leaves the key reusable', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ price: 10_000, stock: 3 });
      const { c } = await w.trader();
      const key = randomUUID();
      expectCode(await place(c, { requestKey: key, items: [line(p, 4)] }), 409, 'INSUFFICIENT_STOCK');
      expectCode(await place(c, { requestKey: key, items: [line({ ...p, price: 9000 }, 1)] }), 409, 'PRICE_CHANGED');
      const ok = await place(c, { requestKey: key, items: [line(p, 3)] });
      assert.equal(ok.status, 201, ok.body);
    }));

  test('keys are scoped per merchant, never global', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product();
      const a = await w.trader();
      const b = await w.trader();
      const key = randomUUID();
      const ra = await place(a.c, { requestKey: key, items: [line(p, 1)] });
      const rb = await place(b.c, { requestKey: key, items: [line(p, 2)] });
      assert.equal(ra.status, 201);
      assert.equal(rb.status, 201, rb.body);
      assert.notEqual(ra.json.order.id, rb.json.order.id);
      assert.equal(rb.json.order.items[0].cartons, 2);
    }));

  test('concurrent identical requests create exactly one order', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product();
      const { c } = await w.trader();
      const body = orderBody([line(p, 2)]);
      const results = await Promise.all(Array.from({ length: 8 }, () => place(c, body)));
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 200, 200, 200, 200, 201]);
      assert.equal(new Set(results.map((r) => r.json.order.id)).size, 1);
      assert.equal(count(app, 'SELECT count(*) FROM orders'), 1);
      assert.equal(count(app, 'SELECT count(*) FROM order_events'), 1);
    }));
});

describe('eligibility at commit', () => {
  test('logout, suspension, return to review and an ABA status change while the body is in flight all prevent the order', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product();
      const cases: Array<[string, (t: { account: { id: string; merchantId: string } }) => void, number, string]> = [
        ['logout', (t) => app.fixtureDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.account.id), 401, 'UNAUTHENTICATED'],
        [
          'returned to review',
          (t) => app.fixtureDb.prepare("UPDATE merchants SET status = 'pending', access_version = access_version + 1, version = version + 1 WHERE id = ?").run(t.account.merchantId),
          403,
          'ACCOUNT_PENDING',
        ],
        [
          'suspended then re-approved (sessions kept by a hypothetical bug)',
          (t) => {
            const set = app.fixtureDb.prepare('UPDATE merchants SET status = ?, access_version = access_version + 1, version = version + 1 WHERE id = ?');
            set.run('suspended', t.account.merchantId);
            set.run('approved', t.account.merchantId);
          },
          409,
          'ACCESS_CHANGED',
        ],
      ];
      for (const [label, midway, status, code] of cases) {
        const t = await w.trader();
        const r = await t.c.requestSlow('POST', '/api/v1/orders', orderBody([line(p)]), () => midway(t));
        assert.equal(r.status, status, `${label}: ${r.body}`);
        assert.equal(r.json.error.code, code, label);
      }
      assert.equal(orderCount(app), 0);
    }));
});

describe('atomicity and audit', () => {
  test('a failure after the header and items were written rolls everything back; the key stays usable', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product();
      const { c } = await w.trader();
      app.fixtureDb.exec("CREATE TRIGGER test_fail_order_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'order.created' BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
      const body = orderBody([line(p, 2)]);
      expectCode(await place(c, body), 500, 'INTERNAL');
      assert.equal(orderCount(app), 0);
      app.fixtureDb.exec('DROP TRIGGER test_fail_order_audit');
      const r = await place(c, body);
      assert.equal(r.status, 201, r.body);
      assert.equal(r.json.replayed, false);
    }));

  test('the audit event is minimal: no note, buyer data or line details', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product();
      const { account, c } = await w.trader();
      const r = await place(c, orderBody([line(p, 2)], { note: 'سر خاص بالتاجر' }));
      const audit = app.fixtureDb.prepare("SELECT actor_user_id, target_type, target_id, metadata FROM audit_logs WHERE action = 'order.created'").get() as Record<string, string>;
      assert.deepEqual(
        { ...audit, metadata: JSON.parse(audit.metadata!) },
        {
          actor_user_id: account.id,
          target_type: 'order',
          target_id: r.json.order.id,
          metadata: { display_number: r.json.order.displayNumber, lines: 1, total_cents: 25_100, is_demo: false },
        },
      );
      assert.doesNotMatch(audit.metadata!, /سر|محل|0101/);
    }));
});

describe('own-order reads', () => {
  test('list and detail show only the own merchant’s finalized orders; foreign and unfinished ids are 404', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product();
      const a = await w.trader();
      const b = await w.trader();
      const ra = await place(a.c, orderBody([line(p, 1)]));
      const rb = await place(b.c, orderBody([line(p, 2)]));
      // An unfinished order (no creation event) written by a fixture is never visible.
      const unfinished = insertOrder(app.fixtureDb, { userId: a.account.id, merchantId: a.account.merchantId, items: [{ productId: p.id, cartons: 1, unitPrice: p.price }] });
      const list = await a.c.request('GET', '/api/v1/orders');
      assert.equal(list.status, 200);
      assert.deepEqual(list.json.items.map((o: { id: string }) => o.id), [ra.json.order.id]);
      assert.deepEqual(Object.keys(list.json.items[0]).sort(), ['cartonCount', 'createdAt', 'displayNumber', 'id', 'isDemo', 'lineCount', 'state', 'totalCents', 'updatedAt']);
      const foreign = await a.c.request('GET', `/api/v1/orders/${rb.json.order.id}`);
      const none = await a.c.request('GET', `/api/v1/orders/${randomUUID()}`);
      const hidden = await a.c.request('GET', `/api/v1/orders/${unfinished}`);
      for (const r of [foreign, none, hidden]) expectCode(r, 404, 'NOT_FOUND');
      assert.equal(foreign.json.error.message, none.json.error.message);
      expectCode(await a.c.request('GET', '/api/v1/orders/not-a-uuid'), 404, 'NOT_FOUND');
      expectCode(await a.c.request('GET', `/api/v1/orders?merchantId=${b.account.merchantId}`), 400, 'VALIDATION_FAILED');
      expectCode(await a.c.request('GET', `/api/v1/orders/${ra.json.order.id}?x=1`), 400, 'VALIDATION_FAILED');
      expectCode(await a.c.request('GET', '/api/v1/orders?state=archived'), 400, 'VALIDATION_FAILED');
      // Pending and anonymous users cannot read orders.
      const pending = await w.trader('pending');
      expectCode(await pending.c.request('GET', '/api/v1/orders'), 403, 'ACCOUNT_PENDING');
      expectCode(await new Client(app, ip()).request('GET', '/api/v1/orders'), 401, 'UNAUTHENTICATED');
      // Order mutation routes do not exist in stage 08.
      for (const m of ['PATCH', 'PUT', 'DELETE']) expectCode(await a.c.request(m, `/api/v1/orders/${ra.json.order.id}`), 405, 'METHOD_NOT_ALLOWED');
    }));

  test('pagination is stable newest-first by (createdAt, id); cursors are bound to user and filter', () =>
    withApp(async (app) => {
      const w = await world(app);
      const p = await w.product({ stock: 1000 });
      const a = await w.trader();
      const b = await w.trader();
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) {
        // Several orders share a timestamp: the id breaks ties.
        if (i % 3 === 0) app.clock.advance(1000);
        ids.push((await place(a.c, orderBody([line(p, 1)]))).json.order.id);
      }
      const rows = app.fixtureDb.prepare('SELECT id FROM orders WHERE merchant_id = ? ORDER BY created_at DESC, id DESC').all(a.account.merchantId) as Array<{ id: string }>;
      const expected = rows.map((r) => r.id);
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const r: { status: number; json: any; body: string } = await a.c.request('GET', `/api/v1/orders?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        assert.equal(r.status, 200, r.body);
        seen.push(...r.json.items.map((o: { id: string }) => o.id));
        cursor = r.json.nextCursor;
        if (pages === 0) {
          const first = cursor as string;
          // Another user, or another filter, cannot reuse the cursor.
          expectCode(await b.c.request('GET', `/api/v1/orders?limit=3&cursor=${encodeURIComponent(first)}`), 400, 'VALIDATION_FAILED');
          expectCode(await a.c.request('GET', `/api/v1/orders?limit=3&state=pending&cursor=${encodeURIComponent(first)}`), 400, 'VALIDATION_FAILED');
          expectCode(await a.c.request('GET', `/api/v1/orders?limit=3&cursor=${encodeURIComponent(first.slice(0, -2) + 'AA')}`), 400, 'VALIDATION_FAILED');
        }
        pages++;
      } while (cursor);
      assert.deepEqual(seen, expected);
      assert.equal(new Set(seen).size, 7);
      assert.equal(pages, 3);
      assert.deepEqual(new Set(seen), new Set(ids));
      const pendingOnly = await a.c.request('GET', '/api/v1/orders?state=pending&limit=100');
      assert.equal(pendingOnly.json.items.length, 7);
      assert.equal((await a.c.request('GET', '/api/v1/orders?state=confirmed')).json.items.length, 0);
    }));
});

describe('abuse limits', () => {
  test('order creation attempts are limited per merchant (default 30 per 10 minutes)', () =>
    withApp(
      async (app) => {
        const w = await world(app);
        const p = await w.product();
        const a = await w.trader();
        const b = await w.trader();
        for (let i = 0; i < 30; i++) assert.notEqual((await place(a.c, { invalid: true })).status, 429);
        const limited = await place(a.c, orderBody([line(p)]));
        expectCode(limited, 429, 'RATE_LIMITED');
        assert.ok(Number(limited.headers['retry-after']) > 0);
        assert.equal((await place(b.c, orderBody([line(p)]))).status, 201);
        app.clock.advance(10 * 60_000);
        assert.equal((await place(a.c, orderBody([line(p)]))).status, 201);
      },
      { rules: {} },
    ));
});
