import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireAdmin, requireRecentAdminAuth, requireSession, requireSessionCsrf, revalidateAtCommit } from '../auth/authorization.ts';
import { hmacHex } from '../auth/keys.ts';
import { writeTransaction } from '../database/transaction.ts';
import { decodeCursor, encodeCursor } from '../http/cursor.ts';
import { AppError } from '../http/errors.ts';
import { parseQuery } from '../http/query.ts';
import { readJsonBody } from '../http/request-body.ts';
import { sendJson } from '../http/response.ts';
import type { RequestContext } from '../http/router.ts';
import { likePattern } from '../http/search.ts';
import { STOCK_STATUS_LABEL_AR, stockStatus } from '../../shared/stock-status.ts';
import { writeAudit } from './audit.ts';
import { adminProduct, assertCategory, loadProduct, lowStockThreshold, SELECT_PRODUCT, type ProductRow, type WriteMeta } from './products.ts';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Inventory (stage 07): administrator reads and manual adjustments of on_hand.
 *
 * on_hand   = physical cartons allocated to this portal (the business must allocate/reconcile it;
 *             sales made in other programs are NOT known here)
 * reserved  = commitments of confirmed/preparing orders (stage 09 only; never changed here)
 * available = on_hand - reserved (computed, never stored)
 *
 * Every stock change is one transaction: ledger row FIRST, then the product
 * update linked to it (last_ledger_id). Since migration 0003 the database
 * refuses any on_hand/reserved change without such a matching new ledger row,
 * whatever the write path. Not purchasing, costing, warehouses, batches or accounting.
 */

const BODY_LIMIT = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ARABIC = /[؀-ۿ]/;
export const MAX_ON_HAND = 1_000_000_000; // matches the products.on_hand CHECK

// ------------------------------------------------------------------ adjustment schemas

const common = {
  expectedVersion: z.number({ error: 'رقم الإصدار المتوقع مطلوب.' }).int().min(1).max(2_147_483_647),
  /** Client-generated UUID v4, unique per intended operation; scoped to the authenticated administrator. */
  operationKey: z.string({ error: 'مفتاح العملية مطلوب.' }).regex(UUID, 'مفتاح العملية يجب أن يكون UUID v4 بأحرف صغيرة.'),
  reason: z
    .string({ error: 'السبب مطلوب.' })
    .max(1200)
    .transform((s) => s.normalize('NFC').trim())
    .pipe(z.string().min(3, 'السبب من 3 إلى 300 حرف.').max(300, 'السبب من 3 إلى 300 حرف.')),
  reference: z
    .string()
    .max(400)
    .transform((s) => s.normalize('NFC').trim())
    .pipe(z.string().min(1, 'المرجع من 1 إلى 100 حرف.').max(100, 'المرجع من 1 إلى 100 حرف.'))
    .optional(),
};

const cartons = (min: number, max: number, message: string) => z.number({ error: message }).int(message).min(min, message).max(max, message);

/** Operation-specific strict schemas: reserved/available/balances/order/actor fields are rejected. */
const adjustmentSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('receipt'), quantity: cartons(1, MAX_ON_HAND, `الكمية المستلمة عدد صحيح موجب حتى ${MAX_ON_HAND} كرتونة.`), ...common }),
  z.strictObject({
    type: z.literal('correction_delta'),
    delta: cartons(-MAX_ON_HAND, MAX_ON_HAND, 'قيمة التسوية عدد صحيح غير صفري.').refine((d) => d !== 0, 'قيمة التسوية لا يمكن أن تكون صفرًا.'),
    ...common,
  }),
  z.strictObject({ type: z.literal('set_total'), total: cartons(0, MAX_ON_HAND, `الإجمالي عدد صحيح من 0 حتى ${MAX_ON_HAND} كرتونة.`), ...common }),
]);
type Adjustment = z.infer<typeof adjustmentSchema>;

/** Canonical digest of the meaningful request (key order fixed; no free-form JSON). */
export function adjustmentDigest(productId: string, a: Adjustment): string {
  const amount = a.type === 'receipt' ? a.quantity : a.type === 'correction_delta' ? a.delta : a.total;
  const canonical = JSON.stringify(['inventory.adjustment.v1', productId, a.type, amount, a.reason, a.reference ?? null, a.expectedVersion]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ------------------------------------------------------------------ representations

interface LedgerRow {
  id: number;
  product_id: string;
  actor_user_id: string | null;
  actor_username: string | null;
  kind: string;
  adjustment_type: string | null;
  on_hand_delta: number;
  reserved_delta: number;
  on_hand_after: number;
  reserved_after: number;
  reason: string | null;
  external_ref: string | null;
  order_id: string | null;
  operation_key: string | null;
  operation_digest: string | null;
  product_version_after: number | null;
  created_at: number;
}

const SELECT_LEDGER = `SELECT l.id, l.product_id, l.actor_user_id, u.username AS actor_username, l.kind, l.adjustment_type, l.on_hand_delta,
                              l.reserved_delta, l.on_hand_after, l.reserved_after, l.reason, l.external_ref, l.order_id, l.operation_key,
                              l.operation_digest, l.product_version_after, l.created_at
                         FROM inventory_ledger l LEFT JOIN auth_users u ON u.id = l.actor_user_id`;

function ledgerEntry(l: LedgerRow) {
  return {
    id: l.id,
    productId: l.product_id,
    kind: l.kind,
    adjustmentType: l.adjustment_type,
    onHandDelta: l.on_hand_delta,
    reservedDelta: l.reserved_delta,
    onHandAfter: l.on_hand_after,
    reservedAfter: l.reserved_after,
    availableAfter: l.on_hand_after - l.reserved_after,
    reason: l.reason,
    reference: l.external_ref,
    orderId: l.order_id,
    actor: l.actor_username,
    productVersionAfter: l.product_version_after,
    createdAt: l.created_at,
  };
}

function inventoryItem(p: ProductRow, threshold: number) {
  const available = p.on_hand - p.reserved;
  const status = stockStatus(available, threshold);
  return {
    product: { id: p.id, name: p.name, brand: p.brand, category: { id: p.category, labelAr: p.category_label_ar }, barcode: p.barcode, active: p.active === 1, isDemo: p.is_demo === 1 },
    onHand: p.on_hand,
    reserved: p.reserved,
    available,
    status,
    statusLabelAr: STOCK_STATUS_LABEL_AR[status],
    version: p.version,
    updatedAt: p.updated_at,
  };
}

function validationError(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): AppError {
  return new AppError('VALIDATION_FAILED', {
    fields: issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.') || '(body)', message: ARABIC.test(i.message) ? i.message : 'قيمة غير صالحة أو حقل غير مسموح به.' })),
  });
}

// ------------------------------------------------------------------ GET /admin/inventory

const AVAILABLE = '(p.on_hand - p.reserved)';
const SORTS = {
  name: { order: 'p.name COLLATE NOCASE ASC, p.id ASC', after: '(p.name COLLATE NOCASE, p.id) > (?, ?)', key: (p: ProductRow) => [p.name, p.id] },
  available_asc: { order: `${AVAILABLE} ASC, p.id ASC`, after: `(${AVAILABLE}, p.id) > (?, ?)`, key: (p: ProductRow) => [p.on_hand - p.reserved, p.id] },
  available_desc: { order: `${AVAILABLE} DESC, p.id DESC`, after: `(${AVAILABLE}, p.id) < (?, ?)`, key: (p: ProductRow) => [p.on_hand - p.reserved, p.id] },
  updated: { order: 'p.updated_at DESC, p.id DESC', after: '(p.updated_at, p.id) < (?, ?)', key: (p: ProductRow) => [p.updated_at, p.id] },
} as const;

const listQuerySchema = z.strictObject({
  q: z
    .string()
    .transform((s) => s.normalize('NFKC').trim())
    .pipe(z.string().min(1, 'نص البحث فارغ.').max(80, 'نص البحث أطول من 80 حرفًا.'))
    .optional(),
  category: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
  active: z.enum(['true', 'false']).optional(),
  status: z.enum(['out_of_stock', 'low_stock', 'normal']).optional(),
  sort: z.enum(['name', 'available_asc', 'available_desc', 'updated']).optional(),
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional(),
  cursor: z.string().max(2048).optional(),
});

export function listInventory(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireAdmin(auth);
  const query = parseQuery(ctx.query, listQuerySchema);
  const threshold = lowStockThreshold(ctx);
  const sortName = query.sort ?? 'name';
  const sort = SORTS[sortName];
  const limit = query.limit ?? 25;
  // The threshold is part of the scope: a cursor from before a settings change is not reused.
  const scope = ['admin.inventory', sortName, query.q ?? '', query.category ?? '', query.active ?? '', query.status ?? '', String(threshold)].join('\0');
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (query.active) {
    where.push('p.active = ?');
    params.push(query.active === 'true' ? 1 : 0);
  }
  if (query.category) {
    assertCategory(ctx, query.category);
    where.push('p.category = ?');
    params.push(query.category);
  }
  if (query.status === 'out_of_stock') where.push(`${AVAILABLE} = 0`);
  if (query.status === 'low_stock') {
    where.push(`${AVAILABLE} BETWEEN 1 AND ?`);
    params.push(threshold);
  }
  if (query.status === 'normal') {
    where.push(`${AVAILABLE} > ?`);
    params.push(threshold);
  }
  if (query.q) {
    const pattern = likePattern(query.q);
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR p.barcode = ?)");
    params.push(pattern, pattern, query.q);
  }
  if (query.cursor) {
    const position = decodeCursor(ctx.services.keys.cursor, scope, auth.identity.userId, query.cursor);
    const [k, id] = position;
    if (position.length !== 2 || !(typeof k === 'number' || typeof k === 'string') || typeof id !== 'string' || !UUID.test(id)) {
      throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'cursor', message: 'مؤشر الصفحة غير صالح.' }] });
    }
    where.push(sort.after);
    params.push(k, id);
  }
  const sql = `${SELECT_PRODUCT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${sort.order} LIMIT ?`;
  const rows = ctx.services.db.prepare(sql).all(...params, limit + 1) as unknown as ProductRow[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  sendJson(ctx.res, 200, {
    items: page.map((p) => inventoryItem(p, threshold)),
    nextCursor: rows.length > limit && last ? encodeCursor(ctx.services.keys.cursor, scope, auth.identity.userId, sort.key(last)) : null,
  });
}

// ------------------------------------------------------------------ GET /admin/inventory/:id/ledger

const ledgerQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional(),
  cursor: z.string().max(2048).optional(),
});

export function getLedger(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireAdmin(auth);
  const product = loadProduct(ctx, ctx.params.id);
  const query = parseQuery(ctx.query, ledgerQuerySchema);
  const limit = query.limit ?? 25;
  const scope = `admin.inventory.ledger\0${product.id}`;
  const params: Array<string | number> = [product.id];
  let after = '';
  if (query.cursor) {
    const position = decodeCursor(ctx.services.keys.cursor, scope, auth.identity.userId, query.cursor);
    if (position.length !== 1 || typeof position[0] !== 'number' || !Number.isSafeInteger(position[0])) {
      throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'cursor', message: 'مؤشر الصفحة غير صالح.' }] });
    }
    after = ' AND l.id < ?';
    params.push(position[0]);
  }
  const rows = ctx.services.db.prepare(`${SELECT_LEDGER} WHERE l.product_id = ?${after} ORDER BY l.id DESC LIMIT ?`).all(...params, limit + 1) as unknown as LedgerRow[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  sendJson(ctx.res, 200, {
    product: inventoryItem(product, lowStockThreshold(ctx)),
    items: page.map(ledgerEntry),
    nextCursor: rows.length > limit && last ? encodeCursor(ctx.services.keys.cursor, scope, auth.identity.userId, [last.id]) : null,
  });
}

// ------------------------------------------------------------------ POST /admin/inventory/:id/adjustments

export async function createAdjustment(ctx: RequestContext): Promise<void> {
  const auth = requireSession(ctx);
  requireSessionCsrf(ctx, auth);
  requireRecentAdminAuth(ctx, auth);
  const productId = ctx.params.id;
  if (!productId || !UUID.test(productId)) throw new AppError('NOT_FOUND');
  const parsed = adjustmentSchema.safeParse(await readJsonBody(ctx.req, BODY_LIMIT));
  if (!parsed.success) throw validationError(parsed.error.issues);
  const a = parsed.data;
  const digest = adjustmentDigest(productId, a);
  const { db, now } = ctx.services;

  const outcome = writeTransaction(db, () => {
    // 1. The administrator must still be eligible (session, role, recent authentication) — also for replays.
    const actor = revalidateAtCommit(ctx, auth, { admin: 'recent' });

    // 2. Idempotency BEFORE the version check, so a lost-response retry gets the committed result.
    const previous = db.prepare(`${SELECT_LEDGER} WHERE l.actor_user_id = ? AND l.operation_key = ?`).get(actor.userId, a.operationKey) as unknown as LedgerRow | undefined;
    if (previous) {
      if (previous.operation_digest !== digest || previous.product_id !== productId) throw new AppError('IDEMPOTENCY_KEY_REUSED');
      return { replayed: true as const, ledgerId: previous.id };
    }

    // 3. Authoritative state, the client's version, the ledger row and the linked product update.
    const product = loadProduct(ctx, productId);
    const amount = a.type === 'receipt' ? a.quantity : a.type === 'correction_delta' ? a.delta : a.total;
    const { ledgerId } = applyStockAdjustment(
      db,
      product,
      { type: a.type, amount, expectedVersion: a.expectedVersion, reason: a.reason, reference: a.reference ?? null, operationKey: a.operationKey, digest },
      { actorUserId: actor.userId, ipHmac: hmacHex(ctx.services.keys.ip, ctx.clientIp), requestId: ctx.requestId, now: now() },
    );
    return { replayed: false as const, ledgerId };
  });

  const entry = db.prepare(`${SELECT_LEDGER} WHERE l.id = ?`).get(outcome.ledgerId) as unknown as LedgerRow;
  const product = loadProduct(ctx, productId);
  sendJson(ctx.res, outcome.replayed ? 200 : 201, {
    replayed: outcome.replayed,
    operation: ledgerEntry(entry),
    product: inventoryItem(product, lowStockThreshold(ctx)),
  });
}

// ------------------------------------------------------------------ adjustment core (shared with CSV import, stage 13)

export interface StockAdjustment {
  type: 'receipt' | 'correction_delta' | 'set_total';
  /** receipt: quantity (> 0); correction_delta: signed delta (≠ 0); set_total: new physical total (≥ 0). */
  amount: number;
  expectedVersion: number;
  reason: string;
  reference: string | null;
  /** Per-request idempotency (manual adjustments). Import movements carry none: the batch record links them. */
  operationKey: string | null;
  digest: string | null;
}

/** Resulting delta and balances, or the refusal code. Pure: used by previews and by the write core. */
export function planStockAdjustment(product: { on_hand: number; reserved: number }, type: StockAdjustment['type'], amount: number) {
  const delta = type === 'set_total' ? amount - product.on_hand : amount;
  const onHandAfter = product.on_hand + delta;
  const refusal =
    delta === 0 ? ('NO_CHANGE' as const)
    : onHandAfter < 0 ? ('INVENTORY_NEGATIVE' as const)
    : onHandAfter < product.reserved ? ('INVENTORY_BELOW_RESERVED' as const)
    : onHandAfter > MAX_ON_HAND ? ('INVENTORY_LIMIT' as const)
    : null;
  return { delta, onHandAfter, reserved: product.reserved, availableAfter: onHandAfter - product.reserved, refusal };
}

/**
 * One manual stock movement INSIDE the caller's write transaction: version check, refusal rules,
 * ledger row first, then the product update linked to it (database-enforced pairing, 0003),
 * then the minimal audit event. Reserved stock is never changed here.
 */
export function applyStockAdjustment(db: DatabaseSync, product: ProductRow, a: StockAdjustment, meta: WriteMeta): { ledgerId: number; versionAfter: number; onHandAfter: number } {
  if (product.version !== a.expectedVersion) throw new AppError('VERSION_CONFLICT', { current: { product: adminProduct(product) } });
  const plan = planStockAdjustment(product, a.type, a.amount);
  const current = { product: adminProduct(product) };
  if (plan.refusal) throw new AppError(plan.refusal, { current });
  const t = Math.max(meta.now, product.updated_at);
  const versionAfter = product.version + 1;
  const ledger = db
    .prepare(
      `INSERT INTO inventory_ledger (product_id, actor_user_id, kind, adjustment_type, on_hand_delta, reserved_delta, on_hand_after, reserved_after,
                                     reason, external_ref, order_id, operation_key, operation_digest, product_version_after, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(product.id, meta.actorUserId, a.type === 'receipt' ? 'receipt' : 'correction', a.type, plan.delta, plan.onHandAfter, product.reserved, a.reason, a.reference, a.operationKey, a.digest, versionAfter, t);
  const ledgerId = Number(ledger.lastInsertRowid);
  const updated = db
    .prepare('UPDATE products SET on_hand = ?, version = version + 1, updated_at = ?, last_ledger_id = ? WHERE id = ? AND version = ?')
    .run(plan.onHandAfter, t, ledgerId, product.id, a.expectedVersion);
  if (updated.changes !== 1) throw new AppError('VERSION_CONFLICT', { current });
  writeAudit(db, {
    actorUserId: meta.actorUserId,
    action: 'inventory.adjusted',
    targetType: 'product',
    targetId: product.id,
    metadata: { type: a.type, on_hand_delta: plan.delta, on_hand_after: plan.onHandAfter, version: versionAfter, ledger_id: ledgerId },
    ipHmac: meta.ipHmac,
    requestId: meta.requestId,
    now: t,
  });
  return { ledgerId, versionAfter, onHandAfter: plan.onHandAfter };
}
