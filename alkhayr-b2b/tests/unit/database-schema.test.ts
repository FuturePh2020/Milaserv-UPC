import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { isForeignKeyError, SQLITE } from '../../src/server/database/errors.ts';
import { PRODUCT_CATEGORIES } from '../../src/shared/categories.ts';
import { BUSINESS_SETTING_DEFAULTS } from '../../src/shared/constants.ts';
import { createTestDatabase, insertMerchant, insertOrder, insertProduct, insertUser, now, sqliteFailure, type TestDatabase } from '../helpers/database.ts';

let t: TestDatabase;
let db: DatabaseSync;
before(() => {
  t = createTestDatabase();
  db = t.db;
});
after(() => t.cleanup());

const scalar = (sql: string, ...params: Array<string | number | null>) => Object.values(db.prepare(sql).get(...params) as object)[0];

function fails(fn: () => unknown, errcode: number, pattern?: RegExp) {
  const f = sqliteFailure(fn);
  assert.equal(f.errcode, errcode, f.message);
  if (pattern) assert.match(f.message, pattern);
}

/** FK violations: errcode 787 or 1811 depending on the enforcement path; see isForeignKeyError. */
function failsFk(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    assert.ok(isForeignKeyError(err), String(err));
    return;
  }
  assert.fail('expected a foreign-key violation');
}

function trader() {
  const userId = insertUser(db);
  return { userId, merchantId: insertMerchant(db, userId) };
}

describe('initial configuration (owner decisions)', () => {
  test('every table is STRICT', () => {
    const rows = db.prepare("SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string; strict: number }>;
    assert.equal(rows.length, 13);
    for (const r of rows) assert.equal(r.strict, 1, `${r.name} must be STRICT`);
  });

  test('categories in the database equal src/shared/categories.ts exactly', () => {
    const rows = db.prepare('SELECT id, label_ar AS labelAr, sort_order AS sortOrder FROM product_categories ORDER BY sort_order').all();
    assert.deepEqual(rows.map((r) => ({ ...r })), PRODUCT_CATEGORIES.map((c) => ({ ...c })));
    assert.equal(scalar('SELECT count(*) FROM product_categories WHERE active = 1'), 4);
  });

  test('business settings hold the pilot defaults and no invented company data', () => {
    const s = db.prepare('SELECT * FROM business_settings').all() as Array<Record<string, unknown>>;
    assert.equal(s.length, 1);
    const row = s[0]!;
    assert.deepEqual(
      {
        taxBps: row.tax_bps,
        shippingCents: row.shipping_cents,
        shippingTaxable: row.shipping_taxable === 1,
        minimumOrderCents: row.minimum_order_cents,
        lowStockThresholdCartons: row.low_stock_threshold_cartons,
      },
      { ...BUSINESS_SETTING_DEFAULTS },
    );
    assert.equal(row.company_name, null);
    assert.equal(row.company_phone, null);
    assert.equal(row.company_email, null);
    assert.equal(row.company_address, null);
    assert.equal(row.version, 1);
  });

  test('no users, sessions, products, orders, balances or audit rows are seeded', () => {
    const fresh = createTestDatabase();
    try {
      for (const table of ['auth_users', 'merchants', 'sessions', 'products', 'orders', 'order_items', 'order_events', 'inventory_ledger', 'audit_logs', 'rate_limits']) {
        assert.equal(Object.values(fresh.db.prepare(`SELECT count(*) FROM ${table}`).get() as object)[0], 0, table);
      }
    } finally {
      fresh.cleanup();
    }
  });

  test('settings: single row, bounded integers, no deletion, version must advance', () => {
    fails(() => db.prepare("INSERT INTO business_settings (id, shipping_cents, shipping_taxable, tax_bps, minimum_order_cents, low_stock_threshold_cartons, updated_at) VALUES (2, 0, 0, 0, 0, 10, 1)").run(), SQLITE.CONSTRAINT_CHECK);
    fails(() => db.exec('DELETE FROM business_settings'), SQLITE.CONSTRAINT_TRIGGER);
    fails(() => db.exec('UPDATE business_settings SET tax_bps = 10001, version = version + 1'), SQLITE.CONSTRAINT_CHECK);
    fails(() => db.prepare('UPDATE business_settings SET shipping_cents = ?, version = version + 1').run(0.5), SQLITE.CONSTRAINT_DATATYPE);
    fails(() => db.exec('UPDATE business_settings SET shipping_taxable = 2, version = version + 1'), SQLITE.CONSTRAINT_CHECK);
    fails(() => db.exec('UPDATE business_settings SET tax_bps = 100'), SQLITE.CONSTRAINT_TRIGGER, /version/);
  });
});

describe('accounts', () => {
  test('roles and statuses are restricted; admins require an MFA secret', () => {
    fails(() => insertUser(db, { role: 'superadmin' }), SQLITE.CONSTRAINT_CHECK, /auth_users_role/);
    fails(() => insertUser(db, { role: 'admin', totp: null }), SQLITE.CONSTRAINT_CHECK, /auth_users_admin_requires_totp/);
    const u = insertUser(db);
    fails(() => insertMerchant(db, u, { status: 'active' }), SQLITE.CONSTRAINT_CHECK, /merchants_status/);
    assert.ok(insertUser(db, { role: 'admin' }));
  });

  test('usernames are unique case-insensitively and must be stored normalized', () => {
    insertUser(db, { username: 'trader.one' });
    fails(() => insertUser(db, { username: 'trader.one' }), SQLITE.CONSTRAINT_UNIQUE);
    fails(() => insertUser(db, { username: 'TRADER.ONE' }), SQLITE.CONSTRAINT_CHECK, /auth_users_username_format/);
    fails(() => insertUser(db, { username: 'Trader.One' }), SQLITE.CONSTRAINT_CHECK);
    for (const bad of ['ab', '.dot', 'has space', 'ahmed@x', 'أحمد', 'x'.repeat(33)]) {
      fails(() => insertUser(db, { username: bad }), SQLITE.CONSTRAINT_CHECK);
    }
  });

  test('one merchant profile per user; foreign keys enforced; users with history cannot be deleted', () => {
    const u = insertUser(db);
    insertMerchant(db, u);
    fails(() => insertMerchant(db, u), SQLITE.CONSTRAINT_UNIQUE);
    failsFk(() => insertMerchant(db, randomUUID()));
    failsFk(() => db.prepare('DELETE FROM auth_users WHERE id = ?').run(u));
  });

  test('merchant version must advance on every update', () => {
    const { merchantId } = trader();
    fails(() => db.prepare("UPDATE merchants SET status = 'suspended', access_version = access_version + 1 WHERE id = ?").run(merchantId), SQLITE.CONSTRAINT_TRIGGER);
    db.prepare("UPDATE merchants SET status = 'suspended', access_version = access_version + 1, version = version + 1 WHERE id = ?").run(merchantId);
    assert.equal(scalar('SELECT version FROM merchants WHERE id = ?', merchantId), 2);
  });

  test('migration 0002: access_version advances by exactly 1 with every status change and never otherwise', () => {
    const { merchantId } = trader();
    const row = () => db.prepare('SELECT status, version, access_version FROM merchants WHERE id = ?').get(merchantId) as { status: string; version: number; access_version: number };
    assert.equal(row().access_version, 1);
    fails(() => db.prepare("UPDATE merchants SET status = 'suspended', version = version + 1 WHERE id = ?").run(merchantId), SQLITE.CONSTRAINT_TRIGGER, /access_version must increase/);
    fails(() => db.prepare("UPDATE merchants SET status = 'suspended', access_version = access_version + 2, version = version + 1 WHERE id = ?").run(merchantId), SQLITE.CONSTRAINT_TRIGGER);
    fails(() => db.prepare('UPDATE merchants SET access_version = access_version + 1, version = version + 1 WHERE id = ?').run(merchantId), SQLITE.CONSTRAINT_TRIGGER, /only together with status/);
    fails(() => db.prepare('UPDATE merchants SET access_version = 1.5, version = version + 1 WHERE id = ?').run(merchantId), SQLITE.CONSTRAINT_DATATYPE);
    db.prepare("UPDATE merchants SET status = 'suspended', access_version = access_version + 1, version = version + 1 WHERE id = ?").run(merchantId);
    db.prepare("UPDATE merchants SET status = 'approved', access_version = access_version + 1, version = version + 1 WHERE id = ?").run(merchantId);
    assert.deepEqual({ ...row() }, { status: 'approved', version: 3, access_version: 3 }, 'ABA leaves a different access_version');
    db.prepare("UPDATE merchants SET address = '15 شارع جديد', version = version + 1 WHERE id = ?").run(merchantId);
    assert.equal(row().access_version, 3, 'profile edits do not touch it');
  });

  test('sessions store only SHA-256 hex token hashes and are removed with their user', () => {
    const u = insertUser(db);
    const insert = (hash: string) =>
      db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, auth_at, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(hash, u, now(), now(), now() + 1000, now(), now());
    fails(() => insert('raw-session-token-value-should-never-be-stored'), SQLITE.CONSTRAINT_CHECK, /sessions_token_hash_sha256/);
    fails(() => insert('A'.repeat(64)), SQLITE.CONSTRAINT_CHECK);
    insert('a'.repeat(64));
    fails(() => insert('a'.repeat(64)), SQLITE.CONSTRAINT_PRIMARYKEY);
    db.prepare('DELETE FROM auth_users WHERE id = ?').run(u);
    assert.equal(scalar('SELECT count(*) FROM sessions WHERE user_id = ?', u), 0);
  });
});

describe('products', () => {
  test('nonempty barcodes are unique text that keeps leading zeros; empty is not allowed (use NULL)', () => {
    const id = insertProduct(db, { barcode: '000123' });
    const row = db.prepare('SELECT barcode, typeof(barcode) AS t FROM products WHERE id = ?').get(id) as { barcode: unknown; t: string };
    assert.equal(row.barcode, '000123');
    assert.equal(row.t, 'text');
    fails(() => insertProduct(db, { barcode: '000123' }), SQLITE.CONSTRAINT_UNIQUE);
    insertProduct(db, { barcode: '00123' }); // different text, different barcode
    insertProduct(db, { barcode: null });
    insertProduct(db, { barcode: null }); // multiple products without barcode
    fails(() => insertProduct(db, { barcode: '' }), SQLITE.CONSTRAINT_CHECK, /products_barcode_format/);
    fails(() => insertProduct(db, { barcode: '12 34' }), SQLITE.CONSTRAINT_CHECK);
  });

  test('categories must exist in product_categories and cannot be deleted', () => {
    failsFk(() => insertProduct(db, { category: 'cookies' }));
    fails(() => db.exec("DELETE FROM product_categories WHERE id = 'candy'"), SQLITE.CONSTRAINT_TRIGGER);
    for (const c of PRODUCT_CATEGORIES) insertProduct(db, { category: c.id });
  });

  test('fractional money and quantities are rejected, never silently stored', () => {
    fails(() => insertProduct(db, { price: 1050.5 }), SQLITE.CONSTRAINT_DATATYPE, /REAL value in INTEGER column/);
    fails(() => insertProduct(db, { onHand: 2.5 }), SQLITE.CONSTRAINT_DATATYPE);
    fails(() => insertProduct(db, { reserved: 0.5 }), SQLITE.CONSTRAINT_DATATYPE);
    fails(() => insertProduct(db, { pack: 12.25 }), SQLITE.CONSTRAINT_DATATYPE);
    fails(() => insertProduct(db, { min: 1.5 }), SQLITE.CONSTRAINT_DATATYPE);
  });

  test('integral but out-of-range values are rejected', () => {
    fails(() => insertProduct(db, { price: 0 }), SQLITE.CONSTRAINT_CHECK, /products_price_range/);
    fails(() => insertProduct(db, { price: -100 }), SQLITE.CONSTRAINT_CHECK);
    fails(() => insertProduct(db, { price: 100_000_001 }), SQLITE.CONSTRAINT_CHECK);
    fails(() => insertProduct(db, { pack: 0 }), SQLITE.CONSTRAINT_CHECK, /products_pack_size_range/);
    fails(() => insertProduct(db, { min: 0 }), SQLITE.CONSTRAINT_CHECK, /products_minimum_range/);
    fails(() => insertProduct(db, { onHand: -1 }), SQLITE.CONSTRAINT_CHECK);
  });

  test('documented SQLite behaviour: a numeric TEXT value is converted, so services must validate input types', () => {
    // STRICT converts losslessly-convertible text ("100") to INTEGER. The stored value is an
    // integer, never text or a float; type validation of API input is the service layer's job.
    const id = insertProduct(db, { price: '100' });
    assert.deepEqual({ ...(db.prepare('SELECT price_cents AS p, typeof(price_cents) AS t FROM products WHERE id = ?').get(id) as object) }, { p: 100, t: 'integer' });
    fails(() => insertProduct(db, { price: '100.5' }), SQLITE.CONSTRAINT_DATATYPE);
    fails(() => insertProduct(db, { price: 'abc' }), SQLITE.CONSTRAINT_DATATYPE);
  });

  test('on_hand >= reserved >= 0 is enforced on insert and update', () => {
    fails(() => insertProduct(db, { onHand: 5, reserved: 6 }), SQLITE.CONSTRAINT_CHECK, /products_reserved_le_on_hand/);
    fails(() => insertProduct(db, { reserved: -1 }), SQLITE.CONSTRAINT_CHECK, /products_reserved_nonnegative/);
    const id = insertProduct(db, { onHand: 10, reserved: 4 });
    fails(() => db.prepare('UPDATE products SET on_hand = 3, version = version + 1 WHERE id = ?').run(id), SQLITE.CONSTRAINT_CHECK, /products_reserved_le_on_hand/);
    fails(() => db.prepare('UPDATE products SET reserved = 11, version = version + 1 WHERE id = ?').run(id), SQLITE.CONSTRAINT_CHECK);
    db.prepare('UPDATE products SET reserved = 10, version = version + 1 WHERE id = ?').run(id);
    assert.equal(scalar('SELECT on_hand - reserved FROM products WHERE id = ?', id), 0);
  });

  test('available stock is not a stored column', () => {
    const cols = (db.prepare('PRAGMA table_info(products)').all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(!cols.some((c) => /avail/i.test(c)), cols.join(','));
  });

  test('every product update must advance version (stock changes included)', () => {
    const id = insertProduct(db);
    fails(() => db.prepare('UPDATE products SET on_hand = on_hand + 5 WHERE id = ?').run(id), SQLITE.CONSTRAINT_TRIGGER, /version/);
    fails(() => db.prepare('UPDATE products SET price_cents = 999, version = version + 2 WHERE id = ?').run(id), SQLITE.CONSTRAINT_TRIGGER);
    db.prepare('UPDATE products SET on_hand = on_hand + 5, version = version + 1 WHERE id = ?').run(id);
  });

  test('image URLs must be https', () => {
    const insertWithImage = (url: string) =>
      db.prepare("INSERT INTO products (id, name, brand, category, image_url, price_cents, pack_size, created_at, updated_at) VALUES (?, 'منتج', 'ب', 'candy', ?, 100, 1, 1, 1)").run(randomUUID(), url);
    fails(() => insertWithImage('http://img.example/x.png'), SQLITE.CONSTRAINT_CHECK, /products_image_https/);
    fails(() => insertWithImage('javascript:alert(1)'), SQLITE.CONSTRAINT_CHECK);
    insertWithImage('https://img.example/x.png');
  });
});

describe('orders, items and snapshots', () => {
  test('integral cartons and cents; totals and tax base must be consistent', () => {
    const { userId, merchantId } = trader();
    const p = insertProduct(db);
    fails(() => insertOrder(db, { userId, merchantId, items: [{ productId: p, cartons: 2.5, unitPrice: 100 }] }), SQLITE.CONSTRAINT_DATATYPE);
    fails(() => insertOrder(db, { userId, merchantId, items: [{ productId: p, cartons: 0, unitPrice: 100 }] }), SQLITE.CONSTRAINT_CHECK);
    fails(() => insertOrder(db, { userId, merchantId, items: [{ productId: p, cartons: 2, unitPrice: 100, lineTotal: 199 }] }), SQLITE.CONSTRAINT_CHECK, /order_items_line_total/);
    fails(() => insertOrder(db, { userId, merchantId, totalOverride: 1, items: [{ productId: p, cartons: 2, unitPrice: 100 }] }), SQLITE.CONSTRAINT_CHECK, /orders_total/);
    fails(() => insertOrder(db, { userId, merchantId, taxBps: 1400, taxCents: 10.5, items: [{ productId: p, cartons: 2, unitPrice: 100 }] }), SQLITE.CONSTRAINT_DATATYPE);
    // tax base excludes shipping unless shipping_taxable = 1
    insertOrder(db, { userId, merchantId, shipping: 5000, shippingTaxable: 0, taxBps: 1400, items: [{ productId: p, cartons: 2, unitPrice: 100 }] });
    const o = insertOrder(db, { userId, merchantId, shipping: 5000, shippingTaxable: 1, taxBps: 1400, items: [{ productId: p, cartons: 2, unitPrice: 100 }] });
    assert.equal(scalar('SELECT tax_base_cents FROM orders WHERE id = ?', o), 5200);
  });

  test('an order cannot be created in a non-pending state', () => {
    const { userId, merchantId } = trader();
    fails(() => insertOrder(db, { userId, merchantId, state: 'confirmed', items: [{ productId: insertProduct(db), cartons: 1, unitPrice: 100 }] }), SQLITE.CONSTRAINT_TRIGGER);
    // The BEFORE INSERT trigger fires before the CHECK constraint, so it reports first.
    fails(() => insertOrder(db, { userId, merchantId, state: 'paid', items: [{ productId: insertProduct(db), cartons: 1, unitPrice: 100 }] }), SQLITE.CONSTRAINT_TRIGGER);
  });

  test('one line per product per order', () => {
    const { userId, merchantId } = trader();
    const p = insertProduct(db);
    fails(() => insertOrder(db, { userId, merchantId, items: [{ productId: p, cartons: 1, unitPrice: 100 }, { productId: p, cartons: 2, unitPrice: 100 }] }), SQLITE.CONSTRAINT_PRIMARYKEY);
  });

  test('request keys are unique per merchant, not globally', () => {
    const a = trader();
    const b = trader();
    const key = randomUUID();
    insertOrder(db, { ...a, requestKey: key, items: [{ productId: insertProduct(db), cartons: 1, unitPrice: 100 }] });
    fails(() => insertOrder(db, { ...a, requestKey: key, items: [{ productId: insertProduct(db), cartons: 1, unitPrice: 100 }] }), SQLITE.CONSTRAINT_UNIQUE, /merchant_id, orders\.request_key/);
    insertOrder(db, { ...b, requestKey: key, items: [{ productId: insertProduct(db), cartons: 1, unitPrice: 100 }] });
    fails(() => insertOrder(db, { ...a, requestKey: 'not-a-uuid', items: [{ productId: insertProduct(db), cartons: 1, unitPrice: 100 }] }), SQLITE.CONSTRAINT_CHECK);
  });

  test('foreign keys: unknown merchant or product is rejected; referenced products cannot be deleted', () => {
    const { userId } = trader();
    const p = insertProduct(db);
    failsFk(() => insertOrder(db, { userId, merchantId: randomUUID(), items: [{ productId: p, cartons: 1, unitPrice: 100 }] }));
    const m = trader();
    failsFk(() => insertOrder(db, { ...m, items: [{ productId: randomUUID(), cartons: 1, unitPrice: 100 }] }));
    insertOrder(db, { ...m, items: [{ productId: p, cartons: 1, unitPrice: 100 }] });
    failsFk(() => db.prepare('DELETE FROM products WHERE id = ?').run(p));
  });

  test('order snapshots stay fixed when product, merchant and settings change; snapshot columns are immutable', () => {
    const { userId, merchantId } = trader();
    const p = insertProduct(db, { price: 12550 });
    const o = insertOrder(db, { userId, merchantId, items: [{ productId: p, cartons: 3, unitPrice: 12550 }] });
    const before = { ...(db.prepare('SELECT * FROM orders WHERE id = ?').get(o) as object) };
    const itemsBefore = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o).map((r) => ({ ...r }));

    db.prepare("UPDATE products SET name = 'اسم جديد', price_cents = 99999, version = version + 1 WHERE id = ?").run(p);
    db.prepare("UPDATE merchants SET address = 'عنوان جديد تمامًا للمحل', version = version + 1 WHERE id = ?").run(merchantId);
    db.exec('UPDATE business_settings SET tax_bps = 1400, shipping_cents = 7500, shipping_taxable = 1, version = version + 1');

    assert.deepEqual({ ...(db.prepare('SELECT * FROM orders WHERE id = ?').get(o) as object) }, before);
    assert.deepEqual(db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o).map((r) => ({ ...r })), itemsBefore);

    for (const set of ['subtotal_cents = 1', "buyer_address = 'تغيير غير مسموح'", 'tax_bps = 1400', "note = 'x'", 'created_at = created_at + 1', `request_key = '${randomUUID()}'`]) {
      fails(() => db.prepare(`UPDATE orders SET ${set}, version = version + 1 WHERE id = ?`).run(o), SQLITE.CONSTRAINT_TRIGGER, /immutable/);
    }
    fails(() => db.prepare('UPDATE order_items SET cartons = 1 WHERE order_id = ?').run(o), SQLITE.CONSTRAINT_TRIGGER, /immutable/);
    fails(() => db.prepare('DELETE FROM order_items WHERE order_id = ?').run(o), SQLITE.CONSTRAINT_TRIGGER);
    fails(() => db.prepare('DELETE FROM orders WHERE id = ?').run(o), SQLITE.CONSTRAINT_TRIGGER);
  });

  test('only legal state transitions, each advancing the version', () => {
    const { userId, merchantId } = trader();
    const o = insertOrder(db, { userId, merchantId, items: [{ productId: insertProduct(db), cartons: 1, unitPrice: 100 }] });
    const to = (state: string) => db.prepare('UPDATE orders SET state = ?, version = version + 1, updated_at = ? WHERE id = ?').run(state, now(), o);
    fails(() => to('shipped'), SQLITE.CONSTRAINT_TRIGGER, /illegal order state transition/);
    fails(() => db.prepare("UPDATE orders SET state = 'confirmed' WHERE id = ?").run(o), SQLITE.CONSTRAINT_TRIGGER, /version/);
    to('confirmed');
    fails(() => to('pending'), SQLITE.CONSTRAINT_TRIGGER);
    to('preparing');
    to('shipped');
    fails(() => to('cancelled'), SQLITE.CONSTRAINT_TRIGGER);
    to('delivered');
    fails(() => to('shipped'), SQLITE.CONSTRAINT_TRIGGER);
    assert.equal(scalar('SELECT version FROM orders WHERE id = ?', o), 5);
  });

  test('order events: legal transitions only, append-only', () => {
    const { userId, merchantId } = trader();
    const o = insertOrder(db, { userId, merchantId, items: [{ productId: insertProduct(db), cartons: 1, unitPrice: 100 }] });
    const ev = (oldState: string | null, newState: string) =>
      db.prepare('INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, created_at) VALUES (?, ?, ?, ?, ?)').run(o, userId, oldState, newState, now());
    ev(null, 'pending');
    ev('pending', 'confirmed');
    fails(() => ev('pending', 'delivered'), SQLITE.CONSTRAINT_CHECK, /order_events_transition/);
    fails(() => ev('delivered', 'cancelled'), SQLITE.CONSTRAINT_CHECK);
    fails(() => db.prepare('UPDATE order_events SET note = ? WHERE order_id = ?').run('x', o), SQLITE.CONSTRAINT_TRIGGER, /append-only/);
    fails(() => db.prepare('DELETE FROM order_events WHERE order_id = ?').run(o), SQLITE.CONSTRAINT_TRIGGER);
  });
});

describe('inventory ledger and audit log', () => {
  const ledger = (o: Record<string, string | number | null>) =>
    db
      .prepare(
        `INSERT INTO inventory_ledger (product_id, actor_user_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason, order_id, operation_key, operation_digest, created_at)
         VALUES (:product_id, NULL, :kind, :on_hand_delta, :reserved_delta, :on_hand_after, :reserved_after, :reason, :order_id, :operation_key, :operation_digest, :created_at)`,
      )
      .run({ reason: null, order_id: null, operation_key: null, operation_digest: null, created_at: now(), ...o });

  test('movement rules per kind are enforced', () => {
    const p = insertProduct(db);
    ledger({ product_id: p, kind: 'receipt', on_hand_delta: 10, reserved_delta: 0, on_hand_after: 110, reserved_after: 0, reason: 'استلام شحنة' });
    fails(() => ledger({ product_id: p, kind: 'receipt', on_hand_delta: 10, reserved_delta: 0, on_hand_after: 110, reserved_after: 0 }), SQLITE.CONSTRAINT_CHECK, /inventory_ledger_manual_rules/);
    fails(() => ledger({ product_id: p, kind: 'receipt', on_hand_delta: -1, reserved_delta: 0, on_hand_after: 99, reserved_after: 0, reason: 'سبب' }), SQLITE.CONSTRAINT_CHECK);
    fails(() => ledger({ product_id: p, kind: 'reserve', on_hand_delta: 0, reserved_delta: 2, on_hand_after: 100, reserved_after: 2 }), SQLITE.CONSTRAINT_CHECK, /inventory_ledger_order_rules/);
    fails(() => ledger({ product_id: p, kind: 'correction', on_hand_delta: 0, reserved_delta: 0, on_hand_after: 100, reserved_after: 0, reason: 'لا شيء' }), SQLITE.CONSTRAINT_CHECK, /inventory_ledger_nonzero/);
    fails(() => ledger({ product_id: p, kind: 'correction', on_hand_delta: -5, reserved_delta: 0, on_hand_after: 5, reserved_after: 6, reason: 'تسوية' }), SQLITE.CONSTRAINT_CHECK, /inventory_ledger_balance_after/);
    fails(() => ledger({ product_id: p, kind: 'correction', on_hand_delta: 1.5, reserved_delta: 0, on_hand_after: 101, reserved_after: 0, reason: 'تسوية' }), SQLITE.CONSTRAINT_DATATYPE);
    fails(() => ledger({ product_id: p, kind: 'theft', on_hand_delta: -1, reserved_delta: 0, on_hand_after: 99, reserved_after: 0, reason: 'سبب' }), SQLITE.CONSTRAINT_CHECK);
  });

  test('ledger is append-only', () => {
    const p = insertProduct(db);
    ledger({ product_id: p, kind: 'opening', on_hand_delta: 100, reserved_delta: 0, on_hand_after: 100, reserved_after: 0, reason: 'رصيد افتتاحي' });
    fails(() => db.prepare('UPDATE inventory_ledger SET reason = ? WHERE product_id = ?').run('تعديل', p), SQLITE.CONSTRAINT_TRIGGER, /append-only/);
    fails(() => db.prepare('DELETE FROM inventory_ledger WHERE product_id = ?').run(p), SQLITE.CONSTRAINT_TRIGGER);
  });

  test('operation keys are unique per actor', () => {
    const p = insertProduct(db);
    const key = randomUUID();
    const digest = 'b'.repeat(64);
    ledger({ product_id: p, kind: 'receipt', on_hand_delta: 1, reserved_delta: 0, on_hand_after: 101, reserved_after: 0, reason: 'استلام', operation_key: key, operation_digest: digest });
    // actor NULL rows are not unique-constrained (NULLs are distinct); use a real actor:
    const admin = insertUser(db, { role: 'admin' });
    const withActor = () =>
      db
        .prepare(
          "INSERT INTO inventory_ledger (product_id, actor_user_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason, operation_key, operation_digest, created_at) VALUES (?, ?, 'receipt', 1, 0, 102, 0, 'استلام', ?, ?, ?)",
        )
        .run(p, admin, key, digest, now());
    withActor();
    fails(withActor, SQLITE.CONSTRAINT_UNIQUE);
    fails(() => ledger({ product_id: p, kind: 'receipt', on_hand_delta: 1, reserved_delta: 0, on_hand_after: 101, reserved_after: 0, reason: 'استلام', operation_key: randomUUID() }), SQLITE.CONSTRAINT_CHECK, /operation_pair/);
  });

  test('audit log: JSON-object metadata, append-only, deletable only after the retention period', () => {
    const audit = (createdAt: number, metadata: string | null) =>
      db.prepare("INSERT INTO audit_logs (actor_user_id, action, metadata, request_id, created_at) VALUES (NULL, 'auth.login_failed', ?, ?, ?)").run(metadata, randomUUID(), createdAt);
    fails(() => audit(now(), '[1,2]'), SQLITE.CONSTRAINT_CHECK, /audit_logs_metadata_json/);
    fails(() => audit(now(), 'not json'), SQLITE.CONSTRAINT_CHECK);
    const recent = Number(audit(now(), '{"reason":"bad_password"}').lastInsertRowid);
    fails(() => db.prepare('UPDATE audit_logs SET action = ? WHERE id = ?').run('auth.login', recent), SQLITE.CONSTRAINT_TRIGGER);
    fails(() => db.prepare('DELETE FROM audit_logs WHERE id = ?').run(recent), SQLITE.CONSTRAINT_TRIGGER, /retention/);
    const old = Number(audit(now() - 400 * 24 * 3600 * 1000, null).lastInsertRowid);
    db.prepare('DELETE FROM audit_logs WHERE id = ?').run(old);
    assert.equal(scalar('SELECT count(*) FROM audit_logs WHERE id = ?', old), 0);
  });
});
