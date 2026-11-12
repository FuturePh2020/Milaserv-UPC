import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/database/connection.ts';
import { applyMigrations, loadMigrations } from '../../src/server/database/migrations.ts';
import { projectRoot } from './server.ts';

/**
 * Disposable test databases and TEST-ONLY fixtures. Fixtures write rows with
 * bound parameters straight into tables to exercise constraints; they are not
 * the business services (those arrive in later stages) and never ship.
 */

export const MIGRATIONS_DIR = path.join(projectRoot, 'migrations');
/** Number of migrations shipped with the code (tests must not hardcode it). */
export const LATEST_VERSION = loadMigrations(MIGRATIONS_DIR).length;
/** Filename for a test-only migration `offset` versions after the latest shipped one. */
export function nextMigrationFile(suffix: string, offset = 1): string {
  return `${String(LATEST_VERSION + offset).padStart(4, '0')}_${suffix}.sql`;
}

export interface TestDatabase {
  db: DatabaseSync;
  dir: string;
  file: string;
  cleanup(): void;
}

export function tempDir(prefix = 'alkhayr-db-'): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function createTestDatabase(options: { migrate?: boolean; migrationsDir?: string } = {}): TestDatabase {
  const dir = tempDir();
  const file = path.join(dir, 'data', 'alkhayr.db');
  const db = openDatabase(file, { mustExist: false });
  if (options.migrate !== false) applyMigrations(db, loadMigrations(options.migrationsDir ?? MIGRATIONS_DIR));
  return {
    db,
    dir,
    file,
    cleanup() {
      if (db.isOpen) db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const now = () => Date.now();
const hex64 = () => randomBytes(32).toString('hex');

export function insertUser(db: DatabaseSync, o: { id?: string; username?: string; role?: string; totp?: string | null } = {}): string {
  const id = o.id ?? randomUUID();
  const role = o.role ?? 'trader';
  const t = now();
  db.prepare(
    `INSERT INTO auth_users (id, username, password_hash, password_changed_at, role, totp_ciphertext, last_otp_step, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(id, o.username ?? `user_${id.slice(0, 8)}`, 'scrypt$test$not-a-real-hash-xxxxxxxx', t, role, o.totp === undefined ? (role === 'admin' ? 'v1.test-ciphertext-xxxxxxxx' : null) : o.totp, t, t);
  return id;
}

export function insertMerchant(db: DatabaseSync, userId: string, o: { id?: string; status?: string; address?: string } = {}): string {
  const id = o.id ?? randomUUID();
  const t = now();
  db.prepare(
    `INSERT INTO merchants (id, user_id, business_name, contact_name, email, phone, governorate, address, status, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, userId, 'محل الاختبار', 'أحمد علي', '01012345678', 'القاهرة', o.address ?? '١٢ شارع التجربة، مدينة نصر', o.status ?? 'approved', t, t);
  return id;
}

export interface ProductInput {
  id?: string;
  name?: string;
  barcode?: string | null;
  category?: string;
  price?: unknown;
  onHand?: unknown;
  reserved?: unknown;
  pack?: unknown;
  min?: unknown;
  active?: boolean;
}

/**
 * TEST-ONLY product fixture following the valid lifecycle enforced since
 * migration 0003: insert inactive with zero stock, then (optionally) a
 * ledger-linked stock movement, reservation and activation.
 */
export function insertProduct(db: DatabaseSync, o: ProductInput = {}): string {
  const id = o.id ?? randomUUID();
  const t = now();
  db.prepare(
    `INSERT INTO products (id, name, brand, category, barcode, image_url, price_cents, on_hand, reserved, pack_size, minimum_cartons, active, is_demo, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 0, ?, ?, 0, 0, 1, ?, ?)`,
  ).run(
    id,
    o.name ?? 'شيكولاتة بالبندق',
    'براند',
    o.category ?? 'chocolate',
    o.barcode === undefined ? null : o.barcode,
    (o.price ?? 12550) as number,
    (o.pack ?? 24) as number,
    (o.min ?? 1) as number,
    t,
    t,
  );
  const onHand = o.onHand ?? 100;
  if (onHand !== 0) fixtureAdjustStock(db, id, onHand);
  const reserved = o.reserved ?? 0;
  if (reserved !== 0) fixtureReserve(db, id, reserved);
  if (o.active !== false) db.prepare('UPDATE products SET active = 1, version = version + 1 WHERE id = ?').run(id);
  return id;
}

/**
 * TEST-ONLY: ledger-linked change of on_hand by `delta` (kind correction).
 * Mirrors what the inventory service does; never used by production code.
 */
export function fixtureAdjustStock(db: DatabaseSync, productId: string, delta: unknown): void {
  const p = db.prepare('SELECT on_hand, reserved, version FROM products WHERE id = ?').get(productId) as { on_hand: number; reserved: number; version: number };
  const ledger = db
    .prepare(
      `INSERT INTO inventory_ledger (product_id, actor_user_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason, product_version_after, created_at)
       VALUES (?, NULL, 'correction', ?, 0, ?, ?, 'TEST-ONLY fixture', ?, ?)`,
    )
    .run(productId, delta as number, p.on_hand + (delta as number), p.reserved, p.version + 1, now());
  db.prepare('UPDATE products SET on_hand = ?, version = version + 1, last_ledger_id = ? WHERE id = ?').run(p.on_hand + (delta as number), ledger.lastInsertRowid, productId);
}

/**
 * TEST-ONLY: reservation of `quantity` cartons through a real, valid order confirmation
 * (migration 0005): a finalized fixture order with one line of that quantity is confirmed by a
 * fixture administrator (reserve ledger row -> allocation -> linked product update -> event ->
 * state). A quantity that is not a positive integer is written as a raw reserve ledger row so the
 * ledger CHECKs can be exercised. Returns the order id.
 */
export function fixtureReserve(db: DatabaseSync, productId: string, quantity: unknown): string {
  const userId = insertUser(db);
  const merchantId = insertMerchant(db, userId);
  const valid = Number.isInteger(quantity) && (quantity as number) > 0 && (quantity as number) <= 100_000;
  const pack = (db.prepare('SELECT pack_size FROM products WHERE id = ?').get(productId) as { pack_size: number }).pack_size;
  const orderId = insertOrder(db, { userId, merchantId, finalize: true, items: [{ productId, cartons: valid ? (quantity as number) : 1, unitPrice: 100, packSize: pack }] });
  if (valid) {
    fixtureTransition(db, orderId, 'confirmed');
    return orderId;
  }
  const p = db.prepare('SELECT on_hand, reserved, version FROM products WHERE id = ?').get(productId) as { on_hand: number; reserved: number; version: number };
  db.prepare(
    `INSERT INTO inventory_ledger (product_id, actor_user_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason, order_id, product_version_after, created_at)
     VALUES (?, NULL, 'reserve', 0, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(productId, quantity as number, p.on_hand, p.reserved + (quantity as number), orderId, p.version + 1, now());
  throw new Error('fixtureReserve: the invalid reserve row was unexpectedly accepted');
}

/**
 * TEST-ONLY: one legal order transition through the same database write sequence as the
 * fulfillment service (per line: ledger row -> allocation -> linked product update; then the
 * event and the state/version update). Never used by production code.
 */
export function fixtureTransition(db: DatabaseSync, orderId: string, to: string, o: { actorId?: string; note?: string } = {}): void {
  const order = db.prepare('SELECT state, version FROM orders WHERE id = ?').get(orderId) as { state: string; version: number };
  const actor = o.actorId ?? insertUser(db, { role: 'admin' });
  const t = now();
  const kind = order.state === 'pending' && to === 'confirmed' ? 'reserve' : to === 'cancelled' && order.state !== 'pending' ? 'release' : to === 'shipped' ? 'ship' : null;
  if (kind) {
    const lines = db.prepare('SELECT product_id, cartons FROM order_items WHERE order_id = ? ORDER BY line_no').all(orderId) as Array<{ product_id: string; cartons: number }>;
    for (const line of lines) {
      const p = db.prepare('SELECT on_hand, reserved, version FROM products WHERE id = ?').get(line.product_id) as { on_hand: number; reserved: number; version: number };
      const q = line.cartons;
      const [dOn, dRes] = kind === 'reserve' ? [0, q] : kind === 'release' ? [0, -q] : [-q, -q];
      const ledgerId = Number(
        db
          .prepare(
            `INSERT INTO inventory_ledger (product_id, actor_user_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after, order_id, product_version_after, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(line.product_id, actor, kind, dOn, dRes, p.on_hand + dOn, p.reserved + dRes, orderId, p.version + 1, t).lastInsertRowid,
      );
      if (kind === 'reserve') {
        db.prepare("INSERT INTO order_allocations (order_id, product_id, quantity, status, reserve_ledger_id, created_at) VALUES (?, ?, ?, 'reserved', ?, ?)").run(orderId, line.product_id, q, ledgerId, t);
      } else {
        db.prepare('UPDATE order_allocations SET status = ?, settle_ledger_id = ?, settled_at = ? WHERE order_id = ? AND product_id = ?').run(kind === 'release' ? 'released' : 'consumed', ledgerId, t, orderId, line.product_id);
      }
      db.prepare('UPDATE products SET on_hand = ?, reserved = ?, version = version + 1, last_ledger_id = ? WHERE id = ?').run(p.on_hand + dOn, p.reserved + dRes, ledgerId, line.product_id);
    }
  }
  db.prepare('INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, note, order_version_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    orderId, actor, order.state, to, o.note ?? (to === 'cancelled' ? 'إلغاء للاختبار' : null), order.version + 1, t,
  );
  db.prepare('UPDATE orders SET state = ?, version = version + 1, updated_at = ? WHERE id = ?').run(to, t, orderId);
}

export interface OrderInput {
  id?: string;
  merchantId: string;
  userId: string;
  requestKey?: string;
  items: Array<{ productId: string; cartons: number; unitPrice: number; lineTotal?: number; packSize?: number }>;
  shipping?: number;
  shippingTaxable?: 0 | 1;
  taxBps?: number;
  taxCents?: number;
  totalOverride?: number;
  state?: string;
  /** Write the creation event (finalization marker, migration 0004); the order then becomes visible to reads. */
  finalize?: boolean;
}

/**
 * Inserts an order and its items (no stock effects — pending orders reserve nothing). Without
 * `finalize` the order has no creation event: it is an unfinished fixture invisible to API reads.
 */
export function insertOrder(db: DatabaseSync, o: OrderInput): string {
  const id = o.id ?? randomUUID();
  const t = now();
  const subtotal = o.items.reduce((sum, i) => sum + i.unitPrice * i.cartons, 0);
  const shipping = o.shipping ?? 0;
  const shippingTaxable = o.shippingTaxable ?? 0;
  const taxBase = subtotal + (shippingTaxable ? shipping : 0);
  const taxBps = o.taxBps ?? 0;
  const tax = o.taxCents ?? Math.round((taxBase * taxBps) / 10000);
  const display = `AK-261112-${randomBytes(3).toString('hex').toUpperCase()}`;
  db.prepare(
    `INSERT INTO orders (id, display_number, merchant_id, created_by_user_id, state, subtotal_cents, shipping_cents, shipping_taxable, tax_bps,
       tax_base_cents, tax_cents, total_cents, minimum_order_cents, buyer_business_name, buyer_contact_name, buyer_phone, buyer_governorate,
       buyer_address, note, is_demo, request_key, request_digest, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, NULL, 0, ?, ?, 1, ?, ?)`,
  ).run(
    id, display, o.merchantId, o.userId, o.state ?? 'pending', subtotal, shipping, shippingTaxable, taxBps,
    taxBase, tax, o.totalOverride ?? subtotal + tax + shipping, 'محل الاختبار', 'أحمد علي', '01012345678', 'القاهرة',
    '١٢ شارع التجربة، مدينة نصر', o.requestKey ?? randomUUID(), hex64(), t, t,
  );
  const stmt = db.prepare(
    `INSERT INTO order_items (order_id, product_id, line_no, product_name, product_brand, product_barcode, pack_size, unit_price_cents, cartons, line_total_cents)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  );
  o.items.forEach((item, idx) => {
    stmt.run(id, item.productId, idx + 1, 'شيكولاتة بالبندق', 'براند', item.packSize ?? 24, item.unitPrice, item.cartons, item.lineTotal ?? item.unitPrice * item.cartons);
  });
  if (o.finalize) {
    db.prepare("INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, created_at) VALUES (?, ?, NULL, 'pending', ?)").run(id, o.userId, t);
  }
  return id;
}

/** Asserts that `fn` fails with a SQLite error whose message matches `pattern`. */
export function sqliteFailure(fn: () => unknown): { errcode: number; message: string } {
  try {
    fn();
  } catch (err) {
    const e = err as { code?: string; errcode?: number; message: string };
    if (e.code !== 'ERR_SQLITE_ERROR') throw err;
    return { errcode: e.errcode ?? -1, message: e.message };
  }
  throw new Error('expected a SQLite error, but the statement succeeded');
}
