import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import { CONSISTENCY_CHECK_CODES, orderConsistencyErrors, productConsistencyErrors, verifyConsistency } from '../../src/server/database/consistency.ts';
import { createTestDatabase, fixtureAdjustStock, fixtureTransition, insertMerchant, insertOrder, insertProduct, insertUser, now, type TestDatabase } from '../helpers/database.ts';

// Stage 16: read-only consistency verifier over the real schema and write sequence.

let t: TestDatabase;
let db: DatabaseSync;
beforeEach(() => {
  t = createTestDatabase();
  db = t.db;
});
afterEach(() => t.cleanup());

const codes = () => verifyConsistency(db).issues.map((i) => i.code).sort();

/** TEST-ONLY corruption: drop the guarding triggers of a table, run the statement, restore them unchanged. */
function bypass(table: string, sql: string, ...params: Array<string | number | null>) {
  const trigs = db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ?").all(table) as Array<{ name: string; sql: string }>;
  for (const tr of trigs) db.exec(`DROP TRIGGER "${tr.name}"`);
  try {
    db.prepare(sql).run(...params);
  } finally {
    for (const tr of trigs) db.exec(tr.sql);
  }
}

function world() {
  const userId = insertUser(db);
  const merchantId = insertMerchant(db, userId);
  const admin = insertUser(db, { role: 'admin' });
  const p = insertProduct(db, { onHand: 100 });
  const q = insertProduct(db, { onHand: 50 });
  const order = (cartons = 3, items = [p]) => insertOrder(db, { userId, merchantId, finalize: true, items: items.map((productId) => ({ productId, cartons, unitPrice: 1000 })) });
  return { userId, merchantId, admin, p, q, order };
}

describe('valid histories are accepted', () => {
  test('every lifecycle path, multi-line orders, manual adjustments, an unfinalized header (warning only)', () => {
    const w = world();
    const pending = w.order();
    const cancelledPending = w.order();
    fixtureTransition(db, cancelledPending, 'cancelled', { actorId: w.admin });
    const confirmed = w.order(2, [w.p, w.q]);
    fixtureTransition(db, confirmed, 'confirmed', { actorId: w.admin });
    const preparing = w.order();
    fixtureTransition(db, preparing, 'confirmed', { actorId: w.admin });
    fixtureTransition(db, preparing, 'preparing', { actorId: w.admin });
    const released = w.order(4, [w.p, w.q]);
    for (const s of ['confirmed', 'preparing', 'cancelled']) fixtureTransition(db, released, s, { actorId: w.admin });
    const delivered = w.order(5);
    for (const s of ['confirmed', 'preparing', 'shipped', 'delivered']) fixtureTransition(db, delivered, s, { actorId: w.admin });
    fixtureAdjustStock(db, w.p, 7);
    fixtureAdjustStock(db, w.q, -3);
    insertOrder(db, { userId: w.userId, merchantId: w.merchantId, items: [{ productId: w.p, cartons: 1, unitPrice: 1000 }] }); // unfinalized
    void pending;
    const r = verifyConsistency(db);
    assert.equal(r.ok, true, JSON.stringify(r.issues));
    assert.deepEqual(r.issues.map((i) => i.code), ['ORDER_UNFINALIZED']);
    assert.equal(r.warnings, 1);
    assert.equal(r.checks.length, CONSISTENCY_CHECK_CODES.length);
    for (const id of [pending, cancelledPending, confirmed, preparing, released, delivered]) assert.deepEqual(orderConsistencyErrors(db, id), [], id);
    assert.deepEqual(productConsistencyErrors(db, w.p), []);
  });
});

describe('documented gaps the schema cannot prevent are detected', () => {
  test('an event written without its state change (raw SQL, no trigger bypass needed) → ORDER_STATE_MISMATCH', () => {
    const w = world();
    const o = w.order();
    db.prepare("INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, note, order_version_after, created_at) VALUES (?, ?, 'pending', 'cancelled', 'إلغاء يدوي', 2, ?)").run(o, w.admin, now());
    assert.deepEqual(codes(), ['ORDER_STATE_MISMATCH']);
    assert.deepEqual(orderConsistencyErrors(db, o), ['ORDER_STATE_MISMATCH']);
    assert.deepEqual(orderConsistencyErrors(db, w.order()), [], 'other orders unaffected');
  });

  test('a reserve ledger row without its allocation/product link (raw SQL) → orphan detected; 0008 blocks further movement of that product', () => {
    const w = world();
    const o = w.order(3);
    const p = db.prepare('SELECT on_hand, reserved, version FROM products WHERE id = ?').get(w.p) as { on_hand: number; reserved: number; version: number };
    db.prepare(
      "INSERT INTO inventory_ledger (product_id, actor_user_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after, order_id, product_version_after, created_at) VALUES (?, ?, 'reserve', 0, 3, ?, ?, ?, ?, ?)",
    ).run(w.p, w.admin, p.on_hand, p.reserved + 3, o, p.version + 1, now());
    // Balances stay continuous (the row is consistent with itself), so the chain check passes; the row is
    // detected as unlinked, as an order movement without its allocation, and as a version not reached.
    assert.deepEqual(codes(), ['LEDGER_ORDER_MOVEMENT_ORPHAN', 'LEDGER_UNLINKED', 'LEDGER_VERSION_AHEAD']);
    assert.deepEqual(orderConsistencyErrors(db, o), ['LEDGER_ORDER_MOVEMENT_ORPHAN']);
    assert.deepEqual(productConsistencyErrors(db, w.p).sort(), ['LEDGER_UNLINKED', 'LEDGER_VERSION_AHEAD']);
    assert.throws(() => fixtureAdjustStock(db, w.p, 1), /not linked to the product/);
    assert.throws(() => fixtureTransition(db, o, 'confirmed', { actorId: w.admin }), /UNIQUE|not linked/);
    assert.deepEqual(productConsistencyErrors(db, w.q), []);
  });
});

describe('corruption that needs a trigger bypass is detected', () => {
  test('allocation quantity, allocation status, cross-order settlement', () => {
    const w = world();
    const a = w.order(3);
    fixtureTransition(db, a, 'confirmed', { actorId: w.admin });
    bypass('order_allocations', 'UPDATE order_allocations SET quantity = 2 WHERE order_id = ?', a);
    assert.ok(codes().includes('ALLOCATION_QUANTITY'));
    assert.ok(codes().includes('RESERVED_ALLOCATIONS'));
    assert.ok(codes().includes('ALLOCATION_LEDGER_PAIRING'));
  });

  test('allocation status not matching the order state', () => {
    const w = world();
    const a = w.order(3);
    fixtureTransition(db, a, 'confirmed', { actorId: w.admin });
    bypass('orders', "UPDATE orders SET state = 'preparing', version = 3 WHERE id = ?", a);
    bypass('order_events', "INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, order_version_after, created_at) VALUES (?, ?, 'confirmed', 'preparing', 3, 1)", a, w.admin);
    assert.deepEqual(codes(), [], 'consistent so far (same as a real prepare)');
    bypass('orders', "UPDATE orders SET state = 'shipped', version = 4 WHERE id = ?", a);
    bypass('order_events', "INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, order_version_after, created_at) VALUES (?, ?, 'preparing', 'shipped', 4, 1)", a, w.admin);
    assert.deepEqual(codes(), ['ALLOCATION_LIFECYCLE'], 'shipped without consuming its reservations');
  });

  test('broken event chain (skipped version), duplicate creation event', () => {
    const w = world();
    const a = w.order();
    bypass('order_events', "INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, order_version_after, created_at) VALUES (?, ?, 'pending', 'cancelled', 5, 1)", a, w.admin);
    bypass('orders', "UPDATE orders SET state = 'cancelled', version = 2 WHERE id = ?", a);
    assert.ok(codes().includes('ORDER_EVENT_CHAIN'));
    const b = w.order();
    bypass('order_events', "INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, created_at) VALUES (?, ?, NULL, 'pending', 1)", b, w.userId);
    assert.ok(codes().includes('ORDER_CREATION_EVENT_COUNT'));
  });

  test('product balance edited without ledger; ledger version ahead; finalized totals; admin without MFA; import record mismatch', () => {
    const w = world();
    bypass('products', 'UPDATE products SET on_hand = on_hand + 9 WHERE id = ?', w.p);
    assert.deepEqual(productConsistencyErrors(db, w.p), ['LEDGER_BALANCE_CHAIN']);
    bypass('products', 'UPDATE products SET version = 1 WHERE id = ?', w.q);
    assert.ok(productConsistencyErrors(db, w.q).includes('LEDGER_VERSION_AHEAD'));
    const o = w.order();
    bypass('orders', 'UPDATE orders SET subtotal_cents = subtotal_cents + 1, tax_base_cents = tax_base_cents + 1, total_cents = total_cents + 1 WHERE id = ?', o);
    assert.ok(orderConsistencyErrors(db, o).includes('ORDER_ITEMS_TOTALS'));
    // Already refused by the CHECK auth_users_admin_requires_totp; the verifier is defence in depth.
    assert.throws(() => db.prepare('UPDATE auth_users SET totp_ciphertext = NULL, credential_version = credential_version + 1 WHERE id = ?').run(w.admin), /admin_requires_totp/);
    db.exec('PRAGMA ignore_check_constraints = 1');
    db.prepare('UPDATE auth_users SET totp_ciphertext = NULL, credential_version = credential_version + 1 WHERE id = ?').run(w.admin);
    db.exec('PRAGMA ignore_check_constraints = 0');
    db.prepare("INSERT INTO import_operations (id, actor_user_id, operation_key, request_digest, mode, content_sha256, file_bytes, record_count, created_at) VALUES ('00000000-0000-4000-8000-000000000001', ?, '00000000-0000-4000-8000-000000000002', ?, 'create_products', ?, 10, 2, ?)").run(w.admin, 'a'.repeat(64), 'b'.repeat(64), now());
    const all = codes();
    for (const c of ['ADMIN_WITHOUT_MFA', 'IMPORT_ITEMS', 'LEDGER_BALANCE_CHAIN', 'LEDGER_VERSION_AHEAD', 'ORDER_ITEMS_TOTALS']) assert.ok(all.includes(c), c);
    const r = verifyConsistency(db, { maxSamples: 1 });
    assert.equal(r.ok, false);
    assert.ok(r.issues.every((i) => i.samples.length <= 1));
  });
});

describe('bounded operation', () => {
  test('2 000 finalized orders with full lifecycles verify in bounded time (recorded, not a capacity claim)', () => {
    const w = world();
    const big = insertProduct(db, { onHand: 1_000_000 });
    for (let i = 0; i < 2000; i++) {
      const o = insertOrder(db, { userId: w.userId, merchantId: w.merchantId, finalize: true, displayNumber: `AK-${String(i).padStart(6, '0')}-ABCDEF`, items: [{ productId: big, cartons: 1, unitPrice: 1000 }] });
      if (i % 2 === 0) for (const s of ['confirmed', 'preparing', 'shipped']) fixtureTransition(db, o, s, { actorId: w.admin });
    }
    const r = verifyConsistency(db);
    assert.equal(r.ok, true);
    console.log(`# consistency: 2 000 orders, ${r.checks.length} checks, ${r.durationMs} ms`);
    assert.ok(r.durationMs < 20_000);
  });
});
