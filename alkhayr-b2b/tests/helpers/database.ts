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
}

export function insertProduct(db: DatabaseSync, o: ProductInput = {}): string {
  const id = o.id ?? randomUUID();
  const t = now();
  db.prepare(
    `INSERT INTO products (id, name, brand, category, barcode, image_url, price_cents, on_hand, reserved, pack_size, minimum_cartons, active, is_demo, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 1, 0, 1, ?, ?)`,
  ).run(
    id,
    o.name ?? 'شيكولاتة بالبندق',
    'براند',
    o.category ?? 'chocolate',
    o.barcode === undefined ? null : o.barcode,
    (o.price ?? 12550) as number,
    (o.onHand ?? 100) as number,
    (o.reserved ?? 0) as number,
    (o.pack ?? 24) as number,
    (o.min ?? 1) as number,
    t,
    t,
  );
  return id;
}

export interface OrderInput {
  id?: string;
  merchantId: string;
  userId: string;
  requestKey?: string;
  items: Array<{ productId: string; cartons: number; unitPrice: number; lineTotal?: number }>;
  shipping?: number;
  shippingTaxable?: 0 | 1;
  taxBps?: number;
  taxCents?: number;
  totalOverride?: number;
  state?: string;
}

/** Inserts an order and its items (no stock effects — pending orders reserve nothing). */
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
     VALUES (?, ?, ?, ?, ?, NULL, 24, ?, ?, ?)`,
  );
  o.items.forEach((item, idx) => {
    stmt.run(id, item.productId, idx + 1, 'شيكولاتة بالبندق', 'براند', item.unitPrice, item.cartons, item.lineTotal ?? item.unitPrice * item.cartons);
  });
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
