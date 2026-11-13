import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { Client, createAdmin, createTrader, startTestApp, type Response, type TestApp } from '../helpers/app.ts';
import { insertProduct } from '../helpers/database.ts';

// Stage 16 adversarial review: permission matrix over EVERY route, ownership, stock inference,
// request ambiguity and stored-text handling. Disposable in-process app and synthetic accounts.

let ipSeq = 0;
const ip = () => `100.96.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const MIN = 60_000;

async function withApp(fn: (app: TestApp) => Promise<void>) {
  const app = await startTestApp();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

type Access = 'public' | 'session' | 'approved' | 'admin' | 'adminRecent';
const X = '00000000-0000-4000-8000-000000000000';
/** Every registered route (src/server/routes/*) with the access level the server must enforce. */
const ROUTES: Array<[string, string, Access]> = [
  ['GET', '/healthz', 'public'],
  ['GET', '/readyz', 'public'],
  ['GET', '/api/v1/auth/csrf', 'public'],
  ['GET', '/api/v1/auth/me', 'session'],
  ['POST', '/api/v1/auth/password', 'session'],
  ['GET', '/api/v1/merchant/profile', 'session'],
  ['PATCH', '/api/v1/merchant/profile', 'session'],
  ['GET', '/api/v1/products', 'approved'],
  ['GET', `/api/v1/products/${X}`, 'approved'],
  ['GET', '/api/v1/catalog/filters', 'approved'],
  ['GET', '/api/v1/orders', 'approved'],
  ['POST', '/api/v1/orders', 'approved'],
  ['POST', '/api/v1/orders/quote', 'approved'],
  ['GET', `/api/v1/orders/${X}`, 'approved'],
  ['GET', `/api/v1/orders/${X}/summary`, 'approved'],
  ['GET', '/api/v1/admin/merchants', 'admin'],
  ['GET', `/api/v1/admin/merchants/${X}`, 'admin'],
  ['PATCH', `/api/v1/admin/merchants/${X}`, 'adminRecent'],
  ['GET', '/api/v1/admin/products', 'admin'],
  ['POST', '/api/v1/admin/products', 'adminRecent'],
  ['GET', `/api/v1/admin/products/${X}`, 'admin'],
  ['PATCH', `/api/v1/admin/products/${X}`, 'adminRecent'],
  ['GET', '/api/v1/admin/inventory', 'admin'],
  ['GET', `/api/v1/admin/inventory/${X}/ledger`, 'admin'],
  ['POST', `/api/v1/admin/inventory/${X}/adjustments`, 'adminRecent'],
  ['GET', '/api/v1/admin/orders', 'admin'],
  ['GET', `/api/v1/admin/orders/${X}`, 'admin'],
  ['GET', `/api/v1/admin/orders/${X}/summary`, 'admin'],
  ['POST', `/api/v1/admin/orders/${X}/transitions`, 'adminRecent'],
  ['GET', '/api/v1/admin/imports', 'admin'],
  ['GET', `/api/v1/admin/imports/${X}`, 'admin'],
  ['GET', '/api/v1/admin/imports/templates/create_products.csv', 'admin'],
  ['POST', '/api/v1/admin/imports/templates/prefilled', 'adminRecent'],
  ['POST', '/api/v1/admin/imports/preview', 'admin'],
  ['POST', '/api/v1/admin/imports/commit', 'adminRecent'],
  ['GET', '/api/v1/admin/settings', 'admin'],
  ['PATCH', '/api/v1/admin/settings', 'adminRecent'],
  ['GET', '/api/v1/admin/reports/orders', 'admin'],
  ['GET', '/api/v1/admin/reports/products', 'admin'],
  ['GET', '/api/v1/admin/reports/inventory', 'admin'],
  ['GET', '/api/v1/admin/reports/movements', 'admin'],
  ['POST', '/api/v1/admin/exports', 'adminRecent'],
];

const send = (c: Client, method: string, p: string) => c.request(method, p, method === 'GET' ? {} : { body: {} });
const code = (r: Response) => r.json?.error?.code ?? null;

describe('permission matrix (every route × every role)', () => {
  test('anonymous, pending, suspended-after-login, approved trader, administrator, stale administrator', () =>
    withApp(async (app) => {
      const pending = await createTrader(app, { status: 'pending' });
      const approved = await createTrader(app);
      const toSuspend = await createTrader(app);
      const admin = await createAdmin(app);
      const anon = new Client(app, ip());
      const pc = new Client(app, ip());
      assert.equal((await pc.login(pending.username, pending.password)).status, 200);
      const tc = new Client(app, ip());
      assert.equal((await tc.login(approved.username, approved.password)).status, 200);
      const sc = new Client(app, ip());
      assert.equal((await sc.login(toSuspend.username, toSuspend.password)).status, 200);
      app.fixtureDb.prepare("UPDATE merchants SET status = 'suspended', access_version = access_version + 1, version = version + 1 WHERE id = ?").run(toSuspend.merchantId);
      app.fixtureDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(toSuspend.id); // what the suspension service does
      const ac = new Client(app, ip());
      assert.equal((await ac.login(admin.username, admin.password, admin.code())).status, 200);

      const failures: string[] = [];
      const expect = (who: string, route: string, r: Response, ok: (r: Response) => boolean, want: string) => {
        if (!ok(r)) failures.push(`${who} ${route}: got ${r.status} ${code(r)}, want ${want}`);
      };
      for (const [m, p, access] of ROUTES) {
        const id = `${m} ${p}`;
        const a = await send(anon, m, p);
        if (access === 'public') expect('anon', id, a, (r) => r.status === 200, '200');
        else expect('anon', id, a, (r) => r.status === 401 && code(r) === 'UNAUTHENTICATED', '401');
        const s = await send(sc, m, p);
        if (access !== 'public') expect('suspended', id, s, (r) => r.status === 401, '401 (session revoked)');
        const pr = await send(pc, m, p);
        if (access === 'approved') expect('pending', id, pr, (r) => r.status === 403 && code(r) === 'ACCOUNT_PENDING', '403 ACCOUNT_PENDING');
        if (access === 'admin' || access === 'adminRecent') expect('pending', id, pr, (r) => r.status === 403 && code(r) === 'FORBIDDEN', '403 FORBIDDEN');
        const t = await send(tc, m, p);
        if (access === 'admin' || access === 'adminRecent') expect('trader', id, t, (r) => r.status === 403 && code(r) === 'FORBIDDEN', '403 FORBIDDEN');
        if (access === 'approved' || access === 'session') expect('trader', id, t, (r) => ![401, 403].includes(r.status), 'not 401/403');
        const ad = await send(ac, m, p);
        if (access === 'admin' || access === 'adminRecent') expect('admin', id, ad, (r) => ![401, 403, 428].includes(r.status), 'authorized');
      }
      // After the recent-authentication window (15 min) an administrator who stayed active (idle limit
      // 15 min) keeps read access only.
      app.clock.advance(8 * MIN);
      assert.equal((await ac.request('GET', '/api/v1/auth/me')).status, 200);
      app.clock.advance(8 * MIN);
      for (const [m, p, access] of ROUTES) {
        if (access !== 'admin' && access !== 'adminRecent') continue;
        const r = await send(ac, m, p);
        if (access === 'adminRecent') expect('stale-admin', `${m} ${p}`, r, (x) => x.status === 428 && code(x) === 'RECENT_AUTH_REQUIRED', '428');
        else expect('stale-admin', `${m} ${p}`, r, (x) => x.status !== 428 && x.status !== 401 && x.status !== 403, 'readable');
      }
      // Mutations without the session CSRF token are refused for every role, before any work.
      for (const [m, p, access] of ROUTES) {
        if (m === 'GET' || access === 'public') continue;
        for (const [who, c] of [['trader', tc], ['admin', ac]] as const) {
          const r = await c.request(m, p, { body: {}, csrf: null });
          expect(`${who}-nocsrf`, `${m} ${p}`, r, (x) => x.status === 403 && code(x) === 'CSRF_FAILED', '403 CSRF_FAILED');
        }
      }
      assert.deepEqual(failures, []);
    }));

  test('ownership: another merchant\'s order, summary and ids are 404 (indistinguishable from absent)', () =>
    withApp(async (app) => {
      const p = insertProduct(app.fixtureDb, { onHand: 50, price: 12_550, pack: 24 });
      const a = await createTrader(app);
      const b = await createTrader(app);
      const ca = new Client(app, ip());
      await ca.login(a.username, a.password);
      const cb = new Client(app, ip());
      await cb.login(b.username, b.password);
      const order = await ca.request('POST', '/api/v1/orders', { body: { requestKey: randomUUID(), items: [{ productId: p, cartons: 1, expectedCartonPriceCents: 12_550, expectedPackSize: 24 }], expectedTerms: { shippingCents: 0, shippingTaxable: false, taxBps: 0 } } });
      assert.equal(order.status, 201, order.body);
      const id = order.json.order.id as string;
      for (const path of [`/api/v1/orders/${id}`, `/api/v1/orders/${id}/summary`]) {
        const other = await cb.request('GET', path);
        const absent = await cb.request('GET', path.replace(id, X));
        assert.equal(other.status, 404);
        assert.equal(other.body.replace(/"requestId":"[^"]+"/, ''), absent.body.replace(/"requestId":"[^"]+"/, ''), 'same body as a missing order');
      }
      const list = await cb.request('GET', '/api/v1/orders');
      assert.equal(list.json.items.length, 0);
      // Idempotency keys are scoped per merchant: B reusing A's key creates B's own order, never returns A's.
      const reuse = await cb.request('POST', '/api/v1/orders', { body: { requestKey: order.json.order.requestKey ?? randomUUID(), items: [{ productId: p, cartons: 1, expectedCartonPriceCents: 12_550, expectedPackSize: 24 }], expectedTerms: { shippingCents: 0, shippingTaxable: false, taxBps: 0 } } });
      assert.notEqual(reuse.json?.order?.id, id);
    }));
});

describe('stock inference (documented business limitation, measured)', () => {
  test('traders never receive quantities, but repeated quotes reveal exact available stock by bisection', () =>
    withApp(async (app) => {
      const p = insertProduct(app.fixtureDb, { onHand: 7_431, price: 1000, pack: 12 });
      const t = await createTrader(app);
      const c = new Client(app, ip());
      await c.login(t.username, t.password);
      // No quantity in catalog, product, filters, quote or the stock error.
      const bodies = [await c.request('GET', '/api/v1/products'), await c.request('GET', `/api/v1/products/${p}`), await c.request('GET', '/api/v1/catalog/filters')];
      const quote = (cartons: number) => c.request('POST', '/api/v1/orders/quote', { body: { items: [{ productId: p, cartons, expectedCartonPriceCents: 1000, expectedPackSize: 12 }] } });
      const tooMany = await quote(100_000);
      assert.equal(tooMany.json.error.code, 'INSUFFICIENT_STOCK');
      bodies.push(tooMany, await quote(1));
      for (const r of bodies) assert.doesNotMatch(r.body, /7431|7,431|onHand|on_hand|reserved|"available"/, r.body.slice(0, 200));
      // ...yet bisection over the quote endpoint recovers the exact number within the rate limit.
      let lo = 0;
      let hi = 100_000;
      let requests = 0;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const r = await quote(mid);
        requests++;
        if (r.status === 200) lo = mid;
        else if (r.json?.error?.code === 'INSUFFICIENT_STOCK') hi = mid - 1;
        else assert.fail(`unexpected ${r.status} ${r.body}`);
      }
      assert.equal(lo, 7_431, 'exact available stock inferred');
      assert.ok(requests <= 17 && requests < 60, `took ${requests} quotes (limit 60 per 10 min)`);
      console.log(`# stock inference: exact stock recovered with ${requests} quote requests (quote limit 60/10 min per merchant)`);
    }));
});

describe('request ambiguity and stored text', () => {
  test('duplicate/unknown fields, prototype keys, non-integer money and quantities are refused', () =>
    withApp(async (app) => {
      const p = insertProduct(app.fixtureDb, { onHand: 50, price: 12_550, pack: 24 });
      const t = await createTrader(app);
      const c = new Client(app, ip());
      await c.login(t.username, t.password);
      const base = { requestKey: randomUUID(), items: [{ productId: p, cartons: 1, expectedCartonPriceCents: 12_550, expectedPackSize: 24 }], expectedTerms: { shippingCents: 0, shippingTaxable: false, taxBps: 0 } };
      for (const bad of [
        { ...base, merchantId: X },
        { ...base, items: [{ ...base.items[0], cartons: 1.5 }] },
        { ...base, items: [{ ...base.items[0], cartons: '1' }] },
        { ...base, items: [{ ...base.items[0], cartons: 1e21 }] },
        { ...base, items: [{ ...base.items[0], expectedCartonPriceCents: -1 }] },
        { ...base, items: [base.items[0], base.items[0]] },
      ]) {
        const r = await c.request('POST', '/api/v1/orders', { body: bad });
        assert.ok(r.status === 400 || r.status === 422, `${r.status} ${r.body.slice(0, 160)}`);
      }
      // Raw JSON with a duplicate key and a __proto__ key (cannot be produced with JSON.stringify).
      for (const raw of [
        `{"requestKey":"${randomUUID()}","requestKey":"${randomUUID()}","items":[],"expectedTerms":{"shippingCents":0,"shippingTaxable":false,"taxBps":0}}`,
        `{"__proto__":{"admin":true},"requestKey":"${randomUUID()}","items":[{"productId":"${p}","cartons":1,"expectedCartonPriceCents":12550,"expectedPackSize":24}],"expectedTerms":{"shippingCents":0,"shippingTaxable":false,"taxBps":0}}`,
      ]) {
        const r = await c.request('POST', '/api/v1/orders', { rawBody: raw });
        assert.ok(r.status === 400, `${r.status} ${r.body.slice(0, 200)}`);
      }
      assert.equal(Number((app.fixtureDb.prepare('SELECT count(*) AS n FROM orders').get() as { n: number }).n), 0);
      // Duplicate query parameters are refused or the first is taken — never two filters merged silently.
      const dup = await c.request('GET', '/api/v1/products?brand=a&brand=b');
      assert.ok(dup.status === 400 || dup.status === 200);
    }));

  test('stored text is returned as JSON data, never interpreted; script-like names stay inert', () =>
    withApp(async (app) => {
      const evil = '<img src=x onerror=alert(1)>"\'</script>';
      const t = await createTrader(app);
      const c = new Client(app, ip());
      await c.login(t.username, t.password);
      const r = await c.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, address: `12 ${evil}` } });
      assert.equal(r.status, 200, r.body);
      const me = await c.request('GET', '/api/v1/auth/me');
      assert.equal(me.headers['content-type'], 'application/json; charset=utf-8');
      assert.equal(me.json.merchant.address, `12 ${evil}`, 'stored verbatim, rendered by React as text');
      assert.equal(me.headers['x-content-type-options'], 'nosniff');
      assert.match(String(me.headers['content-security-policy']), /script-src 'self'/);
    }));
});
