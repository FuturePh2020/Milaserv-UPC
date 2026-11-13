import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { Client, count, createAdmin, createTrader, startTestApp, type TestApp } from '../helpers/app.ts';
import { insertProduct } from '../helpers/database.ts';

// Synthetic data only. Stage 13: CSV imports (preview → confirmation), all-or-nothing, durable idempotency.
const MIN = 60_000;
let ipSeq = 0;
const ip = () => `100.91.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const b64 = (s: string | Uint8Array) => Buffer.from(s).toString('base64');

function expectCode(r: { status: number; json: any }, status: number, code: string) {
  assert.equal(r.status, status, JSON.stringify(r.json)?.slice(0, 600));
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
  const r = await c.login(account.username, account.password, account.code());
  assert.equal(r.status, 200, r.body);
  return { account, c };
}

const preview = (c: Client, mode: string, csv: string | Uint8Array) => c.request('POST', '/api/v1/admin/imports/preview', { body: { mode, file: b64(csv) } });
const commit = (c: Client, mode: string, csv: string | Uint8Array, previewToken: string, operationKey = randomUUID()) =>
  c.request('POST', '/api/v1/admin/imports/commit', { body: { mode, file: b64(csv), previewToken, operationKey } });

async function previewOk(c: Client, mode: string, csv: string | Uint8Array): Promise<string> {
  const r = await preview(c, mode, csv);
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.summary.invalid, 0, JSON.stringify(r.json.rows.filter((x: any) => x.status === 'error').concat(r.json.fileErrors)));
  assert.equal(typeof r.json.previewToken, 'string');
  return r.json.previewToken as string;
}

const CREATE_HEADER = 'name,brand,category,cartonPriceEgp,packSize,minimumCartons,barcode,imageUrl';
const product = (app: TestApp, id: string) => ({ ...(app.fixtureDb.prepare('SELECT name, brand, category, barcode, image_url, price_cents, pack_size, minimum_cartons, on_hand, reserved, active, is_demo, version FROM products WHERE id = ?').get(id) as object) }) as any;
const totals = (app: TestApp) => ({
  products: count(app, 'SELECT count(*) FROM products'),
  ledger: count(app, 'SELECT count(*) FROM inventory_ledger'),
  audit: count(app, 'SELECT count(*) FROM audit_logs'),
  imports: count(app, 'SELECT count(*) FROM import_operations'),
  items: count(app, 'SELECT count(*) FROM import_operation_items'),
  versions: (app.fixtureDb.prepare('SELECT coalesce(sum(version), 0) AS v FROM products').get() as { v: number }).v,
});

describe('access, boundary and templates', () => {
  test('anonymous and traders are refused on every import route; previews need a live admin session, commits recent authentication', () =>
    withApp(async (app) => {
      const anon = new Client(app, ip());
      expectCode(await anon.request('GET', '/api/v1/admin/imports/templates/create_products.csv'), 401, 'UNAUTHENTICATED');
      expectCode(await preview(anon, 'create_products', `${CREATE_HEADER}\nx,y,candy,1,1,1,,\n`), 401, 'UNAUTHENTICATED');
      const trader = await createTrader(app);
      const t = new Client(app, ip());
      assert.equal((await t.login(trader.username, trader.password)).status, 200);
      expectCode(await t.request('GET', '/api/v1/admin/imports/templates/create_products.csv'), 403, 'FORBIDDEN');
      expectCode(await preview(t, 'create_products', `${CREATE_HEADER}\nكاندي,سكر,candy,1,1,1,,\n`), 403, 'FORBIDDEN');
      expectCode(await commit(t, 'create_products', `${CREATE_HEADER}\nكاندي,سكر,candy,1,1,1,,\n`, 'x'.repeat(20)), 403, 'FORBIDDEN');

      const { c } = await admin(app);
      const csv = `${CREATE_HEADER}\nكاندي فواكه,سكر,candy,90,48,1,,\n`;
      expectCode(await c.request('POST', '/api/v1/admin/imports/preview', { body: { mode: 'create_products', file: b64(csv) }, csrf: null }), 403, 'CSRF_FAILED');
      expectCode(await c.request('POST', '/api/v1/admin/imports/preview', { body: { mode: 'create_products', file: b64(csv) }, headers: { Origin: 'http://evil.test' } }), 403, 'ORIGIN_REJECTED');
      const token = await previewOk(c, 'create_products', csv);
      app.clock.advance(10 * MIN);
      await c.request('GET', '/api/v1/auth/me'); // keep the session alive (idle limit)
      app.clock.advance(6 * MIN);
      // Reads (preview) only need a live session; the commit needs authentication within 15 minutes.
      assert.equal((await preview(c, 'create_products', csv)).status, 200);
      expectCode(await commit(c, 'create_products', csv, token), 428, 'RECENT_AUTH_REQUIRED');
      assert.equal(count(app, 'SELECT count(*) FROM products'), 0);
      assert.equal(count(app, 'SELECT count(*) FROM import_operations'), 0);
    }));

  test('templates: header-only UTF-8 with BOM, CSV attachment, one per mode; unknown names 404', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const expected: Record<string, string> = {
        create_products: CREATE_HEADER,
        update_products: 'productId,expectedVersion,currentName,name,brand,category,cartonPriceEgp,packSize,minimumCartons,barcode,imageUrl',
        receive_stock: 'productId,expectedVersion,quantity,reason,currentName,reference',
        set_stock_total: 'productId,expectedVersion,total,reason,currentName,reference',
      };
      for (const [mode, header] of Object.entries(expected)) {
        const r = await c.request('GET', `/api/v1/admin/imports/templates/${mode}.csv`);
        assert.equal(r.status, 200);
        assert.equal(r.headers['content-type'], 'text/csv; charset=utf-8');
        assert.equal(r.headers['content-disposition'], `attachment; filename="alkhayr-import-${mode}.csv"`);
        assert.equal(r.headers['cache-control'], 'no-store');
        assert.equal(r.body, `﻿${header}\r\n`);
      }
      expectCode(await c.request('GET', '/api/v1/admin/imports/templates/other.csv'), 404, 'NOT_FOUND');
      expectCode(await c.request('GET', '/api/v1/admin/imports/templates/create_products'), 404, 'NOT_FOUND');
    }));

  test('request and file size limits; strict request body; per-administrator rate limit', () =>
    withApp(
      async (app) => {
        const { c } = await admin(app);
        const big = new Uint8Array(1024 * 1024 + 1).fill(0x61);
        expectCode(await preview(c, 'create_products', big), 413, 'PAYLOAD_TOO_LARGE');
        const huge = 'A'.repeat(2 * 1024 * 1024 + 10);
        expectCode(await c.request('POST', '/api/v1/admin/imports/preview', { rawBody: JSON.stringify({ mode: 'create_products', file: huge }) }), 413, 'PAYLOAD_TOO_LARGE');
        expectCode(await c.request('POST', '/api/v1/admin/imports/preview', { body: { mode: 'create_products', file: 'not base64!' } }), 400, 'VALIDATION_FAILED');
        expectCode(await c.request('POST', '/api/v1/admin/imports/preview', { body: { mode: 'xlsx', file: b64('a') } }), 400, 'VALIDATION_FAILED');
        expectCode(await c.request('POST', '/api/v1/admin/imports/preview', { body: { mode: 'create_products', file: b64('a'), extra: 1 } }), 400, 'VALIDATION_FAILED');
        // 2 previews allowed by the test rule; the third is limited.
        const csv = `${CREATE_HEADER}\nكاندي,سكر,candy,1,1,1,,\n`;
        assert.equal((await preview(c, 'create_products', csv)).status, 200);
        const limited = await preview(c, 'create_products', csv);
        expectCode(limited, 429, 'RATE_LIMITED');
        assert.ok(Number(limited.headers['retry-after']) > 0);
      },
      { rules: { import_preview_account: { limit: 6, windowMs: 10 * MIN } } },
    ));
});

describe('create products', () => {
  test('Arabic UTF-8 with BOM/CRLF, quoted commas/quotes/multiline, exact barcodes and money; preview writes nothing; commit creates inactive zero-stock products', () =>
    withApp(async (app) => {
      const { c, account } = await admin(app);
      const csv =
        '﻿' +
        `${CREATE_HEADER}\r\n` +
        '"شيكولاتة بالبندق، عبوة الجملة","نور ""الأصلي""",chocolate,125.50,24,2,000123,\r\n' +
        '"ويفر\r\nبالكريمة",سكر,wafers_biscuits,80,12,1,,https://img.example/w.png\r\n' +
        'كاندي فواكه,Candy Co,candy,0.29,48,1,AbC-09,\r\n';
      const before = totals(app);
      const p = await preview(c, 'create_products', csv);
      assert.equal(p.status, 200, p.body);
      assert.deepEqual(p.json.summary, { records: 3, valid: 3, invalid: 0 });
      assert.deepEqual(p.json.rows.map((r: any) => [r.recordNo, r.line]), [[1, 2], [2, 3], [3, 5]]);
      assert.equal(p.json.rows[0].change.product.cartonPriceCents, 12550);
      assert.equal(p.json.rows[0].change.active, false);
      assert.equal(p.json.rows[0].change.onHand, 0);
      assert.deepEqual(totals(app), before, 'preview must not write products, ledger, audit or import rows');

      const r = await commit(c, 'create_products', csv, p.json.previewToken);
      assert.equal(r.status, 201, r.body);
      assert.equal(r.json.replayed, false);
      assert.equal(r.json.import.status, 'committed');
      assert.equal(r.json.import.recordCount, 3);
      const [a, b, k] = r.json.import.items.map((i: any) => i.productId);
      assert.deepEqual(
        [product(app, a), product(app, b), product(app, k)].map((x) => [x.name, x.brand, x.barcode, x.price_cents, x.image_url, x.active, x.on_hand, x.reserved, x.is_demo, x.version]),
        [
          ['شيكولاتة بالبندق، عبوة الجملة', 'نور "الأصلي"', '000123', 12550, null, 0, 0, 0, 0, 1],
          ['ويفر\r\nبالكريمة', 'سكر', null, 8000, 'https://img.example/w.png', 0, 0, 0, 0, 1],
          ['كاندي فواكه', 'Candy Co', 'AbC-09', 29, null, 0, 0, 0, 0, 1],
        ],
      );
      // Existing audit behaviour per product, plus one batch event naming no file content.
      assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'product.created'"), 3);
      const batch = app.fixtureDb.prepare("SELECT actor_user_id, metadata FROM audit_logs WHERE action = 'import.committed'").get() as { actor_user_id: string; metadata: string };
      assert.equal(batch.actor_user_id, account.id);
      assert.deepEqual(Object.keys(JSON.parse(batch.metadata)).sort(), ['file_bytes', 'import_id', 'mode', 'records']);
      assert.equal(count(app, 'SELECT count(*) FROM import_operation_items WHERE ledger_id IS NULL'), 3);
    }));

  test('every invalid field is reported per record with useful numbers; no token; nothing written', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      insertProduct(app.fixtureDb, { barcode: '555' });
      const csv = [
        CREATE_HEADER,
        'ك,ب,candy,1e3,1.5,010,,', // name too short, exponent price, fractional pack, leading-zero minimum
        'كاندي,سكر,candy,12.345,٢٤,1,,', // extra decimals, Arabic digits
        'كاندي,سكر,candy,"1,250.50",24,0,,', // thousands separator, minimum 0
        'كاندي,سكر,unknown_cat,10,24,1,555,', // unknown category, barcode in use
        'كاندي,سكر,candy,10,24,1,dup1,http://img.example/x.png', // http image
        'كاندي,سكر,candy,10,24,1,dup1,', // duplicate barcode in file
        'كاندي,سكر,candy,Infinity,NaN,1,,',
        'only,two',
        ',,,,,,,',
      ].join('\n');
      const before = totals(app);
      const p = await preview(c, 'create_products', csv);
      assert.equal(p.status, 200);
      assert.equal(p.json.previewToken, null);
      assert.equal(p.json.summary.invalid, 9);
      const fields = p.json.rows.map((r: any) => r.errors.map((e: any) => e.field).sort().join('|'));
      assert.deepEqual(fields, [
        'cartonPriceEgp|minimumCartons|name|packSize',
        'cartonPriceEgp|packSize',
        'cartonPriceEgp|minimumCartons',
        'barcode|category',
        'imageUrl',
        'barcode',
        'cartonPriceEgp|packSize',
        '',
        '',
      ]);
      assert.match(p.json.rows[1].errors.find((e: any) => e.field === 'cartonPriceEgp').message, /لا يتم التقريب/);
      assert.match(p.json.rows[5].errors[0].message, /السجل 5/);
      assert.match(p.json.rows[7].errors[0].message, /عدد الخلايا/);
      assert.deepEqual(totals(app), before);
    }));

  test('headers: unknown, duplicate and missing headers are file errors; header names are exact', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const cases: Array<[string, RegExp]> = [
        [`${CREATE_HEADER},stock\nا,ب,candy,1,1,1,,,5`, /غير معروف/],
        [`${CREATE_HEADER},brand\nاسم,ب,candy,1,1,1,,,ب`, /مكرر/],
        ['name,brand,category,packSize,minimumCartons\nاسم,ب,candy,1,1', /cartonPriceEgp/],
        ['Name,brand,category,cartonPriceEgp,packSize,minimumCartons\nاسم,ب,candy,1,1,1', /غير معروف/],
        ['name,brand,category,cartonPriceCents,packSize,minimumCartons\nاسم,ب,candy,100,1,1', /غير معروف/],
        ['name,brand,category,cartonPriceEgp,packSize,minimumCartons,active,isDemo,version\nاسم,ب,candy,1,1,1,1,1,1', /غير معروف/],
      ];
      for (const [csv, msg] of cases) {
        const p = await preview(c, 'create_products', csv);
        assert.equal(p.status, 200);
        assert.equal(p.json.previewToken, null);
        assert.match(p.json.fileErrors.map((e: any) => e.message).join(' '), msg, csv);
      }
    }));

  test('malformed files: invalid UTF-8, NUL, broken quoting, too many rows — file-level errors, no token', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const bad = [
        new Uint8Array([...Buffer.from(`${CREATE_HEADER}\n`), 0xc3, 0x28, ...Buffer.from(',b,candy,1,1,1,,\n')]),
        new Uint8Array([...Buffer.from(`${CREATE_HEADER}\nا`), 0, ...Buffer.from(',b,candy,1,1,1,,\n')]),
        `${CREATE_HEADER}\n"open,b,candy,1,1,1,,\n`,
        `${CREATE_HEADER}\nab"c,b,candy,1,1,1,,\n`,
        `${CREATE_HEADER}\n${'كاندي,سكر,candy,1,1,1,,\n'.repeat(1001)}`,
      ];
      for (const csv of bad) {
        const p = await preview(c, 'create_products', csv);
        assert.equal(p.status, 200);
        assert.equal(p.json.previewToken, null);
        assert.equal(p.json.rows.length, 0);
        assert.equal(p.json.fileErrors.length, 1);
      }
    }));

  test('hostile text is stored and returned exactly as text (no formula or HTML interpretation)', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const csv = `${CREATE_HEADER}\n"<img src=x onerror=alert(1)>","=HYPERLINK(""http://evil"")",candy,10,24,1,,\n`;
      const token = await previewOk(c, 'create_products', csv);
      const r = await commit(c, 'create_products', csv, token);
      assert.equal(r.status, 201, r.body);
      const p = product(app, r.json.import.items[0].productId);
      assert.equal(p.name, '<img src=x onerror=alert(1)>');
      assert.equal(p.brand, '=HYPERLINK("http://evil")');
    }));

  test('the 5,000-product cap is enforced inside the transaction, including for concurrent batches', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const t = Date.now();
      const ins = app.fixtureDb.prepare(
        "INSERT INTO products (id, name, brand, category, price_cents, on_hand, reserved, pack_size, minimum_cartons, active, is_demo, version, created_at, updated_at) VALUES (?, ?, 'ب', 'candy', 100, 0, 0, 1, 1, 0, 0, 1, ?, ?)",
      );
      app.fixtureDb.exec('BEGIN');
      for (let i = 0; i < 4997; i++) ins.run(randomUUID(), `منتج ${i}`, t, t);
      app.fixtureDb.exec('COMMIT');
      const fileA = `${CREATE_HEADER}\nمنتج أ1,ب,candy,1,1,1,,\nمنتج أ2,ب,candy,1,1,1,,\n`;
      const fileB = `${CREATE_HEADER}\nمنتج ب1,ب,candy,1,1,1,,\nمنتج ب2,ب,candy,1,1,1,,\n`;
      const [ta, tb] = [await previewOk(c, 'create_products', fileA), await previewOk(c, 'create_products', fileB)];
      const [ra, rb] = await Promise.all([commit(c, 'create_products', fileA, ta), commit(c, 'create_products', fileB, tb)]);
      const statuses = [ra.status, rb.status].sort();
      assert.deepEqual(statuses, [201, 422], `${ra.body} ${rb.body}`);
      const loser = ra.status === 422 ? ra : rb;
      expectCode(loser, 422, 'IMPORT_REJECTED');
      assert.match(JSON.stringify(loser.json.error.details.current.fileErrors), /5000/);
      assert.equal(count(app, 'SELECT count(*) FROM products'), 4999);
      assert.equal(count(app, 'SELECT count(*) FROM import_operations'), 1);
    }));
});

describe('update products', () => {
  test('empty = unchanged, __CLEAR__ clears optional fields only, packaging lock, no-op rows, duplicate ids, name is never an identifier', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const stocked = insertProduct(app.fixtureDb, { name: 'مخزون', barcode: '000777', onHand: 10 });
      const empty = insertProduct(app.fixtureDb, { name: 'فارغ', barcode: 'B-1', onHand: 0 });
      const other = insertProduct(app.fixtureDb, { name: 'آخر', barcode: 'TAKEN', onHand: 0 });
      const v = (id: string) => product(app, id).version as number;
      const header = 'productId,expectedVersion,currentName,name,cartonPriceEgp,packSize,barcode,imageUrl';
      const bad = [
        header,
        `${stocked},${v(stocked)},مخزون,,,12,,`, // pack change while stocked
        `${empty},${v(empty)},فارغ,__CLEAR__,,,,`, // cannot clear a required field
        `${other},${v(other)},آخر,,,,,`, // no change at all
        `${empty},${v(empty)},فارغ,,,,TAKEN,`, // duplicate product id + barcode of another product
        `${randomUUID()},1,,,10,,,`, // unknown id
        `شيكولاتة,1,,,10,,,`, // a name is not an identifier
      ].join('\n');
      const p = await preview(c, 'update_products', bad);
      assert.equal(p.json.previewToken, null);
      assert.deepEqual(p.json.rows.map((r: any) => r.status), ['error', 'error', 'error', 'error', 'error', 'error']);
      assert.match(p.json.rows[0].errors[0].message, /عدد القطع/);
      assert.match(p.json.rows[1].errors[0].message, /لا يمكن مسحه/);
      assert.match(p.json.rows[2].errors[0].message, /لا يغيّر/);
      assert.match(JSON.stringify(p.json.rows[3].errors), /أكثر من مرة/);
      assert.match(JSON.stringify(p.json.rows[3].errors), /مستخدم لمنتج آخر/);
      assert.match(p.json.rows[4].errors[0].message, /لا يوجد منتج/);
      assert.match(p.json.rows[5].errors[0].message, /UUID/);

      const good = [header, `${stocked},${v(stocked)},اسم قديم,مخزون جديد,99.99,,__CLEAR__,`, `${empty},${v(empty)},,,,6,,https://img.example/p.png`].join('\n');
      const pg = await preview(c, 'update_products', good);
      assert.equal(pg.json.summary.invalid, 0, pg.body);
      assert.match(pg.json.rows[0].warnings.join(' '), /يختلف عن الاسم الحالي/);
      assert.deepEqual(pg.json.rows[0].change.changes.map((x: any) => x.field).sort(), ['barcode', 'cartonPriceCents', 'name']);
      const r = await commit(c, 'update_products', good, pg.json.previewToken);
      assert.equal(r.status, 201, r.body);
      const s = product(app, stocked);
      assert.deepEqual([s.name, s.price_cents, s.barcode, s.pack_size, s.is_demo, s.on_hand], ['مخزون جديد', 9999, null, 24, 0, 10]);
      const e = product(app, empty);
      assert.deepEqual([e.name, e.pack_size, e.image_url, e.barcode], ['فارغ', 6, 'https://img.example/p.png', 'B-1']);
      assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'product.updated'"), 2);
    }));

  test('stale preview: a version change between preview and confirmation rejects the whole batch', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const a = insertProduct(app.fixtureDb, { name: 'منتج أ', onHand: 0 });
      const b = insertProduct(app.fixtureDb, { name: 'منتج ب', onHand: 0 });
      const v = (id: string) => product(app, id).version as number;
      const csv = `productId,expectedVersion,name\n${a},${v(a)},أ جديد\n${b},${v(b)},ب جديد\n`;
      const token = await previewOk(c, 'update_products', csv);
      const edit = await c.request('PATCH', `/api/v1/admin/products/${b}`, { body: { expectedVersion: v(b), name: 'ب من شاشة أخرى' } });
      assert.equal(edit.status, 200);
      const before = totals(app);
      const r = await commit(c, 'update_products', csv, token);
      expectCode(r, 422, 'IMPORT_REJECTED');
      assert.equal(r.json.error.details.current.rows[0].recordNo, 2);
      assert.match(r.json.error.details.current.rows[0].errors[0].message, /الإصدار/);
      assert.deepEqual(totals(app), before);
      assert.equal(product(app, a).name, 'منتج أ', 'the valid first record was not applied either');
    }));
});

describe('stock imports', () => {
  test('receipts and set-total: one ledger row per record with actor/reason/reference, reserved unchanged, balances match', () =>
    withApp(async (app) => {
      const { c, account } = await admin(app);
      const a = insertProduct(app.fixtureDb, { name: 'منتج أ', onHand: 10, reserved: 4 });
      const b = insertProduct(app.fixtureDb, { name: 'منتج ب', onHand: 0, active: false });
      const v = (id: string) => product(app, id).version as number;
      const receipt = `productId,expectedVersion,quantity,reason,reference\n${a},${v(a)},5,استلام فاتورة,INV-1\n${b},${v(b)},20,"استلام، شحنة أولى",\n`;
      const p = await preview(c, 'receive_stock', receipt);
      assert.deepEqual(p.json.rows[0].change, { version: v(a), onHandBefore: 10, delta: 5, onHandAfter: 15, reserved: 4, availableAfter: 11 });
      assert.match(p.json.rows[1].warnings.join(' '), /غير مفعّل/);
      const r = await commit(c, 'receive_stock', receipt, p.json.previewToken);
      assert.equal(r.status, 201, r.body);
      const rows = app.fixtureDb
        .prepare('SELECT l.product_id, l.kind, l.adjustment_type, l.on_hand_delta, l.reserved_delta, l.on_hand_after, l.reserved_after, l.reason, l.external_ref, l.actor_user_id, l.product_version_after, l.operation_key FROM inventory_ledger l JOIN import_operation_items i ON i.ledger_id = l.id ORDER BY i.record_no')
        .all() as any[];
      assert.deepEqual(
        rows.map((x) => [x.product_id, x.kind, x.adjustment_type, x.on_hand_delta, x.reserved_delta, x.on_hand_after, x.reserved_after, x.reason, x.external_ref, x.actor_user_id, x.operation_key]),
        [
          [a, 'receipt', 'receipt', 5, 0, 15, 4, 'استلام فاتورة', 'INV-1', account.id, null],
          [b, 'receipt', 'receipt', 20, 0, 20, 0, 'استلام، شحنة أولى', null, account.id, null],
        ],
      );
      assert.deepEqual([product(app, a).on_hand, product(app, a).reserved, product(app, a).version], [15, 4, rows[0].product_version_after]);
      assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'inventory.adjusted'"), 2);

      // set_stock_total: below reserved and no-op refused; replaces the physical total otherwise.
      const st = (total: number) => `productId,expectedVersion,total,reason\n${a},${v(a)},${total},جرد شهري\n`;
      const below = await preview(c, 'set_stock_total', st(3));
      assert.match(below.json.rows[0].errors[0].message, /المحجوزة/);
      const noop = await preview(c, 'set_stock_total', st(15));
      assert.match(noop.json.rows[0].errors[0].message, /لا تغيّر/);
      const ok = await preview(c, 'set_stock_total', st(4));
      assert.match(ok.json.rows[0].warnings.join(' '), /تستبدل الرصيد الفعلي/);
      const r2 = await commit(c, 'set_stock_total', st(4), ok.json.previewToken);
      assert.equal(r2.status, 201, r2.body);
      assert.deepEqual([product(app, a).on_hand, product(app, a).reserved], [4, 4]);
      const sums = app.fixtureDb.prepare('SELECT sum(on_hand_delta) AS s, sum(reserved_delta) AS r FROM inventory_ledger WHERE product_id = ?').get(a) as { s: number; r: number };
      assert.deepEqual([sums.s, sums.r], [4, 4]);
    }));

  test('a reservation made after the preview makes the set-total stale; the batch is refused and nothing changes', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const a = insertProduct(app.fixtureDb, { name: 'منتج أ', onHand: 10 });
      const csv = `productId,expectedVersion,total,reason\n${a},${product(app, a).version},5,جرد\n`;
      const token = await previewOk(c, 'set_stock_total', csv);
      const { fixtureReserve } = await import('../helpers/database.ts');
      fixtureReserve(app.fixtureDb, a, 8); // confirmed order reserves 8 (version advances)
      const before = totals(app);
      expectCode(await commit(c, 'set_stock_total', csv, token), 422, 'IMPORT_REJECTED');
      assert.deepEqual(totals(app), before);
      assert.deepEqual([product(app, a).on_hand, product(app, a).reserved], [10, 8]);
    }));
});

describe('all-or-nothing under injected failures', () => {
  test('a database failure on a MIDDLE record rolls back the whole batch; the key is not consumed', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const ids = [1, 2, 3].map((n) => insertProduct(app.fixtureDb, { name: `منتج ${n}`, onHand: 1 }));
      const csv = `productId,expectedVersion,quantity,reason\n${ids.map((id, i) => `${id},${product(app, id).version},${i + 1},${i === 1 ? 'سبب يفشل' : 'استلام'}`).join('\n')}\n`;
      const token = await previewOk(c, 'receive_stock', csv);
      // TEST-ONLY failure injection: the database refuses the second record's ledger row.
      app.fixtureDb.exec("CREATE TRIGGER test_fail_middle BEFORE INSERT ON inventory_ledger WHEN NEW.reason = 'سبب يفشل' BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
      const before = totals(app);
      const key = randomUUID();
      const r = await commit(c, 'receive_stock', csv, token, key);
      expectCode(r, 500, 'INTERNAL');
      assert.doesNotMatch(r.body, /injected|inventory_ledger|sqlite/i, 'no raw database error in the response');
      assert.deepEqual(totals(app), before, 'first record rolled back too');
      app.fixtureDb.exec('DROP TRIGGER test_fail_middle');
      const again = await commit(c, 'receive_stock', csv, token, key);
      assert.equal(again.status, 201, again.body);
      assert.equal(again.json.replayed, false, 'the failed attempt did not consume the key');
      assert.deepEqual(ids.map((id) => product(app, id).on_hand), [2, 3, 4]);
    }));

  test('an audit failure at the end rolls back every product of the batch', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const csv = `${CREATE_HEADER}\nأول,ب,candy,1,1,1,,\nثان,ب,candy,1,1,1,,\n`;
      const token = await previewOk(c, 'create_products', csv);
      app.fixtureDb.exec("CREATE TRIGGER test_fail_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'import.committed' BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END");
      const before = totals(app);
      expectCode(await commit(c, 'create_products', csv, token), 500, 'INTERNAL');
      assert.deepEqual(totals(app), before);
      app.fixtureDb.exec('DROP TRIGGER test_fail_audit');
    }));
});

describe('confirmation binding', () => {
  test('tampered content, token, mode or administrator are refused; an expired preview needs a new one', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const csv = `${CREATE_HEADER}\nأصلي,ب,candy,10,1,1,,\n`;
      const token = await previewOk(c, 'create_products', csv);
      expectCode(await commit(c, 'create_products', csv.replace('10', '1'), token), 409, 'IMPORT_PREVIEW_INVALID');
      const [body, sig] = token.split('.');
      const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), e: Date.now() * 10 })).toString('base64url');
      expectCode(await commit(c, 'create_products', csv, `${forged}.${sig}`), 409, 'IMPORT_PREVIEW_INVALID');
      expectCode(await commit(c, 'create_products', csv, `${body}.${'A'.repeat(sig!.length)}`), 409, 'IMPORT_PREVIEW_INVALID');
      expectCode(await commit(c, 'update_products', csv, token), 409, 'IMPORT_PREVIEW_INVALID');
      const other = await admin(app);
      expectCode(await commit(other.c, 'create_products', csv, token), 409, 'IMPORT_PREVIEW_INVALID');
      assert.equal(count(app, 'SELECT count(*) FROM products'), 0);

      app.clock.advance(21 * MIN);
      const fresh = await admin(app); // recent authentication for the commit
      const token2 = await previewOk(fresh.c, 'create_products', csv);
      app.clock.advance(21 * MIN);
      const fresh2 = new Client(app, ip());
      assert.equal((await fresh2.login(fresh.account.username, fresh.account.password, fresh.account.code())).status, 200);
      expectCode(await commit(fresh2, 'create_products', csv, token2), 409, 'IMPORT_PREVIEW_EXPIRED');
      assert.equal(count(app, 'SELECT count(*) FROM products'), 0);
    }));

  test('recent authentication expiring WHILE the confirmation is in flight is caught inside the transaction', () =>
    withApp(async (app) => {
      const { c, account } = await admin(app);
      const csv = `${CREATE_HEADER}\nأصلي,ب,candy,10,1,1,,\n`;
      const token = await previewOk(c, 'create_products', csv);
      const r = await c.requestSlow('POST', '/api/v1/admin/imports/commit', { mode: 'create_products', file: b64(csv), previewToken: token, operationKey: randomUUID() }, () => {
        // The request already passed the entry check; the sign-in time now becomes older than 15 minutes.
        app.fixtureDb.prepare('UPDATE sessions SET created_at = created_at - 16 * 60000, auth_at = auth_at - 16 * 60000 WHERE user_id = ?').run(account.id);
      });
      expectCode(r, 428, 'RECENT_AUTH_REQUIRED');
      assert.equal(count(app, 'SELECT count(*) FROM products'), 0);
      assert.equal(count(app, 'SELECT count(*) FROM import_operations'), 0);
    }));

  test('a session revoked or an administrator demoted between preview and confirmation writes nothing', () =>
    withApp(async (app) => {
      const { c, account } = await admin(app);
      const csv = `${CREATE_HEADER}\nأصلي,ب,candy,10,1,1,,\n`;
      const token = await previewOk(c, 'create_products', csv);
      const r = await c.requestSlow('POST', '/api/v1/admin/imports/commit', { mode: 'create_products', file: b64(csv), previewToken: token, operationKey: randomUUID() }, () => {
        app.fixtureDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(account.id);
      });
      expectCode(r, 401, 'UNAUTHENTICATED');
      assert.equal(count(app, 'SELECT count(*) FROM products'), 0);
    }));
});

describe('durable idempotency', () => {
  test('same key + same file returns the original result (even after expiry and newer versions); other content under the key is 409', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const a = insertProduct(app.fixtureDb, { name: 'منتج أ', onHand: 1 });
      const csv = `productId,expectedVersion,quantity,reason\n${a},${product(app, a).version},5,استلام\n`;
      const token = await previewOk(c, 'receive_stock', csv);
      const key = randomUUID();
      const first = await commit(c, 'receive_stock', csv, token, key);
      assert.equal(first.status, 201, first.body);
      // The batch moved the version on: a naive re-validation would now call it stale.
      app.clock.advance(14 * MIN);
      const again = await commit(c, 'receive_stock', csv, token, key);
      assert.equal(again.status, 200, again.body);
      assert.equal(again.json.replayed, true);
      assert.deepEqual(again.json.import, first.json.import);
      assert.equal(product(app, a).on_hand, 6, 'applied exactly once');
      expectCode(await commit(c, 'receive_stock', csv.replace(',5,', ',7,'), token, key), 409, 'IDEMPOTENCY_KEY_REUSED');
      assert.equal(count(app, 'SELECT count(*) FROM import_operations'), 1);
    }));

  test('replay after the preview expired, with a fresh login', () =>
    withApp(async (app) => {
      const { c, account } = await admin(app);
      const csv = `${CREATE_HEADER}\nأصلي,ب,candy,10,1,1,,\n`;
      const token = await previewOk(c, 'create_products', csv);
      const key = randomUUID();
      assert.equal((await commit(c, 'create_products', csv, token, key)).status, 201);
      app.clock.advance(30 * MIN);
      const c2 = new Client(app, ip());
      assert.equal((await c2.login(account.username, account.password, account.code(1))).status, 200);
      const replay = await commit(c2, 'create_products', csv, token, key);
      assert.equal(replay.status, 200, replay.body);
      assert.equal(replay.json.replayed, true);
      assert.equal(count(app, 'SELECT count(*) FROM products'), 1);
      // A different administrator cannot read the result under that key: keys are per administrator.
      const other = await admin(app);
      expectCode(await commit(other.c, 'create_products', csv, token, key), 409, 'IMPORT_PREVIEW_INVALID');
      assert.equal(count(app, 'SELECT count(*) FROM products'), 1);
    }));

  test('concurrent identical confirmations commit exactly one batch', () =>
    withApp(async (app) => {
      const { c } = await admin(app);
      const csv = `${CREATE_HEADER}\nأول,ب,candy,10,1,1,,\nثان,ب,candy,10,1,1,,\n`;
      const token = await previewOk(c, 'create_products', csv);
      const key = randomUUID();
      const results = await Promise.all([commit(c, 'create_products', csv, token, key), commit(c, 'create_products', csv, token, key)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 201], results.map((r) => r.body).join(' '));
      assert.equal(results[0]!.json.import.id, results[1]!.json.import.id);
      assert.equal(count(app, 'SELECT count(*) FROM products'), 2);
      assert.equal(count(app, 'SELECT count(*) FROM import_operations'), 1);
    }));
});
