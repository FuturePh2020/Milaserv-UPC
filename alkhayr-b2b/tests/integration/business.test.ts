import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { parseCsv } from '../../src/server/import/csv.ts';
import { Client, count, createAdmin, createTrader, startTestApp, type TestApp } from '../helpers/app.ts';
import { fixtureTransition, insertMerchant, insertOrder, insertProduct, insertUser } from '../helpers/database.ts';

// Stage 14: settings, quote terms, reports (known dataset with hand-calculated values), order
// summaries, exports, pre-filled templates and the import history. Synthetic data only.
const MIN = 60_000;
let ipSeq = 0;
const ip = () => `100.92.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

function expectCode(r: { status: number; json: any }, status: number, code: string) {
  assert.equal(r.status, status, JSON.stringify(r.json)?.slice(0, 500));
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
async function admin(app: TestApp) {
  const account = await createAdmin(app);
  const c = new Client(app, ip());
  assert.equal((await c.login(account.username, account.password, account.code())).status, 200);
  return { account, c };
}
async function trader(app: TestApp) {
  const account = await createTrader(app);
  const c = new Client(app, ip());
  assert.equal((await c.login(account.username, account.password)).status, 200);
  return { account, c };
}
const settingsRow = (app: TestApp) => app.fixtureDb.prepare('SELECT * FROM business_settings WHERE id = 1').get() as any;
const patch = (c: Client, body: Record<string, unknown>) => c.request('PATCH', '/api/v1/admin/settings', { body });

// ------------------------------------------------------------------ settings

describe('business settings', () => {
  test('reads need a live admin session; changes need recent authentication; traders and anonymous are refused; no secrets exposed', () =>
    withApp(async (app) => {
      const anon = new Client(app, ip());
      expectCode(await anon.request('GET', '/api/v1/admin/settings'), 401, 'UNAUTHENTICATED');
      const t = await trader(app);
      expectCode(await t.c.request('GET', '/api/v1/admin/settings'), 403, 'FORBIDDEN');
      expectCode(await patch(t.c, { expectedVersion: 1, taxBps: 1400 }), 403, 'FORBIDDEN');
      const { c } = await admin(app);
      const r = await c.request('GET', '/api/v1/admin/settings');
      assert.equal(r.status, 200);
      assert.deepEqual(Object.keys(r.json.settings).sort(), ['company', 'lowStockThresholdCartons', 'minimumOrderCents', 'shippingCents', 'shippingTaxable', 'taxBps', 'updatedAt', 'updatedBy', 'version']);
      assert.deepEqual(r.json.settings.company, { name: null, phone: null, email: null, address: null });
      assert.doesNotMatch(r.body, /secret|cookie|password|path|APP_/i);
      app.clock.advance(10 * MIN);
      await c.request('GET', '/api/v1/auth/me');
      app.clock.advance(6 * MIN);
      assert.equal((await c.request('GET', '/api/v1/admin/settings')).status, 200);
      expectCode(await patch(c, { expectedVersion: r.json.settings.version, taxBps: 1400 }), 428, 'RECENT_AUTH_REQUIRED');
      expectCode(await c.request('PATCH', '/api/v1/admin/settings', { body: { expectedVersion: 1, taxBps: 1400 }, csrf: null }), 403, 'CSRF_FAILED');
      assert.equal(settingsRow(app).tax_bps, 0);
    }));

  test('strict validation; unknown fields; version conflict; audit records financial before/after; clear optional company fields', () =>
    withApp(async (app) => {
      const { c, account } = await admin(app);
      const v = () => settingsRow(app).version as number;
      for (const bad of [
        { taxBps: 14.5 }, { taxBps: 10001 }, { taxBps: '1400' }, { shippingCents: -1 }, { shippingCents: 1.5 }, { minimumOrderCents: 1e10 },
        { lowStockThresholdCartons: -1 }, { shippingTaxable: 'yes' }, { companyPhone: '0101' }, { companyEmail: 'x' }, { companyName: 'x' },
        { companyAddress: 'abc' }, { taxNumber: '123' }, { version: 9 }, { updatedBy: 'x' }, {},
      ]) {
        expectCode(await patch(c, { expectedVersion: v(), ...bad }), 400, 'VALIDATION_FAILED');
      }
      const r = await patch(c, { expectedVersion: v(), taxBps: 1400, shippingCents: 5000, shippingTaxable: true, minimumOrderCents: 100000, companyName: 'شركة الخير للتوزيع', companyPhone: '+201012345678' });
      assert.equal(r.status, 200, r.body);
      assert.deepEqual(r.json.changedFields.sort(), ['companyName', 'companyPhone', 'minimumOrderCents', 'shippingCents', 'shippingTaxable', 'taxBps'].sort());
      const s = settingsRow(app);
      assert.deepEqual([s.tax_bps, s.shipping_cents, s.shipping_taxable, s.minimum_order_cents, s.company_name, s.updated_by_user_id], [1400, 5000, 1, 100000, 'شركة الخير للتوزيع', account.id]);
      const audit = JSON.parse((app.fixtureDb.prepare("SELECT metadata FROM audit_logs WHERE action = 'settings.updated'").get() as { metadata: string }).metadata);
      assert.equal(audit.tax_bps_from, 0);
      assert.equal(audit.tax_bps_to, 1400);
      assert.equal(audit.shipping_to, 5000);
      assert.ok(!JSON.stringify(audit).includes('الخير'), 'no free text (company name) in audit metadata');
      expectCode(await patch(c, { expectedVersion: v() - 1, taxBps: 0 }), 409, 'VERSION_CONFLICT');
      assert.equal(settingsRow(app).tax_bps, 1400);
      const cleared = await patch(c, { expectedVersion: v(), companyPhone: null });
      assert.equal(cleared.json.settings.company.phone, null);
      // No change = no version bump.
      const before = v();
      assert.equal((await patch(c, { expectedVersion: before, taxBps: 1400 })).status, 200);
      assert.equal(v(), before);
    }));

  test('recent authentication expiring while the settings change is in flight is caught inside the transaction', () =>
    withApp(async (app) => {
      const { c, account } = await admin(app);
      const r = await c.requestSlow('PATCH', '/api/v1/admin/settings', { expectedVersion: 1, taxBps: 1400 }, () => {
        app.fixtureDb.prepare('UPDATE sessions SET created_at = created_at - 16 * 60000, auth_at = auth_at - 16 * 60000 WHERE user_id = ?').run(account.id);
      });
      expectCode(r, 428, 'RECENT_AUTH_REQUIRED');
      assert.equal(settingsRow(app).tax_bps, 0);
    }));

  test('an audit failure rolls the settings change back', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      app.fixtureDb.exec("CREATE TRIGGER test_fail BEFORE INSERT ON audit_logs WHEN NEW.action = 'settings.updated' BEGIN SELECT RAISE(ABORT, 'injected'); END");
      expectCode(await patch(c, { expectedVersion: 1, taxBps: 1400 }), 500, 'INTERNAL');
      assert.deepEqual([settingsRow(app).tax_bps, settingsRow(app).version], [0, 1]);
      app.fixtureDb.exec('DROP TRIGGER test_fail');
    }));
});

// ------------------------------------------------------------------ settings vs quotes and orders

describe('settings and checkout consistency', () => {
  test('quote uses current settings; stale reviewed terms are refused; committed retry still replays; history unchanged', () =>
    withApp(async (app) => {
      const { c: a } = await admin(app);
      const t = await trader(app);
      const p = insertProduct(app.fixtureDb, { price: 10000, onHand: 100 });
      const items = [{ productId: p, cartons: 2, expectedCartonPriceCents: 10000, expectedPackSize: 24 }];
      const quote = async () => (await t.c.request('POST', '/api/v1/orders/quote', { body: { items } })).json.quote;
      const q1 = await quote();
      assert.deepEqual([q1.amounts.shippingCents, q1.amounts.taxBps, q1.amounts.totalCents], [0, 0, 20000]);
      const terms = (q: any) => ({ shippingCents: q.amounts.shippingCents, shippingTaxable: q.amounts.shippingTaxable, taxBps: q.amounts.taxBps });
      // Order 1 under the original terms.
      const key1 = randomUUID();
      const body1 = { requestKey: key1, items, expectedTerms: terms(q1) };
      const o1 = await t.c.request('POST', '/api/v1/orders', { body: body1 });
      assert.equal(o1.status, 201, o1.body);
      // Review a second quote, then the administrator changes shipping and tax.
      const q2 = await quote();
      const r = await patch(a, { expectedVersion: settingsRow(app).version, shippingCents: 5000, taxBps: 1400, shippingTaxable: true });
      assert.equal(r.status, 200, r.body);
      const stale = await t.c.request('POST', '/api/v1/orders', { body: { requestKey: randomUUID(), items, expectedTerms: terms(q2) } });
      expectCode(stale, 409, 'TERMS_CHANGED');
      assert.deepEqual(stale.json.error.details.current.terms, { shippingCents: 5000, shippingTaxable: true, taxBps: 1400 });
      // A new quote shows the new terms: tax on (20000 + 5000) = 3500.
      const q3 = await quote();
      assert.deepEqual([q3.amounts.shippingCents, q3.amounts.taxBaseCents, q3.amounts.taxCents, q3.amounts.totalCents], [5000, 25000, 3500, 28500]);
      const o2 = await t.c.request('POST', '/api/v1/orders', { body: { requestKey: randomUUID(), items, expectedTerms: terms(q3) } });
      assert.equal(o2.status, 201, o2.body);
      assert.equal(o2.json.order.amounts.totalCents, 28500);
      // The committed first order is replayed for its key even though the terms changed since.
      const replay = await t.c.request('POST', '/api/v1/orders', { body: body1 });
      assert.equal(replay.status, 200, replay.body);
      assert.equal(replay.json.replayed, true);
      assert.equal(replay.json.order.id, o1.json.order.id);
      // History never changes after a settings edit.
      const again = await t.c.request('GET', `/api/v1/orders/${o1.json.order.id}`);
      assert.deepEqual(again.json.order.amounts, o1.json.order.amounts);
      assert.equal(again.json.order.amounts.totalCents, 20000);
      // expectedTerms is required (no bypass by omission).
      expectCode(await t.c.request('POST', '/api/v1/orders', { body: { requestKey: randomUUID(), items } }), 400, 'VALIDATION_FAILED');
      // A raised minimum after review is still refused at creation.
      await patch(a, { expectedVersion: settingsRow(app).version, minimumOrderCents: 1_000_000 });
      expectCode(await t.c.request('POST', '/api/v1/orders', { body: { requestKey: randomUUID(), items, expectedTerms: terms(q3) } }), 422, 'MINIMUM_ORDER_NOT_MET');
    }));

  test('availability labels follow the current threshold exactly at the boundaries', () =>
    withApp(async (app) => {
      const { c: a } = await admin(app);
      const t = await trader(app);
      const ids = { zero: insertProduct(app.fixtureDb, { onHand: 0 }), at: insertProduct(app.fixtureDb, { onHand: 10 }), above: insertProduct(app.fixtureDb, { onHand: 11 }) };
      const label = async (id: string) => (await t.c.request('GET', `/api/v1/products/${id}`)).json.product.availability.status;
      assert.deepEqual([await label(ids.zero), await label(ids.at), await label(ids.above)], ['out_of_stock', 'low_stock', 'normal']);
      await patch(a, { expectedVersion: settingsRow(app).version, lowStockThresholdCartons: 11 });
      assert.deepEqual([await label(ids.at), await label(ids.above)], ['low_stock', 'low_stock']);
      await patch(a, { expectedVersion: settingsRow(app).version, lowStockThresholdCartons: 0 });
      assert.deepEqual([await label(ids.zero), await label(ids.at)], ['out_of_stock', 'normal']);
    }));
});

// ------------------------------------------------------------------ reports (known dataset)

/** Cairo is UTC+3 in September 2026 (summer time). Values below are calculated by hand. */
const CAIRO = (iso: string) => Date.parse(`${iso}+03:00`);

function seed(app: TestApp) {
  const db = app.fixtureDb;
  const m1 = { userId: '', merchantId: '' };
  const m2 = { userId: '', merchantId: '' };
  for (const m of [m1, m2]) {
    m.userId = insertUser(db);
    m.merchantId = insertMerchant(db, m.userId, { status: 'approved' });
  }
  const p1 = insertProduct(db, { name: 'شيكولاتة أ', price: 12550, onHand: 1000 });
  const p2 = insertProduct(db, { name: 'بسكويت ب', price: 999, onHand: 1000 });
  const p3 = randomUUID();
  db.prepare("INSERT INTO products (id, name, brand, category, price_cents, on_hand, reserved, pack_size, minimum_cartons, active, is_demo, version, created_at, updated_at) VALUES (?, 'منتج عرض', 'ب', 'candy', 100, 0, 0, 24, 1, 0, 1, 1, ?, ?)").run(p3, Date.now(), Date.now());
  const o = (who: typeof m1, iso: string, items: Array<[string, number, number]>, extra: Record<string, unknown> = {}) =>
    insertOrder(db, { ...who, finalize: true, createdAt: CAIRO(iso), items: items.map(([productId, cartons, unitPrice]) => ({ productId, cartons, unitPrice })), ...extra });
  const O1 = o(m1, '2026-09-01T00:00:00.000', [[p1, 2, 12550]], { shipping: 5000, shippingTaxable: 1, taxBps: 1400 }); // 25100 + 5000 + 4214 = 34314
  const O2 = o(m1, '2026-09-15T12:00:00.000', [[p2, 3, 999]], { buyerBusinessName: '=HYPERLINK("http://evil","x")' }); // 2997
  const O3 = o(m2, '2026-09-30T23:59:59.999', [[p1, 1, 12550]], { shipping: 5000, taxBps: 1400 }); // 12550 + 5000 + 1757 = 19307
  const O4 = o(m2, '2026-10-01T00:00:00.000', [[p1, 10, 12550]]); // excluded (exclusive end)
  const O5 = o(m1, '2026-08-31T23:59:00.000', [[p2, 1, 999]]); // excluded (before start)
  const O6 = o(m1, '2026-09-10T10:00:00.000', [[p3, 5, 100]], { isDemo: true }); // demo: 500
  const O7 = o(m2, '2026-09-20T09:00:00.000', [[p2, 4, 999]]); // 3996
  fixtureTransition(db, O2, 'confirmed');
  fixtureTransition(db, O3, 'cancelled', { note: 'سبب داخلي للإلغاء' });
  for (const s of ['confirmed', 'preparing', 'shipped']) fixtureTransition(db, O7, s);
  return { m1, m2, p1, p2, p3, O1, O2, O3, O4, O5, O6, O7 };
}

describe('operational reports', () => {
  test('orders by current state: Cairo date boundaries, merchant and demo filters, exact totals (hand-calculated)', () =>
    withApp(async (app) => {
      const d = seed(app);
      const { c } = await admin(app);
      const get = async (qs: string) => {
        const r = await c.request('GET', `/api/v1/admin/reports/orders?${qs}`);
        assert.equal(r.status, 200, r.body);
        return r.json.report;
      };
      const rep = await get('from=2026-09-01&to=2026-09-30');
      const row = (s: string) => rep.states.find((x: any) => x.state === s);
      assert.deepEqual(row('pending'), { state: 'pending', orders: 1, subtotalCents: '25100', shippingCents: '5000', taxCents: '4214', totalCents: '34314' });
      assert.deepEqual(row('confirmed'), { state: 'confirmed', orders: 1, subtotalCents: '2997', shippingCents: '0', taxCents: '0', totalCents: '2997' });
      assert.deepEqual(row('preparing').orders, 0);
      assert.deepEqual(row('shipped'), { state: 'shipped', orders: 1, subtotalCents: '3996', shippingCents: '0', taxCents: '0', totalCents: '3996' });
      assert.deepEqual(row('cancelled'), { state: 'cancelled', orders: 1, subtotalCents: '12550', shippingCents: '5000', taxCents: '1757', totalCents: '19307' });
      assert.deepEqual(rep.notCancelled, { orders: 3, subtotalCents: '32093', shippingCents: '5000', taxCents: '4214', totalCents: '41307' });
      assert.deepEqual([rep.range.timeZone, rep.range.startMs, rep.range.endMsExclusive], ['Africa/Cairo', CAIRO('2026-09-01T00:00:00.000'), CAIRO('2026-10-01T00:00:00.000')]);
      // One-day ranges at both boundaries.
      assert.equal((await get('from=2026-09-30&to=2026-09-30')).states.find((x: any) => x.state === 'cancelled').orders, 1);
      assert.equal((await get('from=2026-10-01&to=2026-10-01')).notCancelled.orders, 1);
      assert.equal((await get('from=2026-08-31&to=2026-08-31')).notCancelled.orders, 1);
      // Merchant and demo filters.
      const m2 = await get(`from=2026-09-01&to=2026-09-30&merchantId=${d.m2.merchantId}`);
      assert.deepEqual([m2.notCancelled.orders, m2.notCancelled.totalCents], [1, '3996']);
      const demo = await get('from=2026-09-01&to=2026-09-30&demo=include');
      assert.deepEqual([demo.notCancelled.orders, demo.notCancelled.totalCents], [4, '41807']);
      const only = await get('from=2026-09-01&to=2026-09-30&demo=only');
      assert.deepEqual([only.notCancelled.orders, only.notCancelled.totalCents], [1, '500']);
      for (const bad of ['from=2026-11-31&to=2026-11-30', 'from=2026-11-10&to=2026-11-01', 'from=2026/11/01&to=2026-11-30', 'to=2026-11-30', 'from=2026-09-01&to=2026-09-30&state=x']) {
        expectCode(await c.request('GET', `/api/v1/admin/reports/orders?${bad}`), 400, 'VALIDATION_FAILED');
      }
    }));

  test('products ordered: ordered cartons and historical line values per explicit states', () =>
    withApp(async (app) => {
      const d = seed(app);
      const { c } = await admin(app);
      const r = (await c.request('GET', '/api/v1/admin/reports/products?from=2026-09-01&to=2026-09-30')).json.report;
      assert.deepEqual(r.filters.states, ['pending', 'confirmed', 'preparing', 'shipped', 'delivered']);
      assert.deepEqual(r.items.map((i: any) => [i.productId, i.orders, i.cartons, i.valueCents]), [[d.p2, 2, '7', '6993'], [d.p1, 1, '2', '25100']]);
      assert.deepEqual(r.totals, { products: 2, cartons: '9', valueCents: '32093' });
      const cancelled = (await c.request('GET', '/api/v1/admin/reports/products?from=2026-09-01&to=2026-09-30&states=cancelled')).json.report;
      assert.deepEqual(cancelled.items.map((i: any) => [i.productId, i.cartons, i.valueCents]), [[d.p1, '1', '12550']]);
      expectCode(await c.request('GET', '/api/v1/admin/reports/products?from=2026-09-01&to=2026-09-30&states=paid'), 400, 'VALIDATION_FAILED');
    }));

  test('inventory and movements: current threshold, exact ledger kinds, ledger timestamps in Cairo days', () =>
    withApp(async (app) => {
      const d = seed(app);
      const { c, account } = await admin(app);
      const inv = (await c.request('GET', '/api/v1/admin/reports/inventory')).json.report;
      const p2 = inv.items.find((i: any) => i.productId === d.p2);
      // p2: 1000 received; O2 confirmed reserves 3; O7 shipped 4 (reserved then consumed).
      assert.deepEqual([p2.onHand, p2.reserved, p2.available, p2.status], [996, 3, 993, 'normal']);
      assert.equal(inv.threshold, 10);
      // Movements through the API at controlled times (app clock: 2026-11-12 09:00 UTC = 11:00 Cairo).
      const created = await c.request('POST', '/api/v1/admin/products', { body: { name: 'منتج الحركات', brand: 'ب', category: 'candy', cartonPriceCents: 100, packSize: 1, minimumCartons: 1 } });
      const pid = created.json.product.id;
      const ver = () => (app.fixtureDb.prepare('SELECT version FROM products WHERE id = ?').get(pid) as { version: number }).version;
      let session = c;
      const relogin = async () => {
        session = new Client(app, ip());
        assert.equal((await session.login(account.username, account.password, account.code())).status, 200);
      };
      const adj = (body: Record<string, unknown>) => session.request('POST', `/api/v1/admin/inventory/${pid}/adjustments`, { body: { ...body, expectedVersion: ver(), operationKey: randomUUID(), reason: 'حركة اختبار' } });
      assert.equal((await adj({ type: 'receipt', quantity: 50 })).status, 201);
      app.clock.set(Date.parse('2026-11-12T21:59:00Z')); // 23:59 Cairo
      await relogin();
      assert.equal((await adj({ type: 'set_total', total: 30 })).status, 201);
      app.clock.set(Date.parse('2026-11-12T22:00:00Z')); // 00:00 Cairo, 13 Nov
      await relogin();
      assert.equal((await adj({ type: 'receipt', quantity: 7 })).status, 201);
      const mv = async (day: string) => (await session.request('GET', `/api/v1/admin/reports/movements?from=${day}&to=${day}&productId=${pid}`)).json.report.items.map((i: any) => [i.type, i.movements, i.onHandDelta, i.reservedDelta]);
      assert.deepEqual(await mv('2026-11-12'), [['correction:set_total', 1, '-20', '0'], ['receipt', 1, '50', '0']]);
      assert.deepEqual(await mv('2026-11-13'), [['receipt', 1, '7', '0']]);
    }));

  test('traders cannot read any report', () =>
    withApp(async (app) => {
      const t = await trader(app);
      for (const p of ['orders?from=2026-09-01&to=2026-09-30', 'products?from=2026-09-01&to=2026-09-30', 'inventory', 'movements?from=2026-09-01&to=2026-09-30']) {
        expectCode(await t.c.request('GET', `/api/v1/admin/reports/${p}`), 403, 'FORBIDDEN');
      }
    }));
});

// ------------------------------------------------------------------ summaries

describe('order summaries', () => {
  test('own merchant and administrators only; snapshot data; no internal data; current company labelled as current', () =>
    withApp(async (app) => {
      const { c: a } = await admin(app);
      const owner = await trader(app);
      const other = await trader(app);
      const p = insertProduct(app.fixtureDb, { onHand: 50 });
      const terms = { shippingCents: 0, shippingTaxable: false, taxBps: 0 };
      const o = await owner.c.request('POST', '/api/v1/orders', { body: { requestKey: randomUUID(), expectedTerms: terms, items: [{ productId: p, cartons: 3, expectedCartonPriceCents: 12550, expectedPackSize: 24 }] } });
      assert.equal(o.status, 201, o.body);
      const id = o.json.order.id;
      const ver = o.json.order.version;
      assert.equal((await a.request('POST', `/api/v1/admin/orders/${id}/transitions`, { body: { to: 'cancelled', expectedVersion: ver, operationKey: randomUUID(), reason: 'سبب داخلي سري' } })).status, 201);
      const mine = await owner.c.request('GET', `/api/v1/orders/${id}/summary`);
      assert.equal(mine.status, 200, mine.body);
      assert.equal(mine.json.summary.kind, 'order_summary');
      assert.equal(mine.json.summary.order.state, 'cancelled');
      assert.equal(mine.json.summary.order.amounts.totalCents, 37650);
      assert.deepEqual(mine.json.summary.company, { name: null, phone: null, email: null, address: null });
      assert.equal(mine.json.summary.companyIsCurrent, true);
      assert.doesNotMatch(mine.body, /سبب داخلي سري|onHand|reserved|allocation|actor|requestKey|"version"/);
      expectCode(await other.c.request('GET', `/api/v1/orders/${id}/summary`), 404, 'NOT_FOUND');
      expectCode(await other.c.request('GET', `/api/v1/admin/orders/${id}/summary`), 403, 'FORBIDDEN');
      expectCode(await new Client(app, ip()).request('GET', `/api/v1/orders/${id}/summary`), 401, 'UNAUTHENTICATED');
      const adm = await a.request('GET', `/api/v1/admin/orders/${id}/summary`);
      assert.equal(adm.status, 200);
      assert.doesNotMatch(adm.body, /سبب داخلي سري/, 'the printable summary has no internal reasons, even for administrators');
      assert.equal(mine.headers['cache-control'], 'no-store');
      await patch(a, { expectedVersion: settingsRow(app).version, companyName: 'شركة الخير', taxBps: 1400 });
      const after = await owner.c.request('GET', `/api/v1/orders/${id}/summary`);
      assert.equal(after.json.summary.company.name, 'شركة الخير');
      assert.deepEqual(after.json.summary.order.amounts, mine.json.summary.order.amounts, 'snapshot amounts unchanged by settings');
    }));
});

// ------------------------------------------------------------------ exports

const exportReq = (c: Client, body: Record<string, unknown>, csrf?: null) => c.request('POST', '/api/v1/admin/exports', { body, ...(csrf === null ? { csrf: null } : {}) });

describe('exports', () => {
  test('recent authentication, CSRF and admin role required; traders refused', () =>
    withApp(async (app) => {
      seed(app);
      const t = await trader(app);
      expectCode(await exportReq(t.c, { type: 'products' }), 403, 'FORBIDDEN');
      const { c } = await admin(app);
      expectCode(await exportReq(c, { type: 'products' }, null), 403, 'CSRF_FAILED');
      expectCode(await exportReq(c, { type: 'everything' }), 400, 'VALIDATION_FAILED');
      app.clock.advance(10 * MIN);
      await c.request('GET', '/api/v1/auth/me');
      app.clock.advance(6 * MIN);
      expectCode(await exportReq(c, { type: 'products' }), 428, 'RECENT_AUTH_REQUIRED');
      assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'export.created'"), 0);
    }));

  test('orders export: summary columns by default, contact data only when selected, formula text neutralized, totals match the report, audited without content', () =>
    withApp(async (app) => {
      seed(app);
      const { c } = await admin(app);
      const r = await exportReq(c, { type: 'orders', filters: { from: '2026-09-01', to: '2026-09-30' } });
      assert.equal(r.status, 200, r.body);
      assert.equal(r.headers['content-type'], 'text/csv; charset=utf-8');
      assert.match(String(r.headers['content-disposition']), /^attachment; filename="alkhayr-orders-\d{8}-\d{4}\.csv"$/);
      assert.equal(r.headers['cache-control'], 'no-store, private');
      assert.ok(r.body.startsWith('﻿'));
      const table = parseCsv(Buffer.from(r.body, 'utf8'));
      assert.ok(table.ok);
      if (!table.ok) return;
      assert.equal(table.table.records.length, 4, 'O1, O2, O3 (cancelled, current state shown) and O7; demo, before and after excluded');
      assert.ok(!table.table.header.includes('الهاتف'));
      const evil = table.table.records.find((x) => x.cells.some((cell) => cell.includes('HYPERLINK')))!;
      assert.ok(evil.cells.includes(`'=HYPERLINK("http://evil","x")`), 'formula-like buyer name prefixed with an apostrophe');
      const totalCol = table.table.header.indexOf('الإجمالي (ج.م)');
      const sumNotCancelled = table.table.records.filter((x) => !x.cells.includes('ملغي')).reduce((s, x) => s + BigInt(x.cells[totalCol]!.replace('.', '')), 0n);
      assert.equal(sumNotCancelled, 41307n, 'export rows reproduce the report total (hand-calculated)');
      const withContact = await exportReq(c, { type: 'orders', includeBuyerContact: true, filters: { from: '2026-09-01', to: '2026-09-30' } });
      assert.match(withContact.body, /الهاتف/);
      assert.match(withContact.body, /01012345678/);
      const audits = app.fixtureDb.prepare("SELECT metadata FROM audit_logs WHERE action = 'export.created' ORDER BY id").all() as Array<{ metadata: string }>;
      assert.equal(audits.length, 2);
      const m = JSON.parse(audits[1]!.metadata);
      assert.deepEqual([m.type, m.rows, m.contact_data], ['orders', 4, true]);
      assert.doesNotMatch(audits.map((x) => x.metadata).join(''), /01012345678|HYPERLINK|محل/);
    }));

  test('report exports reproduce report totals; oversize exports are refused, never truncated', () =>
    withApp(async (app) => {
      seed(app);
      const { c } = await admin(app);
      const rep = await exportReq(c, { type: 'report_orders', filters: { from: '2026-09-01', to: '2026-09-30' } });
      assert.equal(rep.status, 200);
      assert.match(rep.body, /"34314\.00"|"343\.14"/);
      assert.match(rep.body, /"413\.07"/);
      assert.match(rep.body, /ليست إيرادًا محصّلًا/);
      const mv = await exportReq(c, { type: 'report_movements', filters: { from: '2026-01-01', to: '2026-12-31' } });
      assert.equal(mv.status, 200, mv.body);
      // 10 001 finalized orders in one day exceed the 10 000-row cap.
      const u = insertUser(app.fixtureDb);
      const mid = insertMerchant(app.fixtureDb, u, { status: 'approved' });
      const p = insertProduct(app.fixtureDb, { onHand: 0 });
      app.fixtureDb.exec('BEGIN');
      for (let i = 0; i < 10_001; i++) insertOrder(app.fixtureDb, { userId: u, merchantId: mid, finalize: true, displayNumber: `AK-260615-${i.toString(16).toUpperCase().padStart(6, '0')}`, createdAt: CAIRO('2026-06-15T10:00:00.000'), items: [{ productId: p, cartons: 1, unitPrice: 100 }] });
      app.fixtureDb.exec('COMMIT');
      const big = await exportReq(c, { type: 'orders', filters: { from: '2026-06-15', to: '2026-06-15' } });
      expectCode(big, 422, 'EXPORT_TOO_LARGE');
      assert.equal(big.json.error.details.current.rows, 10_001);
      assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'export.created' AND metadata LIKE '%2026-06-15%'"), 0);
    }));
});

// ------------------------------------------------------------------ pre-filled templates + round trip

describe('pre-filled import templates', () => {
  test('canonical template → edit → preview → confirm round trip (Arabic, commas, quotes, newlines, leading zeros, formula-like names)', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const names = ['شيكولاتة، بالبندق "الأصلية"', 'ويفر\nسطرين', '=SUM(1,2)', 'كاندي عادي'];
      const ids = names.map((name) => insertProduct(app.fixtureDb, { name, onHand: 5, barcode: null }));
      const t = await c.request('POST', '/api/v1/admin/imports/templates/prefilled', { body: { mode: 'receive_stock' } });
      assert.equal(t.status, 200, t.body);
      assert.equal(t.headers['x-omitted-display-names'], '1');
      const parsed = parseCsv(Buffer.from(t.body, 'utf8'));
      assert.ok(parsed.ok);
      if (!parsed.ok) return;
      assert.deepEqual(parsed.table.header, ['productId', 'expectedVersion', 'quantity', 'reason', 'currentName', 'reference']);
      const col = (h: string) => parsed.table.header.indexOf(h);
      for (const r of parsed.table.records) {
        assert.equal(r.cells[col('quantity')], '', 'no quantity is pre-filled');
        assert.equal(r.cells[col('reason')], '');
      }
      const byId = new Map(parsed.table.records.map((r) => [r.cells[col('productId')]!, r]));
      assert.equal(byId.get(ids[0]!)!.cells[col('currentName')], names[0]);
      assert.equal(byId.get(ids[1]!)!.cells[col('currentName')], names[1]);
      assert.equal(byId.get(ids[2]!)!.cells[col('currentName')], '', 'formula-like display name omitted, not altered');
      // Operator fills two rows and deletes the rest (re-serialized canonically).
      const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const keep = [ids[0]!, ids[2]!].map((id) => byId.get(id)!.cells.map((cell, i) => (i === col('quantity') ? '12' : i === col('reason') ? 'استلام، فاتورة "7"' : cell)));
      const edited = `﻿${parsed.table.header.map(q).join(',')}\r\n${keep.map((cells) => cells.map(q).join(',')).join('\r\n')}\r\n`;
      const p = await c.request('POST', '/api/v1/admin/imports/preview', { body: { mode: 'receive_stock', file: Buffer.from(edited).toString('base64') } });
      assert.equal(p.json.summary.invalid, 0, JSON.stringify(p.json.rows));
      assert.deepEqual(p.json.rows.flatMap((r: any) => r.warnings), [], 'the exact currentName matches; no mismatch warning');
      const commit = await c.request('POST', '/api/v1/admin/imports/commit', { body: { mode: 'receive_stock', file: Buffer.from(edited).toString('base64'), previewToken: p.json.previewToken, operationKey: randomUUID() } });
      assert.equal(commit.status, 201, commit.body);
      const onHand = (id: string) => (app.fixtureDb.prepare('SELECT on_hand FROM products WHERE id = ?').get(id) as { on_hand: number }).on_hand;
      assert.deepEqual(ids.map(onHand), [17, 5, 17, 5]);
      const reason = (app.fixtureDb.prepare('SELECT reason FROM inventory_ledger ORDER BY id DESC LIMIT 1').get() as { reason: string }).reason;
      assert.equal(reason, 'استلام، فاتورة "7"');

      // Update template: change columns empty (unchanged); a leading-zero barcode typed into the canonical file is kept exactly.
      const u = await c.request('POST', '/api/v1/admin/imports/templates/prefilled', { body: { mode: 'update_products', filters: { q: 'كاندي' } } });
      const up = parseCsv(Buffer.from(u.body, 'utf8'));
      assert.ok(up.ok);
      if (!up.ok) return;
      assert.equal(up.table.records.length, 1);
      const uc = (h: string) => up.table.header.indexOf(h);
      const cells = up.table.records[0]!.cells.map((cell, i) => (i === uc('barcode') ? '000123' : i === uc('name') ? 'كاندي، "مطوّر"' : cell));
      const file = `${up.table.header.map(q).join(',')}\n${cells.map(q).join(',')}\n`;
      const pv = await c.request('POST', '/api/v1/admin/imports/preview', { body: { mode: 'update_products', file: Buffer.from(file).toString('base64') } });
      assert.equal(pv.json.summary.invalid, 0, JSON.stringify(pv.json.rows));
      const cm = await c.request('POST', '/api/v1/admin/imports/commit', { body: { mode: 'update_products', file: Buffer.from(file).toString('base64'), previewToken: pv.json.previewToken, operationKey: randomUUID() } });
      assert.equal(cm.status, 201, cm.body);
      const row = app.fixtureDb.prepare('SELECT name, barcode FROM products WHERE id = ?').get(ids[3]!) as { name: string; barcode: string };
      assert.deepEqual([row.name, row.barcode], ['كاندي، "مطوّر"', '000123']);
      // The template is stale after the change: its version no longer matches.
      const stale = await c.request('POST', '/api/v1/admin/imports/preview', { body: { mode: 'update_products', file: Buffer.from(file).toString('base64') } });
      assert.match(JSON.stringify(stale.json.rows[0].errors), /الإصدار/);
    }));

  test('a VIEW export is not a re-import format: its apostrophe-prefixed text is not stripped by the importer', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const id = insertProduct(app.fixtureDb, { name: '=SUM(1,2)', onHand: 0 });
      const view = await exportReq(c, { type: 'products' });
      assert.match(view.body, /"'=SUM\(1,2\)"/);
      const v = (app.fixtureDb.prepare('SELECT version FROM products WHERE id = ?').get(id) as { version: number }).version;
      const file = `productId,expectedVersion,currentName,brand\n${id},${v},"'=SUM(1,2)",براند جديد\n`;
      const p = await c.request('POST', '/api/v1/admin/imports/preview', { body: { mode: 'update_products', file: Buffer.from(file).toString('base64') } });
      assert.match(p.json.rows[0].warnings.join(' '), /يختلف عن الاسم الحالي/, 'the apostrophe is data; the importer never strips it');
    }));
});

// ------------------------------------------------------------------ import history

describe('import history', () => {
  test('bounded, signed pagination; no keys, digests or file content; traders refused', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const other = await admin(app);
      for (let i = 0; i < 3; i++) {
        const file = Buffer.from(`name,brand,category,cartonPriceEgp,packSize,minimumCartons\nمنتج ${i}x,ب,candy,1,1,1\n`).toString('base64');
        const p = await c.request('POST', '/api/v1/admin/imports/preview', { body: { mode: 'create_products', file } });
        assert.equal((await c.request('POST', '/api/v1/admin/imports/commit', { body: { mode: 'create_products', file, previewToken: p.json.previewToken, operationKey: randomUUID() } })).status, 201);
        app.clock.advance(1000);
      }
      const first = await c.request('GET', '/api/v1/admin/imports?limit=2');
      assert.equal(first.json.items.length, 2);
      assert.ok(first.json.nextCursor);
      assert.doesNotMatch(first.body, /operation_key|operationKey|digest|sha256|previewToken/i);
      const second = await c.request('GET', `/api/v1/admin/imports?limit=2&cursor=${encodeURIComponent(first.json.nextCursor)}`);
      assert.equal(second.json.items.length, 1);
      assert.equal(second.json.nextCursor, null);
      expectCode(await other.c.request('GET', `/api/v1/admin/imports?limit=2&cursor=${encodeURIComponent(first.json.nextCursor)}`), 400, 'VALIDATION_FAILED');
      const detail = await c.request('GET', `/api/v1/admin/imports/${first.json.items[0].id}`);
      assert.equal(detail.status, 200);
      assert.equal(detail.json.import.items.length, 1);
      assert.doesNotMatch(detail.body, /operationKey|digest|contentSha256|previewToken/);
      const t = await trader(app);
      expectCode(await t.c.request('GET', '/api/v1/admin/imports'), 403, 'FORBIDDEN');
      expectCode(await c.request('GET', `/api/v1/admin/imports/${randomUUID()}`), 404, 'NOT_FOUND');
    }));
});
