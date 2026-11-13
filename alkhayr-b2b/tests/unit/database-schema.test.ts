import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { isForeignKeyError, SQLITE } from '../../src/server/database/errors.ts';
import { PRODUCT_CATEGORIES } from '../../src/shared/categories.ts';
import { BUSINESS_SETTING_DEFAULTS } from '../../src/shared/constants.ts';
import { createTestDatabase, fixtureAdjustStock, fixtureReserve, fixtureTransition, insertMerchant, insertOrder, insertProduct, insertUser, now, sqliteFailure, type TestDatabase } from '../helpers/database.ts';

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
    assert.equal(rows.length, 17); // 13 from 0001 + order_allocations (0005) + import_operations, import_operation_items (0006) + system_state (0008)
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

  test('on_hand >= reserved >= 0 is enforced (ledger balance CHECK first, products CHECK behind it)', () => {
    // Since 0003 every stock change needs a matching ledger row, and the ledger's own CHECK
    // (reserved_after <= on_hand_after, both >= 0) rejects an invalid balance before the product row is touched.
    fails(() => insertProduct(db, { onHand: 5, reserved: 6 }), SQLITE.CONSTRAINT_CHECK, /inventory_ledger_balance_after/);
    fails(() => insertProduct(db, { onHand: -1 }), SQLITE.CONSTRAINT_CHECK);
    fails(() => insertProduct(db, { reserved: -1 }), SQLITE.CONSTRAINT_CHECK, /inventory_ledger_(reserve|balance_after)/); // either ledger CHECK may report first
    const id = insertProduct(db, { onHand: 10, reserved: 4 });
    fails(() => fixtureAdjustStock(db, id, -7), SQLITE.CONSTRAINT_CHECK, /inventory_ledger_balance_after/);
    fails(() => fixtureReserve(db, id, 7), SQLITE.CONSTRAINT_CHECK, /inventory_ledger_balance_after/);
    // Raw updates without a ledger row are refused outright.
    fails(() => db.prepare('UPDATE products SET on_hand = 3, version = version + 1 WHERE id = ?').run(id), SQLITE.CONSTRAINT_TRIGGER, /inventory_ledger/);
    fixtureReserve(db, id, 6);
    assert.equal(scalar('SELECT on_hand - reserved FROM products WHERE id = ?', id), 0);
    // The products CHECKs remain in the schema as a further layer.
    const sql = String(scalar("SELECT sql FROM sqlite_schema WHERE name = 'products'"));
    assert.match(sql, /products_reserved_le_on_hand CHECK \(reserved <= on_hand\)/);
    assert.match(sql, /products_reserved_nonnegative CHECK \(reserved >= 0\)/);
  });

  test('migration 0003: products are inserted inactive with zero stock; every stock change needs a NEW matching ledger row', () => {
    const insert = (cols: string, vals: string) =>
      db.prepare(`INSERT INTO products (id, name, brand, category, price_cents, pack_size, created_at, updated_at${cols}) VALUES (?, 'منتج', 'ب', 'candy', 100, 1, 1, 1${vals})`).run(randomUUID());
    fails(() => insert('', ''), SQLITE.CONSTRAINT_TRIGGER, /inserted inactive/);
    fails(() => insert(', active, reserved', ', 0, 1'), SQLITE.CONSTRAINT_TRIGGER, /inserted inactive/);
    const id = insertProduct(db, { onHand: 0, active: false });
    const ledgerRow = (delta: number, after: number, versionAfter: number) =>
      Number(
        db
          .prepare("INSERT INTO inventory_ledger (product_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason, product_version_after, created_at) VALUES (?, 'receipt', ?, 0, ?, 0, 'استلام', ?, 1)")
          .run(id, delta, after, versionAfter).lastInsertRowid,
      );
    const link = (onHand: number, ledgerId: number) => db.prepare('UPDATE products SET on_hand = ?, version = version + 1, last_ledger_id = ? WHERE id = ?').run(onHand, ledgerId, id);
    const v = Number(scalar('SELECT version FROM products WHERE id = ?', id));
    const l1 = ledgerRow(5, 5, v + 1);
    fails(() => link(6, l1), SQLITE.CONSTRAINT_TRIGGER, /matching new inventory_ledger/); // balance mismatch
    link(5, l1);
    fails(() => link(10, l1), SQLITE.CONSTRAINT_TRIGGER, /matching new inventory_ledger/); // ledger row reused
    const l2 = ledgerRow(5, 10, v + 9);
    fails(() => link(10, l2), SQLITE.CONSTRAINT_TRIGGER, /matching new inventory_ledger/); // product_version_after mismatch
    fails(() => db.prepare('UPDATE products SET version = version + 1, last_ledger_id = ? WHERE id = ?').run(l2, id), SQLITE.CONSTRAINT_TRIGGER, /only together with a stock change/);
    db.prepare("UPDATE products SET name = 'اسم آخر', version = version + 1 WHERE id = ?").run(id); // metadata unaffected
    assert.deepEqual({ ...(db.prepare('SELECT on_hand, last_ledger_id FROM products WHERE id = ?').get(id) as object) }, { on_hand: 5, last_ledger_id: l1 });
  });

  test('available stock is not a stored column', () => {
    const cols = (db.prepare('PRAGMA table_info(products)').all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(!cols.some((c) => /avail/i.test(c)), cols.join(','));
  });

  test('every product update must advance version (stock changes included)', () => {
    const id = insertProduct(db);
    // A stock change with a matching ledger row but WITHOUT a version bump is refused by the version trigger.
    // (Separate product: the refused update leaves its ledger row unlinked, which blocks that product — 0008.)
    const other = insertProduct(db);
    const v = Number(scalar('SELECT version FROM products WHERE id = ?', id));
    const ov = Number(scalar('SELECT version FROM products WHERE id = ?', other));
    const onHand = Number(scalar('SELECT on_hand FROM products WHERE id = ?', other));
    const ledger = db
      .prepare("INSERT INTO inventory_ledger (product_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason, product_version_after, created_at) VALUES (?, 'correction', 5, 0, ?, 0, 'سبب', ?, 1)")
      .run(other, onHand + 5, ov);
    fails(() => db.prepare('UPDATE products SET on_hand = on_hand + 5, last_ledger_id = ? WHERE id = ?').run(ledger.lastInsertRowid, other), SQLITE.CONSTRAINT_TRIGGER, /version/);
    fails(() => db.prepare('UPDATE products SET price_cents = 999, version = version + 2 WHERE id = ?').run(id), SQLITE.CONSTRAINT_TRIGGER);
    fixtureAdjustStock(db, id, 5);
    assert.equal(Number(scalar('SELECT version FROM products WHERE id = ?', id)), v + 1);
  });

  test('image URLs must be https', () => {
    const insertWithImage = (url: string) =>
      db.prepare("INSERT INTO products (id, name, brand, category, image_url, price_cents, pack_size, active, created_at, updated_at) VALUES (?, 'منتج', 'ب', 'candy', ?, 100, 1, 0, 1, 1)").run(randomUUID(), url);
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
    const o = insertOrder(db, { userId, merchantId, finalize: true, items: [{ productId: insertProduct(db), cartons: 1, unitPrice: 100 }] });
    const to = (state: string) => db.prepare('UPDATE orders SET state = ?, version = version + 1, updated_at = ? WHERE id = ?').run(state, now(), o);
    fails(() => to('shipped'), SQLITE.CONSTRAINT_TRIGGER, /illegal order state transition/);
    fails(() => db.prepare("UPDATE orders SET state = 'confirmed' WHERE id = ?").run(o), SQLITE.CONSTRAINT_TRIGGER, /version/);
    // Legal transitions go through the full write sequence (ledger, allocations, event: migration 0005).
    fixtureTransition(db, o, 'confirmed');
    fails(() => to('pending'), SQLITE.CONSTRAINT_TRIGGER);
    fixtureTransition(db, o, 'preparing');
    fixtureTransition(db, o, 'shipped');
    fails(() => to('cancelled'), SQLITE.CONSTRAINT_TRIGGER);
    fixtureTransition(db, o, 'delivered');
    fails(() => to('shipped'), SQLITE.CONSTRAINT_TRIGGER);
    assert.equal(scalar('SELECT version FROM orders WHERE id = ?', o), 5);
  });

  test('order events: legal transitions only, append-only', () => {
    const { userId, merchantId } = trader();
    const admin = insertUser(db, { role: 'admin' });
    const o = insertOrder(db, { userId, merchantId, items: [{ productId: insertProduct(db), cartons: 1, unitPrice: 100 }] });
    const ev = (oldState: string | null, newState: string, actor = userId) =>
      db.prepare('INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, note, order_version_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(o, actor, oldState, newState, 'سبب الاختبار', 2, now());
    ev(null, 'pending');
    ev('pending', 'cancelled', admin); // legal; written before the state update (migration 0005 sequence)
    fails(() => ev('pending', 'delivered'), SQLITE.CONSTRAINT_CHECK, /order_events_transition/);
    fails(() => ev('delivered', 'cancelled'), SQLITE.CONSTRAINT_CHECK);
    fails(() => db.prepare('UPDATE order_events SET note = ? WHERE order_id = ?').run('x', o), SQLITE.CONSTRAINT_TRIGGER, /append-only/);
    fails(() => db.prepare('DELETE FROM order_events WHERE order_id = ?').run(o), SQLITE.CONSTRAINT_TRIGGER);
  });
});

describe('order finalization (migration 0004)', () => {
  const create = (o: string, actor: string) =>
    db.prepare("INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, created_at) VALUES (?, ?, NULL, 'pending', ?)").run(o, actor, now());
  const item = (o: string, productId: string, lineNo: number, price = 100, cartons = 1) =>
    db
      .prepare(
        `INSERT INTO order_items (order_id, product_id, line_no, product_name, product_brand, product_barcode, pack_size, unit_price_cents, cartons, line_total_cents)
         VALUES (?, ?, ?, 'منتج', 'براند', NULL, 24, ?, ?, ?)`,
      )
      .run(o, productId, lineNo, price, cartons, price * cartons);

  test('a consistent order is finalized once, only by its creator', () => {
    const { userId, merchantId } = trader();
    const other = trader();
    const o = insertOrder(db, { userId, merchantId, items: [{ productId: insertProduct(db), cartons: 2, unitPrice: 100 }, { productId: insertProduct(db), cartons: 1, unitPrice: 300 }] });
    fails(() => create(o, other.userId), SQLITE.CONSTRAINT_TRIGGER, /created by the event actor/);
    create(o, userId);
    fails(() => create(o, userId), SQLITE.CONSTRAINT_TRIGGER, /already exists/);
    assert.equal(scalar('SELECT count(*) FROM order_events WHERE order_id = ?', o), 1);
  });

  test('header and items must agree: subtotal = sum of line totals', () => {
    const { userId, merchantId } = trader();
    const o = insertOrder(db, { userId, merchantId, items: [{ productId: insertProduct(db), cartons: 2, unitPrice: 100 }] });
    item(o, insertProduct(db), 2); // an extra line not reflected in the header subtotal
    fails(() => create(o, userId), SQLITE.CONSTRAINT_TRIGGER, /subtotal does not match/);
    assert.equal(scalar('SELECT count(*) FROM order_events WHERE order_id = ?', o), 0);
  });

  test('every item must have the order demo classification', () => {
    const { userId, merchantId } = trader();
    const demo = randomUUID();
    db.prepare(
      `INSERT INTO products (id, name, brand, category, price_cents, on_hand, reserved, pack_size, minimum_cartons, active, is_demo, version, created_at, updated_at)
       VALUES (?, 'منتج عرض', 'براند', 'candy', 100, 0, 0, 24, 1, 0, 1, 1, ?, ?)`,
    ).run(demo, now(), now());
    const o = insertOrder(db, { userId, merchantId, items: [{ productId: insertProduct(db), cartons: 1, unitPrice: 100 }, { productId: demo, cartons: 1, unitPrice: 100 }] });
    fails(() => create(o, userId), SQLITE.CONSTRAINT_TRIGGER, /demo classification/);
  });

  test('no items after finalization; no transition or state change before it', () => {
    const { userId, merchantId } = trader();
    const o = insertOrder(db, { userId, merchantId, items: [{ productId: insertProduct(db), cartons: 1, unitPrice: 100 }] });
    const transition = () => db.prepare("INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, created_at) VALUES (?, ?, 'pending', 'confirmed', ?)").run(o, userId, now());
    const confirm = () => db.prepare("UPDATE orders SET state = 'confirmed', version = version + 1, updated_at = ? WHERE id = ?").run(now(), o);
    // Refused by the 0004 guard; since 0005 the transition guards also refuse it (SQLite does not
    // specify which trigger reports first, so either message is accepted).
    const unfinished = /no creation event|current state and latest event|requires its transition event/;
    fails(transition, SQLITE.CONSTRAINT_TRIGGER, unfinished);
    fails(confirm, SQLITE.CONSTRAINT_TRIGGER, unfinished);
    create(o, userId);
    fails(() => item(o, insertProduct(db), 2), SQLITE.CONSTRAINT_TRIGGER, /after the order was created/);
    fixtureTransition(db, o, 'confirmed'); // legal once finalized (full 0005 sequence)
    // The creation event cannot be written for an order that already left pending/version 1.
    const late = insertOrder(db, { userId, merchantId, items: [{ productId: insertProduct(db), cartons: 1, unitPrice: 100 }] });
    fails(() => db.prepare("UPDATE orders SET state = 'confirmed', version = version + 1 WHERE id = ?").run(late), SQLITE.CONSTRAINT_TRIGGER, unfinished);
    db.prepare('UPDATE orders SET version = version + 1 WHERE id = ?').run(late);
    fails(() => create(late, userId), SQLITE.CONSTRAINT_TRIGGER, /pending order at version 1/);
  });
});

describe('order fulfillment and allocations (migration 0005)', () => {
  const ledgerRow = (o: { product: string; order: string; kind: string; dOn: number; dRes: number; actor?: string | null }) => {
    const p = db.prepare('SELECT on_hand, reserved, version FROM products WHERE id = ?').get(o.product) as { on_hand: number; reserved: number; version: number };
    return Number(
      db
        .prepare(
          `INSERT INTO inventory_ledger (product_id, actor_user_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after, order_id, product_version_after, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(o.product, o.actor ?? null, o.kind, o.dOn, o.dRes, p.on_hand + o.dOn, p.reserved + o.dRes, o.order, p.version + 1, now()).lastInsertRowid,
    );
  };
  const pendingOrder = (cartons = 3, pack?: number) => {
    const { userId, merchantId } = trader();
    const product = insertProduct(db, { onHand: 50, ...(pack ? { pack } : {}) });
    const order = insertOrder(db, { userId, merchantId, finalize: true, items: [{ productId: product, cartons, unitPrice: 100, packSize: 24 }] });
    return { userId, merchantId, product, order };
  };

  test('reserve movements need a finalized pending order line of the same quantity and packaging, once', () => {
    const a = pendingOrder(3);
    fails(() => ledgerRow({ product: a.product, order: a.order, kind: 'reserve', dOn: 0, dRes: 4 }), SQLITE.CONSTRAINT_TRIGGER, /reserve movement requires/);
    const repacked = pendingOrder(3, 12);
    fails(() => ledgerRow({ product: repacked.product, order: repacked.order, kind: 'reserve', dOn: 0, dRes: 3 }), SQLITE.CONSTRAINT_TRIGGER, /reserve movement requires/);
    const { userId, merchantId } = trader();
    const unfinished = insertOrder(db, { userId, merchantId, items: [{ productId: a.product, cartons: 3, unitPrice: 100 }] });
    fails(() => ledgerRow({ product: a.product, order: unfinished, kind: 'reserve', dOn: 0, dRes: 3 }), SQLITE.CONSTRAINT_TRIGGER, /reserve movement requires/);
    fixtureTransition(db, a.order, 'confirmed');
    fails(() => ledgerRow({ product: a.product, order: a.order, kind: 'reserve', dOn: 0, dRes: 3 }), SQLITE.CONSTRAINT_TRIGGER, /reserve movement requires/);
  });

  test('a stock change from an order movement needs the allocation that references it', () => {
    const a = pendingOrder(3);
    const id = ledgerRow({ product: a.product, order: a.order, kind: 'reserve', dOn: 0, dRes: 3 });
    fails(() => db.prepare('UPDATE products SET reserved = reserved + 3, version = version + 1, last_ledger_id = ? WHERE id = ?').run(id, a.product), SQLITE.CONSTRAINT_TRIGGER, /not backed by an order allocation/);
    fails(
      () => db.prepare("INSERT INTO order_allocations (order_id, product_id, quantity, status, reserve_ledger_id, created_at) VALUES (?, ?, 2, 'reserved', ?, 1)").run(a.order, a.product, id),
      SQLITE.CONSTRAINT_TRIGGER,
      /full line quantity/,
    );
    fails(
      () => db.prepare("INSERT INTO order_allocations (order_id, product_id, quantity, status, reserve_ledger_id, created_at) VALUES (?, ?, 3, 'released', ?, 1)").run(a.order, a.product, id),
      SQLITE.CONSTRAINT_TRIGGER,
    );
    db.prepare("INSERT INTO order_allocations (order_id, product_id, quantity, status, reserve_ledger_id, created_at) VALUES (?, ?, 3, 'reserved', ?, 1)").run(a.order, a.product, id);
    db.prepare('UPDATE products SET reserved = reserved + 3, version = version + 1, last_ledger_id = ? WHERE id = ?').run(id, a.product);
    fails(() => db.prepare('DELETE FROM order_allocations WHERE order_id = ?').run(a.order), SQLITE.CONSTRAINT_TRIGGER, /cannot be deleted/);
    fails(() => db.prepare('UPDATE order_allocations SET quantity = 2 WHERE order_id = ?').run(a.order), SQLITE.CONSTRAINT_TRIGGER, /settled once/);
  });

  test('order state changes require the transition event, matching allocations and an approved buyer for forward steps', () => {
    const a = pendingOrder(2);
    const admin = insertUser(db, { role: 'admin' });
    const confirm = () => db.prepare("UPDATE orders SET state = 'confirmed', version = version + 1, updated_at = ? WHERE id = ?").run(now(), a.order);
    fails(confirm, SQLITE.CONSTRAINT_TRIGGER, /requires its transition event/);
    const event = (from: string, to: string, actor: string, note: string | null = null, versionAfter = 2) =>
      db.prepare('INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, note, order_version_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(a.order, actor, from, to, note, versionAfter, now());
    fails(() => event('pending', 'confirmed', a.userId), SQLITE.CONSTRAINT_TRIGGER, /administrator actor/);
    fails(() => event('pending', 'cancelled', admin), SQLITE.CONSTRAINT_TRIGGER, /requires a reason/);
    fails(() => event('pending', 'confirmed', admin, null, 5), SQLITE.CONSTRAINT_TRIGGER, /recorded together/);
    fails(() => event('confirmed', 'preparing', admin), SQLITE.CONSTRAINT_TRIGGER, /current state/);
    event('pending', 'confirmed', admin);
    fails(confirm, SQLITE.CONSTRAINT_TRIGGER, /allocations do not match/); // no reservation was made
    // A buyer that is no longer approved blocks forward steps at the database level.
    const b = pendingOrder(2);
    db.prepare("UPDATE merchants SET status = 'suspended', access_version = access_version + 1, version = version + 1 WHERE id = ?").run(b.merchantId);
    db.exec('BEGIN'); // the service runs the whole sequence in one transaction; mirror that here
    try {
      fails(() => fixtureTransition(db, b.order, 'confirmed'), SQLITE.CONSTRAINT_TRIGGER, /buyer must be approved/);
    } finally {
      db.exec('ROLLBACK');
    }
    fixtureTransition(db, b.order, 'cancelled'); // cancellation stays possible
  });

  test('settle movements use only this order’s outstanding allocation; packaging is locked while stocked', () => {
    const a = pendingOrder(4);
    fixtureTransition(db, a.order, 'confirmed');
    const b = pendingOrder(4);
    // Order b shares nothing with a's product; try to release a's product under b.
    fails(() => ledgerRow({ product: a.product, order: b.order, kind: 'release', dOn: 0, dRes: -4 }), SQLITE.CONSTRAINT_TRIGGER, /own outstanding allocation/);
    fails(() => ledgerRow({ product: a.product, order: a.order, kind: 'ship', dOn: -4, dRes: -4 }), SQLITE.CONSTRAINT_TRIGGER, /own outstanding allocation/); // not preparing yet
    fixtureTransition(db, a.order, 'preparing');
    fixtureTransition(db, a.order, 'shipped');
    fails(() => ledgerRow({ product: a.product, order: a.order, kind: 'release', dOn: 0, dRes: -4 }), SQLITE.CONSTRAINT_TRIGGER, /own outstanding allocation|UNIQUE/);
    assert.equal(scalar("SELECT status FROM order_allocations WHERE order_id = ?", a.order), 'consumed');
    fails(() => db.prepare('UPDATE products SET pack_size = 12, version = version + 1 WHERE id = ?').run(a.product), SQLITE.CONSTRAINT_TRIGGER, /pack_size cannot change/);
    const empty = insertProduct(db, { onHand: 0 });
    db.prepare('UPDATE products SET pack_size = 12, version = version + 1 WHERE id = ?').run(empty);
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
    // Each probe uses a fresh product (on_hand 100) and balances that continue from it, so the CHECK
    // constraint under test is what refuses the row (the 0008 continuity trigger runs first).
    const fresh = () => insertProduct(db);
    ledger({ product_id: fresh(), kind: 'receipt', on_hand_delta: 10, reserved_delta: 0, on_hand_after: 110, reserved_after: 0, reason: 'استلام شحنة' });
    fails(() => ledger({ product_id: fresh(), kind: 'receipt', on_hand_delta: 10, reserved_delta: 0, on_hand_after: 110, reserved_after: 0 }), SQLITE.CONSTRAINT_CHECK, /inventory_ledger_manual_rules/);
    fails(() => ledger({ product_id: fresh(), kind: 'receipt', on_hand_delta: -1, reserved_delta: 0, on_hand_after: 99, reserved_after: 0, reason: 'سبب' }), SQLITE.CONSTRAINT_CHECK);
    fails(() => ledger({ product_id: fresh(), kind: 'reserve', on_hand_delta: 0, reserved_delta: 2, on_hand_after: 100, reserved_after: 2 }), SQLITE.CONSTRAINT_CHECK, /inventory_ledger_order_rules/);
    fails(() => ledger({ product_id: fresh(), kind: 'correction', on_hand_delta: 0, reserved_delta: 0, on_hand_after: 100, reserved_after: 0, reason: 'لا شيء' }), SQLITE.CONSTRAINT_CHECK, /inventory_ledger_nonzero/);
    const reservedProduct = insertProduct(db, { onHand: 10, reserved: 5 });
    fails(() => ledger({ product_id: reservedProduct, kind: 'correction', on_hand_delta: -6, reserved_delta: 0, on_hand_after: 4, reserved_after: 5, reason: 'تسوية' }), SQLITE.CONSTRAINT_CHECK, /inventory_ledger_balance_after/);
    fails(() => ledger({ product_id: fresh(), kind: 'correction', on_hand_delta: 1.5, reserved_delta: 0, on_hand_after: 101.5, reserved_after: 0, reason: 'تسوية' }), SQLITE.CONSTRAINT_DATATYPE);
    fails(() => ledger({ product_id: fresh(), kind: 'theft', on_hand_delta: -1, reserved_delta: 0, on_hand_after: 99, reserved_after: 0, reason: 'سبب' }), SQLITE.CONSTRAINT_CHECK);
  });

  test('0008: ledger rows must continue the product balance; an unlinked row blocks further movements of that product', () => {
    const p = insertProduct(db); // on_hand 100, linked
    fails(() => ledger({ product_id: p, kind: 'receipt', on_hand_delta: 10, reserved_delta: 0, on_hand_after: 999, reserved_after: 0, reason: 'استلام' }), SQLITE.CONSTRAINT_TRIGGER, /continue from the product/);
    // An orphan row (raw SQL, never linked by a product update) blocks the product's next movement...
    ledger({ product_id: p, kind: 'receipt', on_hand_delta: 10, reserved_delta: 0, on_hand_after: 110, reserved_after: 0, reason: 'استلام' });
    fails(() => fixtureAdjustStock(db, p, 1), SQLITE.CONSTRAINT_TRIGGER, /not linked to the product/);
    // ...but not other products.
    const q = insertProduct(db);
    fixtureAdjustStock(db, q, 1);
  });

  test('ledger is append-only', () => {
    const p = insertProduct(db, { onHand: 0 });
    ledger({ product_id: p, kind: 'opening', on_hand_delta: 100, reserved_delta: 0, on_hand_after: 100, reserved_after: 0, reason: 'رصيد افتتاحي' });
    fails(() => db.prepare('UPDATE inventory_ledger SET reason = ? WHERE product_id = ?').run('تعديل', p), SQLITE.CONSTRAINT_TRIGGER, /append-only/);
    fails(() => db.prepare('DELETE FROM inventory_ledger WHERE product_id = ?').run(p), SQLITE.CONSTRAINT_TRIGGER);
  });

  test('operation keys are unique per actor', () => {
    const key = randomUUID();
    const digest = 'b'.repeat(64);
    ledger({ product_id: insertProduct(db), kind: 'receipt', on_hand_delta: 1, reserved_delta: 0, on_hand_after: 101, reserved_after: 0, reason: 'استلام', operation_key: key, operation_digest: digest });
    // actor NULL rows are not unique-constrained (NULLs are distinct); use a real actor:
    const admin = insertUser(db, { role: 'admin' });
    const withActor = () =>
      db
        .prepare(
          "INSERT INTO inventory_ledger (product_id, actor_user_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason, operation_key, operation_digest, created_at) VALUES (?, ?, 'receipt', 1, 0, 101, 0, 'استلام', ?, ?, ?)",
        )
        .run(insertProduct(db), admin, key, digest, now());
    withActor();
    fails(withActor, SQLITE.CONSTRAINT_UNIQUE);
    fails(() => ledger({ product_id: insertProduct(db), kind: 'receipt', on_hand_delta: 1, reserved_delta: 0, on_hand_after: 101, reserved_after: 0, reason: 'استلام', operation_key: randomUUID() }), SQLITE.CONSTRAINT_CHECK, /operation_pair/);
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

describe('committed import records (migration 0006)', () => {
  function op(mode: string, actor: string) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO import_operations (id, actor_user_id, operation_key, request_digest, mode, content_sha256, file_bytes, record_count, created_at) VALUES (?, ?, ?, ?, ?, ?, 10, 1, ?)",
    ).run(id, actor, randomUUID(), 'a'.repeat(64), mode, 'b'.repeat(64), now());
    return id;
  }
  function receipt(productId: string, actor: string | null) {
    const p = db.prepare('SELECT on_hand, reserved, version FROM products WHERE id = ?').get(productId) as { on_hand: number; reserved: number; version: number };
    const l = db
      .prepare(
        "INSERT INTO inventory_ledger (product_id, actor_user_id, kind, adjustment_type, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason, product_version_after, created_at) VALUES (?, ?, 'receipt', 'receipt', 5, 0, ?, ?, 'استلام', ?, ?)",
      )
      .run(productId, actor, p.on_hand + 5, p.reserved, p.version + 1, now());
    db.prepare('UPDATE products SET on_hand = on_hand + 5, version = version + 1, last_ledger_id = ? WHERE id = ?').run(l.lastInsertRowid, productId);
    return { ledgerId: Number(l.lastInsertRowid), version: p.version + 1 };
  }
  const item = (importId: string, productId: string, ledgerId: number | null, version: number, recordNo = 1) =>
    db.prepare('INSERT INTO import_operation_items (import_id, record_no, line_no, product_id, ledger_id, product_version_after) VALUES (?, ?, 2, ?, ?, ?)').run(importId, recordNo, productId, ledgerId, version);

  test('one batch per (administrator, operation key); records are append-only', () => {
    const admin = insertUser(db, { role: 'admin' });
    const key = randomUUID();
    const ins = () =>
      db.prepare("INSERT INTO import_operations (id, actor_user_id, operation_key, request_digest, mode, content_sha256, file_bytes, record_count, created_at) VALUES (?, ?, ?, ?, 'create_products', ?, 1, 1, ?)").run(randomUUID(), admin, key, 'c'.repeat(64), 'd'.repeat(64), now());
    ins();
    assert.equal(sqliteFailure(ins).errcode, SQLITE.CONSTRAINT_UNIQUE);
    const id = op('create_products', admin);
    assert.match(sqliteFailure(() => db.prepare('UPDATE import_operations SET record_count = 2 WHERE id = ?').run(id)).message, /append-only/);
    assert.match(sqliteFailure(() => db.prepare('DELETE FROM import_operations WHERE id = ?').run(id)).message, /append-only/);
    const bad = { mode: 'create_products', file_bytes: 1, record_count: 1 };
    for (const [col, value] of [['mode', 'upsert'], ['file_bytes', 1048577], ['file_bytes', 0], ['record_count', 1001], ['record_count', 0]] as const) {
      const v = { ...bad, [col]: value };
      const f = sqliteFailure(() =>
        db
          .prepare('INSERT INTO import_operations (id, actor_user_id, operation_key, request_digest, mode, content_sha256, file_bytes, record_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(randomUUID(), admin, randomUUID(), 'a'.repeat(64), v.mode, 'b'.repeat(64), v.file_bytes, v.record_count, now()),
      );
      assert.equal(f.errcode, SQLITE.CONSTRAINT_CHECK, `${col}=${value}`);
    }
  });

  test('items must match their mode and their own ledger row (product, actor, adjustment type, version)', () => {
    const admin = insertUser(db, { role: 'admin' });
    const otherAdmin = insertUser(db, { role: 'admin' });
    const product = insertProduct(db, { onHand: 0, active: false });
    const create = op('create_products', admin);
    item(create, product, null, 1);
    assert.match(sqliteFailure(() => db.prepare('UPDATE import_operation_items SET line_no = 3 WHERE import_id = ?').run(create)).message, /append-only/);
    const stock = op('receive_stock', admin);
    assert.match(sqliteFailure(() => item(stock, product, null, 2)).message, /must match/, 'stock item without ledger row');
    const foreign = receipt(product, otherAdmin);
    assert.match(sqliteFailure(() => item(stock, product, foreign.ledgerId, foreign.version)).message, /must match/, 'ledger row of another administrator');
    const mine = receipt(product, admin);
    assert.match(sqliteFailure(() => item(stock, product, mine.ledgerId, mine.version + 1)).message, /must match/, 'wrong version');
    const setTotal = op('set_stock_total', admin);
    assert.match(sqliteFailure(() => item(setTotal, product, mine.ledgerId, mine.version)).message, /must match/, 'receipt row under set_stock_total');
    item(stock, product, mine.ledgerId, mine.version);
    assert.match(sqliteFailure(() => item(create, product, mine.ledgerId, mine.version, 2)).message, /must match/, 'product modes link no ledger row');
  });
});
