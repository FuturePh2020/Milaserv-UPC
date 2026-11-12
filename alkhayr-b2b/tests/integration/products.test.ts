import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { Client, count, createAdmin, createTrader, startTestApp, type TestApp } from '../helpers/app.ts';

// Synthetic accounts and products only. Stock is set ONLY through the test-only fixture connection.
const MIN = 60_000;
let ipSeq = 0;
const ip = () => `100.80.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

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

const base = { name: 'شيكولاتة بالبندق 50 جم', brand: 'Choco Lux', category: 'chocolate', cartonPriceCents: 12_550, packSize: 24, minimumCartons: 2 };

function create(c: Client, extra: Record<string, unknown> = {}) {
  return c.request('POST', '/api/v1/admin/products', { body: { ...base, ...extra } });
}

/** TEST-ONLY: set stock directly on the fixture connection (stage 07 adds the real inventory service). */
function setStock(app: TestApp, id: string, onHand: number, reserved = 0) {
  app.fixtureDb.prepare('UPDATE products SET on_hand = ?, reserved = ?, version = version + 1 WHERE id = ?').run(onHand, reserved, id);
}

const productRow = (app: TestApp, id: string) => app.fixtureDb.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;

async function admin(app: TestApp) {
  const a = await createAdmin(app);
  return { account: a, c: await signedIn(app, a) };
}

async function created(c: Client, extra: Record<string, unknown> = {}) {
  const r = await create(c, extra);
  assert.equal(r.status, 201, r.body);
  return r.json.product;
}

async function activate(c: Client, product: { id: string; version: number }) {
  const r = await c.request('PATCH', `/api/v1/admin/products/${product.id}`, { body: { expectedVersion: product.version, active: true } });
  assert.equal(r.status, 200, r.body);
  return r.json.product;
}

describe('catalog access and visibility', () => {
  test('anonymous, pending and suspended users get no catalog data or prices; approved traders and admins do', () =>
    withApp(async (app) => {
      const { c: a } = await admin(app);
      const product = await activate(a, await created(a));
      const anon = new Client(app, ip());
      for (const p of ['/api/v1/products', `/api/v1/products/${product.id}`, '/api/v1/catalog/filters']) {
        expectCode(await anon.request('GET', p), 401, 'UNAUTHENTICATED');
      }
      const pending = await signedIn(app, await createTrader(app, { status: 'pending' }));
      for (const p of ['/api/v1/products', `/api/v1/products/${product.id}`, '/api/v1/catalog/filters']) {
        const r = await pending.request('GET', p);
        expectCode(r, 403, 'ACCOUNT_PENDING');
        assert.ok(!r.body.includes('12550') && !r.body.includes(base.name));
      }
      const st = await createTrader(app, { status: 'approved' });
      const s = await signedIn(app, st);
      app.fixtureDb.prepare("UPDATE merchants SET status = 'suspended', access_version = access_version + 1, version = version + 1 WHERE id = ?").run(st.merchantId);
      expectCode(await s.request('GET', '/api/v1/products'), 401, 'UNAUTHENTICATED');
      const approved = await signedIn(app, await createTrader(app, { status: 'approved' }));
      const list = await approved.request('GET', '/api/v1/products');
      assert.equal(list.status, 200);
      assert.equal(list.json.items.length, 1);
      assert.equal((await a.request('GET', '/api/v1/products')).status, 200, 'administrators may browse the catalog');
    }));

  test('traders see only active products without stock counts or internal fields; inactive ids look like unknown ids', () =>
    withApp(async (app) => {
      const { c: a } = await admin(app);
      const hidden = await created(a, { name: 'منتج غير مفعّل', barcode: 'HIDDEN-1' });
      const visible = await activate(a, await created(a, { name: 'منتج ظاهر', barcode: '0001' }));
      setStock(app, visible.id, 15, 10);
      const t = await signedIn(app, await createTrader(app));
      const list = await t.request('GET', '/api/v1/products');
      assert.deepEqual(list.json.items.map((p: any) => p.name), ['منتج ظاهر']);
      const item = list.json.items[0];
      assert.deepEqual(Object.keys(item).sort(), ['availability', 'barcode', 'brand', 'cartonPriceCents', 'category', 'id', 'imageUrl', 'isDemo', 'minimumCartons', 'name', 'packSize']);
      assert.deepEqual(item.availability, { status: 'low_stock', labelAr: 'كمية محدودة' }, 'available = 15 - 10 = 5');
      assert.ok(!/onHand|on_hand|reserved|"available"|"version"|createdAt|updatedAt|audit/i.test(list.body), list.body);
      assert.ok(!list.body.includes('HIDDEN-1') && !list.body.includes('منتج غير مفعّل'));
      assert.deepEqual((await t.request('GET', '/api/v1/products?q=HIDDEN-1')).json.items, [], 'inactive barcode not searchable');
      const hiddenDetail = await t.request('GET', `/api/v1/products/${hidden.id}`);
      const unknown = await t.request('GET', `/api/v1/products/${randomUUID()}`);
      expectCode(hiddenDetail, 404, 'NOT_FOUND');
      expectCode(unknown, 404, 'NOT_FOUND');
      assert.deepEqual({ ...hiddenDetail.json.error, requestId: '' }, { ...unknown.json.error, requestId: '' });
      expectCode(await t.request('GET', '/api/v1/products/not-a-uuid'), 404, 'NOT_FOUND');
      const detail = await t.request('GET', `/api/v1/products/${visible.id}`);
      assert.equal(detail.json.product.cartonPriceCents, 12_550);
      assert.ok(!/onHand|reserved|"available"/.test(detail.body));
      // Administrators see the complete record, with available computed from on_hand - reserved.
      const adminDetail = await a.request('GET', `/api/v1/admin/products/${visible.id}`);
      assert.deepEqual(adminDetail.json.product.stock, { onHand: 15, reserved: 10, available: 5 });
    }));

  test('availability status follows AVAILABLE stock and the configured threshold', () =>
    withApp(async (app) => {
      const { c: a } = await admin(app);
      const ids: Record<string, string> = {};
      for (const [label, onHand, reserved] of [['zero', 0, 0], ['all_reserved', 20, 20], ['ten', 10, 0], ['eleven', 30, 19]] as const) {
        const p = await activate(a, await created(a, { name: `منتج ${label}` }));
        setStock(app, p.id, onHand, reserved);
        ids[label] = p.id;
      }
      const t = await signedIn(app, await createTrader(app));
      const status = async (id: string) => (await t.request('GET', `/api/v1/products/${id}`)).json.product.availability.status;
      assert.equal(await status(ids.zero!), 'out_of_stock');
      assert.equal(await status(ids.all_reserved!), 'out_of_stock', 'on_hand 20, reserved 20 → available 0');
      assert.equal(await status(ids.ten!), 'low_stock', 'available 10 = threshold');
      assert.equal(await status(ids.eleven!), 'normal', 'available 11 > threshold 10');
      app.fixtureDb.exec('UPDATE business_settings SET low_stock_threshold_cartons = 20, version = version + 1');
      assert.equal(await status(ids.eleven!), 'low_stock', 'threshold read from business settings');
    }));

  test('filters: database categories with counts of visible products; brands only from visible products', () =>
    withApp(async (app) => {
      const { c: a } = await admin(app);
      await activate(a, await created(a, { brand: 'Visible Brand', category: 'candy' }));
      await created(a, { brand: 'Secret Brand', category: 'snacks_nuts' });
      const t = await signedIn(app, await createTrader(app));
      const f = await t.request('GET', '/api/v1/catalog/filters');
      assert.equal(f.status, 200);
      assert.deepEqual(
        f.json.categories.map((c: any) => [c.id, c.labelAr, c.productCount]),
        [
          ['chocolate', 'شيكولاتة', 0],
          ['candy', 'كاندي', 1],
          ['wafers_biscuits', 'ويفر وبسكويت', 0],
          ['snacks_nuts', 'سناكس ومكسرات', 0],
        ],
      );
      assert.deepEqual(f.json.brands, [{ name: 'Visible Brand', productCount: 1 }]);
      expectCode(await t.request('GET', '/api/v1/catalog/filters?all=1'), 400, 'VALIDATION_FAILED');
    }));
});

describe('administration: authorization', () => {
  test('traders are denied every administrative product operation', () =>
    withApp(async (app) => {
      const { c: a } = await admin(app);
      const p = await created(a);
      const t = await signedIn(app, await createTrader(app));
      expectCode(await t.request('GET', '/api/v1/admin/products'), 403, 'FORBIDDEN');
      expectCode(await t.request('GET', `/api/v1/admin/products/${p.id}`), 403, 'FORBIDDEN');
      expectCode(await t.request('POST', '/api/v1/admin/products', { body: base, headers: { 'X-User-Role': 'admin' } }), 403, 'FORBIDDEN');
      expectCode(await t.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: 1, active: true } }), 403, 'FORBIDDEN');
      expectCode(await new Client(app, ip()).request('GET', '/api/v1/admin/products'), 401, 'UNAUTHENTICATED');
      assert.equal(productRow(app, p.id).active, 0);
      assert.equal(count(app, 'SELECT count(*) FROM products'), 1);
    }));

  test('reads need a live admin session; mutations need recent authentication (428), re-checked at commit', () =>
    withApp(async (app) => {
      const { account, c } = await admin(app);
      const p = await created(c);
      app.clock.advance(10 * MIN);
      await c.request('GET', '/api/v1/auth/me');
      app.clock.advance(6 * MIN);
      assert.equal((await c.request('GET', '/api/v1/admin/products')).status, 200);
      expectCode(await create(c, { name: 'منتج متأخر' }), 428, 'RECENT_AUTH_REQUIRED');
      expectCode(await c.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: 1, active: true } }), 428, 'RECENT_AUTH_REQUIRED');
      app.clock.advance(30_000);
      await c.login(account.username, account.password, account.code());
      // Recency that lapses while the body is in flight is caught at commit.
      app.clock.advance(14 * MIN + 50_000);
      await c.request('GET', '/api/v1/auth/me');
      const lapsed = await c.requestSlow('POST', '/api/v1/admin/products', { ...base, name: 'منتج أثناء الإرسال' }, () => app.clock.advance(20_000));
      expectCode(lapsed, 428, 'RECENT_AUTH_REQUIRED');
      assert.equal(count(app, 'SELECT count(*) FROM products'), 1);
    }));

  test('logout during request parsing prevents the write', () =>
    withApp(async (app) => {
      const { account, c } = await admin(app);
      const p = await created(c);
      const r1 = await c.requestSlow('POST', '/api/v1/admin/products', { ...base, name: 'منتج بعد الخروج' }, () => {
        app.fixtureDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(account.id);
      });
      expectCode(r1, 401, 'UNAUTHENTICATED');
      const c2 = await signedIn(app, { ...account, code: () => account.code(1) });
      const r2 = await c2.requestSlow('PATCH', `/api/v1/admin/products/${p.id}`, { expectedVersion: 1, cartonPriceCents: 1 }, () => {
        app.fixtureDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(account.id);
      });
      expectCode(r2, 401, 'UNAUTHENTICATED');
      assert.equal(count(app, 'SELECT count(*) FROM products'), 1);
      assert.equal(productRow(app, p.id).price_cents, 12_550);
    }));
});

describe('administration: creation and validation', () => {
  test('creates an inactive product with zero stock; server chooses id, version and timestamps; audited', () =>
    withApp(async (app) => {
      const { account, c } = await admin(app);
      const r = await create(c, { barcode: '000123', imageUrl: 'https://img.example.com/p/1.png' });
      assert.equal(r.status, 201, r.body);
      const p = r.json.product;
      assert.match(p.id, /^[0-9a-f-]{36}$/);
      assert.equal(p.active, false);
      assert.deepEqual(p.stock, { onHand: 0, reserved: 0, available: 0 });
      assert.equal(p.version, 1);
      assert.deepEqual(p.category, { id: 'chocolate', labelAr: 'شيكولاتة' });
      assert.equal(p.barcode, '000123');
      const audit = app.fixtureDb.prepare("SELECT actor_user_id, metadata FROM audit_logs WHERE action = 'product.created'").get() as any;
      assert.equal(audit.actor_user_id, account.id);
      assert.deepEqual(JSON.parse(audit.metadata), { version: 1, category: 'chocolate', price_to: 12_550, active_to: false, is_demo: false });
    }));

  test('unexpected, stock and internal fields are rejected on create and update (mass assignment)', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      for (const extra of [{ id: randomUUID() }, { version: 3 }, { onHand: 100 }, { reserved: 1 }, { available: 50 }, { stock: { onHand: 5 } }, { active: true }, { createdAt: 1 }, { role: 'admin' }, { on_hand: 5 }]) {
        expectCode(await create(c, extra), 400, 'VALIDATION_FAILED');
      }
      assert.equal(count(app, 'SELECT count(*) FROM products'), 0);
      const p = await created(c);
      for (const extra of [{ onHand: 100 }, { reserved: 1 }, { available: 9 }, { isDemo: true }, { id: randomUUID() }, { version: 9 }, { updatedAt: 1 }, { price_cents: 5 }]) {
        expectCode(await c.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: 1, ...extra } }), 400, 'VALIDATION_FAILED');
      }
      const row = productRow(app, p.id);
      assert.deepEqual([row.on_hand, row.reserved, row.version, row.is_demo], [0, 0, 1, 0]);
      expectCode(await c.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { active: true } }), 400, 'VALIDATION_FAILED');
      expectCode(await c.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: 1 } }), 400, 'VALIDATION_FAILED');
    }));

  test('integer cents and quantity limits are validated before SQLite could coerce anything', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const bad: Array<Record<string, unknown>> = [
        { cartonPriceCents: '12550' },
        { cartonPriceCents: 125.5 },
        { cartonPriceCents: 0 },
        { cartonPriceCents: -1 },
        { cartonPriceCents: 100_000_001 },
        { cartonPriceCents: true },
        { cartonPriceCents: null },
        { cartonPriceCents: 2 ** 53 },
        { packSize: 0 },
        { packSize: 10_001 },
        { packSize: 1.5 },
        { packSize: '24' },
        { minimumCartons: 0 },
        { minimumCartons: 100_001 },
        { minimumCartons: 2.5 },
      ];
      for (const extra of bad) expectCode(await create(c, extra), 400, 'VALIDATION_FAILED');
      // 1e400 parses to Infinity in JSON.parse: rejected as non-finite.
      expectCode(await c.request('POST', '/api/v1/admin/products', { rawBody: JSON.stringify(base).replace('12550', '1e400') }), 400, 'VALIDATION_FAILED');
      assert.equal(count(app, 'SELECT count(*) FROM products'), 0);
      for (const ok of [{ cartonPriceCents: 1 }, { cartonPriceCents: 100_000_000, packSize: 10_000, minimumCartons: 100_000 }]) {
        assert.equal((await create(c, ok)).status, 201);
      }
      assert.deepEqual(app.fixtureDb.prepare('SELECT typeof(price_cents) AS t FROM products GROUP BY t').all().map((r: any) => r.t), ['integer']);
    }));

  test('barcodes: null = none, "" invalid, exact text (case and leading zeros kept), unique', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      assert.equal((await created(c, { barcode: null })).barcode, null);
      assert.equal((await created(c)).barcode, null, 'omitted → null');
      expectCode(await create(c, { barcode: '' }), 400, 'VALIDATION_FAILED');
      expectCode(await create(c, { barcode: ' 000123' }), 400, 'VALIDATION_FAILED');
      expectCode(await create(c, { barcode: 123 }), 400, 'VALIDATION_FAILED');
      expectCode(await create(c, { barcode: 'x'.repeat(33) }), 400, 'VALIDATION_FAILED');
      const a = await created(c, { barcode: '000123' });
      assert.equal(a.barcode, '000123');
      assert.equal((await created(c, { barcode: '00123' })).barcode, '00123');
      const upper = await created(c, { barcode: 'ABC-1' });
      assert.equal((await created(c, { barcode: 'abc-1' })).barcode, 'abc-1', 'case preserved; distinct exact text');
      const dup = await create(c, { barcode: '000123' });
      expectCode(dup, 409, 'DUPLICATE');
      assert.equal(dup.json.error.details.fields[0].path, 'barcode');
      expectCode(await c.request('PATCH', `/api/v1/admin/products/${upper.id}`, { body: { expectedVersion: 1, barcode: '000123' } }), 409, 'DUPLICATE');
      expectCode(await c.request('PATCH', `/api/v1/admin/products/${upper.id}`, { body: { expectedVersion: 1, barcode: '' } }), 400, 'VALIDATION_FAILED');
      const cleared = await c.request('PATCH', `/api/v1/admin/products/${upper.id}`, { body: { expectedVersion: 1, barcode: null } });
      assert.equal(cleared.json.product.barcode, null);
      assert.equal(count(app, "SELECT count(*) FROM products WHERE barcode = ''"), 0);
    }));

  test('category references are validated against the database', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      for (const category of ['cookies', 'Chocolate', 'شيكولاتة', '', 'chocolate;--']) expectCode(await create(c, { category }), 400, 'VALIDATION_FAILED');
      const p = await created(c, { category: 'wafers_biscuits' });
      assert.equal(p.category.labelAr, 'ويفر وبسكويت');
      expectCode(await c.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: 1, category: 'drinks' } }), 400, 'VALIDATION_FAILED');
      app.fixtureDb.exec("UPDATE product_categories SET active = 0 WHERE id = 'candy'");
      expectCode(await create(c, { category: 'candy' }), 400, 'VALIDATION_FAILED');
    }));

  test('image URLs: https only, no credentials, never fetched; stored canonically', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      for (const imageUrl of ['http://img.example.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://user:pass@img.example.com/a.png', 'https://@img.example.com/a.png', 'https://', '//img.example.com/a.png', 'ftp://img.example.com/a.png', 'https://img.example.com/a b.png', 'https://img.example.com\\@evil/', 'file:///etc/passwd', 123]) {
        expectCode(await create(c, { imageUrl }), 400, 'VALIDATION_FAILED');
      }
      const p = await created(c, { imageUrl: 'https://IMG.Example.com/p/1.png?w=200' });
      assert.equal(p.imageUrl, 'https://img.example.com/p/1.png?w=200');
      const cleared = await c.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: 1, imageUrl: null } });
      assert.equal(cleared.json.product.imageUrl, null);
    }));

  test('malicious names and search values are stored and returned as inert data', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const evil = `<script>alert(1)</script>' OR 1=1; DROP TABLE products; --`;
      const p = await activate(c, await created(c, { name: evil, brand: '"><img src=x onerror=alert(1)>' }));
      assert.equal(p.name, evil.trim());
      const t = await signedIn(app, await createTrader(app));
      const found = await t.request('GET', `/api/v1/products?q=${encodeURIComponent('DROP TABLE')}`);
      assert.equal(found.json.items[0].name, evil);
      const injected = await t.request('GET', `/api/v1/products?q=${encodeURIComponent("' OR '1'='1")}`);
      assert.deepEqual(injected.json.items, []);
      assert.equal(count(app, 'SELECT count(*) FROM products'), 1, 'table intact');
      assert.match(String(found.headers['content-type']), /^application\/json/);
    }));

  test('demo merchandise: allowed only outside production, fixed at creation, never convertible', async () => {
    await withApp(
      async (app) => {
        const { c } = await admin(app);
        const r = await create(c, { isDemo: true });
        expectCode(r, 400, 'VALIDATION_FAILED');
        assert.equal(r.json.error.details.fields[0].path, 'isDemo');
        assert.equal(count(app, 'SELECT count(*) FROM products'), 0);
      },
      { production: true },
    );
    await withApp(async (app) => {
      const { c } = await admin(app);
      const demo = await created(c, { isDemo: true });
      assert.equal(demo.isDemo, true);
      expectCode(await c.request('PATCH', `/api/v1/admin/products/${demo.id}`, { body: { expectedVersion: 1, isDemo: false } }), 400, 'VALIDATION_FAILED');
      const real = await created(c);
      expectCode(await c.request('PATCH', `/api/v1/admin/products/${real.id}`, { body: { expectedVersion: 1, isDemo: true } }), 400, 'VALIDATION_FAILED');
    });
  });
});

describe('administration: concurrency, versions and atomicity', () => {
  test('concurrent creates with the same barcode: exactly one succeeds', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const results = await Promise.all([1, 2, 3].map(() => create(c, { barcode: 'RACE-1' })));
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
      assert.equal(count(app, "SELECT count(*) FROM products WHERE barcode = 'RACE-1'"), 1);
    }));

  test('concurrent creates at the 5000-product cap never exceed it', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      // TEST-ONLY bulk fixture: 4998 rows through the fixture connection.
      const insert = app.fixtureDb.prepare(
        "INSERT INTO products (id, name, brand, category, price_cents, pack_size, minimum_cartons, active, is_demo, version, created_at, updated_at) VALUES (?, ?, 'Bulk', 'candy', 100, 1, 1, 0, 0, 1, 1, 1)",
      );
      app.fixtureDb.exec('BEGIN');
      for (let i = 0; i < 4998; i++) insert.run(randomUUID(), `منتج ${i}`);
      app.fixtureDb.exec('COMMIT');
      const results = await Promise.all([1, 2, 3].map((i) => create(c, { name: `منتج جديد ${i}` })));
      const statuses = results.map((r) => r.status).sort();
      assert.deepEqual(statuses, [201, 201, 422]);
      expectCode(results.find((r) => r.status === 422)!, 422, 'CATALOG_LIMIT');
      assert.equal(count(app, 'SELECT count(*) FROM products'), 5000);
    }));

  test('conflicting edits: one succeeds, the other gets 409 with the current record; no-op edits do not bump the version', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const p = await created(c);
      const [r1, r2] = await Promise.all([
        c.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: 1, cartonPriceCents: 13_000 } }),
        c.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: 1, name: 'اسم آخر للمنتج' } }),
      ]);
      assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
      const loser = r1.status === 409 ? r1 : r2;
      expectCode(loser, 409, 'VERSION_CONFLICT');
      assert.equal(loser.json.error.details.current.product.version, 2);
      const same = await c.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: 2, brand: base.brand } });
      assert.equal(same.json.product.version, 2, 'nothing changed → same version');
      assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'product.updated'"), 1);
    }));

  test('price and activation changes advance the version and are audited with explicit transitions', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const p = await created(c);
      const priced = await c.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: 1, cartonPriceCents: 13_500, name: 'اسم جديد' } });
      assert.equal(priced.json.product.version, 2);
      const on = await activate(c, priced.json.product);
      assert.equal(on.version, 3);
      assert.equal(on.active, true);
      const t = await signedIn(app, await createTrader(app));
      assert.equal((await t.request('GET', `/api/v1/products/${p.id}`)).status, 200);
      const off = await c.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: 3, active: false } });
      assert.equal(off.json.product.version, 4);
      expectCode(await t.request('GET', `/api/v1/products/${p.id}`), 404, 'NOT_FOUND');
      const audits = app.fixtureDb.prepare("SELECT metadata FROM audit_logs WHERE action = 'product.updated' ORDER BY id").all().map((r: any) => JSON.parse(r.metadata));
      assert.deepEqual(audits, [
        { fields: 'name,cartonPriceCents', version: 2, price_from: 12_550, price_to: 13_500 },
        { fields: 'active', version: 3, active_from: false, active_to: true },
        { fields: 'active', version: 4, active_from: true, active_to: false },
      ]);
      // Test-only stock movement also advances the version, so an admin form loaded before it is stale.
      setStock(app, p.id, 5);
      expectCode(await c.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: 4, cartonPriceCents: 1 } }), 409, 'VERSION_CONFLICT');
    }));

  test('an audit failure rolls back the product change (create and update)', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const p = await created(c);
      const before = productRow(app, p.id);
      app.fixtureDb.exec("CREATE TRIGGER test_block_product_audit BEFORE INSERT ON audit_logs WHEN NEW.action LIKE 'product.%' BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END");
      assert.equal((await c.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: 1, cartonPriceCents: 1, active: true } })).status, 500);
      assert.deepEqual(productRow(app, p.id), before);
      assert.equal((await create(c, { name: 'لن يُحفظ' })).status, 500);
      assert.equal(count(app, 'SELECT count(*) FROM products'), 1);
      app.fixtureDb.exec('DROP TRIGGER test_block_product_audit');
      assert.equal((await c.request('PATCH', `/api/v1/admin/products/${p.id}`, { body: { expectedVersion: 1, cartonPriceCents: 1 } })).status, 200);
    }));
});

describe('search, filters and pagination', () => {
  test('literal wildcards, Latin case-insensitivity, Arabic exact match, barcode equality', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      for (const [name, barcode] of [['شوكولا 100%', 'B-1'], ['Choco_bar', 'B-2'], ['Chocolate Bar', 'B-3'], ['ChocoXbar', 'B-4'], ['ويفر بالكريمة', '0042']] as const) {
        await activate(c, await created(c, { name, barcode }));
      }
      const t = await signedIn(app, await createTrader(app));
      const names = async (q: string) => (await t.request('GET', `/api/v1/products?q=${encodeURIComponent(q)}&sort=name`)).json.items.map((p: any) => p.name);
      assert.deepEqual(await names('%'), ['شوكولا 100%']);
      assert.deepEqual(await names('_'), ['Choco_bar']);
      assert.deepEqual(await names('Choco_'), ['Choco_bar'], '_ is literal, so ChocoXbar is not matched');
      assert.deepEqual(await names('CHOCOLATE'), ['Chocolate Bar']);
      assert.deepEqual(await names('بالكريمة'), ['ويفر بالكريمة']);
      assert.deepEqual(await names('0042'), ['ويفر بالكريمة'], 'exact barcode');
      assert.deepEqual(await names('004'), [], 'barcode is exact-match only');
    }));

  test('filter and sort validation; brand filter; stable pagination; cursors bound to scope, filters and user', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      for (let i = 0; i < 7; i++) {
        await activate(c, await created(c, { name: `منتج رقم ${i}`, brand: i % 2 ? 'Brand A' : 'Brand B', cartonPriceCents: 1000 + (i % 3) * 100, category: i < 4 ? 'candy' : 'chocolate' }));
        app.clock.advance(1000);
      }
      const t = await signedIn(app, await createTrader(app));
      for (const bad of ['sort=price_cents', 'sort=name%20DESC', 'sort=oldest', 'category=unknown', 'limit=101', 'limit=0', 'brand=', 'active=true', 'page=2', 'q=', `q=${'x'.repeat(81)}`, 'sort=name&sort=newest']) {
        expectCode(await t.request('GET', `/api/v1/products?${bad}`), 400, 'VALIDATION_FAILED');
      }
      const brandA = await t.request('GET', `/api/v1/products?brand=${encodeURIComponent('Brand A')}`);
      assert.ok(brandA.json.items.length === 3 && brandA.json.items.every((p: any) => p.brand === 'Brand A'));
      const candy = await t.request('GET', '/api/v1/products?category=candy');
      assert.equal(candy.json.items.length, 4);
      for (const sort of ['name', 'newest', 'price_asc', 'price_desc']) {
        const seen: string[] = [];
        let cursor: string | null = null;
        let guard = 0;
        do {
          const r = await t.request('GET', `/api/v1/products?sort=${sort}&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
          assert.equal(r.status, 200, r.body);
          seen.push(...r.json.items.map((p: any) => p.id));
          cursor = r.json.nextCursor;
        } while (cursor && ++guard < 10);
        const all = (await t.request('GET', `/api/v1/products?sort=${sort}&limit=100`)).json.items.map((p: any) => p.id);
        assert.deepEqual(seen, all, `pages concatenate to the full ${sort} ordering`);
        assert.equal(new Set(seen).size, 7);
      }
      const first = await t.request('GET', '/api/v1/products?sort=name&limit=2');
      const cur = encodeURIComponent(first.json.nextCursor);
      expectCode(await t.request('GET', `/api/v1/products?sort=newest&limit=2&cursor=${cur}`), 400, 'VALIDATION_FAILED');
      expectCode(await t.request('GET', `/api/v1/products?sort=name&category=candy&limit=2&cursor=${cur}`), 400, 'VALIDATION_FAILED');
      expectCode(await c.request('GET', `/api/v1/admin/products?sort=name&limit=2&cursor=${cur}`), 400, 'VALIDATION_FAILED');
      const other = await signedIn(app, await createTrader(app));
      expectCode(await other.request('GET', `/api/v1/products?sort=name&limit=2&cursor=${cur}`), 400, 'VALIDATION_FAILED');
      // Administrators can filter by activation/demo state; traders cannot.
      await created(c, { name: 'غير مفعّل' });
      const inactive = await c.request('GET', '/api/v1/admin/products?active=false');
      assert.deepEqual(inactive.json.items.map((p: any) => p.name), ['غير مفعّل']);
    }));
});
