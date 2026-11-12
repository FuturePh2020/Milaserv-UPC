import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireApproved, requireSession, requireSessionCsrf, revalidateAtCommit, type AuthenticatedRequest } from '../auth/authorization.ts';
import { hmacHex } from '../auth/keys.ts';
import { writeTransaction } from '../database/transaction.ts';
import { decodeCursor, encodeCursor } from '../http/cursor.ts';
import { AppError } from '../http/errors.ts';
import { parseQuery } from '../http/query.ts';
import { readJsonBody } from '../http/request-body.ts';
import { sendJson } from '../http/response.ts';
import type { RequestContext } from '../http/router.ts';
import { BASIS_POINTS_DENOMINATOR, LIMITS } from '../../shared/constants.ts';
import { STOCK_STATUS_LABEL_AR, stockStatus } from '../../shared/stock-status.ts';
import { writeAudit } from './audit.ts';
import { lowStockThreshold } from './products.ts';

/**
 * Pending-order creation and own-order reads (stage 08).
 *
 * - The merchant is ALWAYS the session's own merchant (traders, and administrators for their own
 *   approved profile). No merchant/user/actor id is accepted from the request.
 * - The server is authoritative for prices, packaging, availability, demo classification, tax,
 *   shipping, totals and the buyer snapshot. Client prices/packaging are only stale-data checks.
 * - Creation writes header -> items -> creation event -> audit in ONE transaction. The creation
 *   event is the finalization marker (migration 0004); reads show finalized orders only.
 * - Pending orders reserve nothing: no stock, ledger or product-version change (stage 09 reserves
 *   at confirmation).
 */

const BODY_LIMIT = 32 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ARABIC = /[؀-ۿ]/;
// C0 controls except TAB and LF, DEL, and bidirectional override/isolate controls.
const FORBIDDEN_NOTE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/;
const MAX_PACK_SIZE = 10_000;

// ------------------------------------------------------------------ request schema

const intField = (min: number, max: number, message: string) => z.number({ error: message }).int(message).min(min, message).max(max, message);

const lineSchema = z.strictObject({
  productId: z.string({ error: 'معرّف المنتج مطلوب.' }).regex(UUID, 'معرّف المنتج غير صالح.'),
  cartons: intField(1, LIMITS.maxCartonsPerLine, `عدد الكراتين عدد صحيح من 1 إلى ${LIMITS.maxCartonsPerLine}.`),
  /** The carton price the trader saw; a stale-data check only (never used for pricing). */
  expectedCartonPriceCents: intField(1, LIMITS.maxCartonPriceCents, 'سعر الكرتونة المتوقع عدد صحيح موجب بالقرش.'),
  /** The pieces-per-carton the trader saw; a stale-data check only. */
  expectedPackSize: intField(1, MAX_PACK_SIZE, 'عدد القطع في الكرتونة المتوقع عدد صحيح موجب.'),
});

export const createOrderSchema = z.strictObject({
  /** Client-generated UUID v4 per intended order; scoped to the merchant (never global). */
  requestKey: z.string({ error: 'مفتاح الطلب مطلوب.' }).regex(UUID, 'مفتاح الطلب يجب أن يكون UUID v4 بأحرف صغيرة.'),
  note: z
    .string({ error: 'الملاحظة يجب أن تكون نصًا.' })
    .max(2000, 'الملاحظة أطول من 500 حرف.')
    .transform((s) => s.normalize('NFC').trim())
    .pipe(
      z
        .string()
        .max(500, 'الملاحظة أطول من 500 حرف.')
        .refine((s) => !FORBIDDEN_NOTE_CHARS.test(s), 'الملاحظة تحتوي على رموز تحكم غير مسموح بها.'),
    )
    .nullable()
    .optional()
    .transform((s) => (s ? s : null)),
  items: z
    .array(lineSchema, { error: 'قائمة الأصناف مطلوبة.' })
    .min(1, 'الطلب يجب أن يحتوي على صنف واحد على الأقل.')
    .max(LIMITS.maxOrderDistinctItems, `الطلب لا يتجاوز ${LIMITS.maxOrderDistinctItems} صنف مختلف.`)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.productId)) ctx.addIssue({ code: 'custom', path: [index, 'productId'], message: 'المنتج مكرر في الطلب؛ اجمع الكمية في سطر واحد.' });
        seen.add(item.productId);
      });
    }),
});
export type CreateOrderRequest = z.infer<typeof createOrderSchema>;

/**
 * Canonical request digest. Lines are sorted by productId (line order is presentation only),
 * fields are in a fixed order, the note is the normalized value. The digest is never returned.
 */
export function orderRequestDigest(r: CreateOrderRequest): string {
  const lines = [...r.items]
    .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0))
    .map((i) => [i.productId, i.cartons, i.expectedCartonPriceCents, i.expectedPackSize]);
  return createHash('sha256').update(JSON.stringify(['order.create.v1', r.note, lines]), 'utf8').digest('hex');
}

function validationError(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): AppError {
  return new AppError('VALIDATION_FAILED', {
    fields: issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.') || '(body)', message: ARABIC.test(i.message) ? i.message : 'قيمة غير صالحة أو حقل غير مسموح به.' })),
  });
}

/** Collection limits BEFORE detailed validation: an oversized list is refused without per-line work. */
function precheckCollection(body: unknown): void {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return;
  const items = (body as { items?: unknown }).items;
  if (Array.isArray(items) && items.length > LIMITS.maxOrderDistinctItems) {
    throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'items', message: `الطلب لا يتجاوز ${LIMITS.maxOrderDistinctItems} صنف مختلف.` }] });
  }
}

// ------------------------------------------------------------------ financial rules

export interface Settings {
  shipping_cents: number;
  shipping_taxable: number;
  tax_bps: number;
  minimum_order_cents: number;
}

export interface Amounts {
  subtotal: bigint;
  shipping: bigint;
  taxBase: bigint;
  tax: bigint;
  total: bigint;
}

/**
 * line = price x cartons; subtotal = sum(lines); taxBase = subtotal (+ shipping only if taxable);
 * tax = round-half-up(taxBase x bps / 10000) — exact integer arithmetic in BigInt (amounts are
 * non-negative, so half-up = half-away-from-zero); total = subtotal + shipping + tax.
 * Nothing is clamped: the caller rejects results above the limits.
 */
export function computeAmounts(lines: ReadonlyArray<{ price: number; cartons: number }>, s: Settings): Amounts {
  const subtotal = lines.reduce((sum, l) => sum + BigInt(l.price) * BigInt(l.cartons), 0n);
  const shipping = BigInt(s.shipping_cents);
  const taxBase = subtotal + (s.shipping_taxable === 1 ? shipping : 0n);
  const denominator = BigInt(BASIS_POINTS_DENOMINATOR);
  const tax = (taxBase * BigInt(s.tax_bps) + denominator / 2n) / denominator;
  return { subtotal, shipping, taxBase, tax, total: subtotal + shipping + tax };
}

// ------------------------------------------------------------------ representations

export interface OrderRow {
  id: string;
  display_number: string;
  merchant_id: string;
  state: string;
  subtotal_cents: number;
  shipping_cents: number;
  shipping_taxable: number;
  tax_bps: number;
  tax_base_cents: number;
  tax_cents: number;
  total_cents: number;
  minimum_order_cents: number;
  buyer_business_name: string;
  buyer_contact_name: string;
  buyer_phone: string;
  buyer_governorate: string;
  buyer_address: string;
  note: string | null;
  is_demo: number;
  request_key: string;
  request_digest: string;
  version: number;
  created_at: number;
  updated_at: number;
}

interface ItemRow {
  line_no: number;
  product_id: string;
  product_name: string;
  product_brand: string;
  product_barcode: string | null;
  pack_size: number;
  unit_price_cents: number;
  cartons: number;
  line_total_cents: number;
}

/** Only finalized orders (creation event present, migration 0004) are ever read. */
export const FINALIZED = "EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.old_state IS NULL)";

function loadOwnOrder(ctx: RequestContext, merchantId: string, id: string): OrderRow | undefined {
  return ctx.services.db.prepare(`SELECT o.* FROM orders o WHERE o.id = ? AND o.merchant_id = ? AND ${FINALIZED}`).get(id, merchantId) as unknown as OrderRow | undefined;
}

/** Order representation built from snapshots only (never from current product/profile/settings). */
export function orderDetail(ctx: RequestContext, o: OrderRow) {
  const { db } = ctx.services;
  const items = db
    .prepare('SELECT line_no, product_id, product_name, product_brand, product_barcode, pack_size, unit_price_cents, cartons, line_total_cents FROM order_items WHERE order_id = ? ORDER BY line_no')
    .all(o.id) as unknown as ItemRow[];
  // Traders see the state history without administrator identities or reasons.
  const events = db.prepare('SELECT old_state, new_state, created_at FROM order_events WHERE order_id = ? ORDER BY id').all(o.id) as unknown as Array<{ old_state: string | null; new_state: string; created_at: number }>;
  return {
    id: o.id,
    displayNumber: o.display_number,
    state: o.state,
    version: o.version,
    isDemo: o.is_demo === 1,
    note: o.note,
    requestKey: o.request_key,
    buyer: {
      businessName: o.buyer_business_name,
      contactName: o.buyer_contact_name,
      phone: o.buyer_phone,
      governorate: o.buyer_governorate,
      address: o.buyer_address,
    },
    items: items.map((i) => ({
      lineNo: i.line_no,
      productId: i.product_id,
      name: i.product_name,
      brand: i.product_brand,
      barcode: i.product_barcode,
      packSize: i.pack_size,
      cartonPriceCents: i.unit_price_cents,
      cartons: i.cartons,
      lineTotalCents: i.line_total_cents,
    })),
    amounts: {
      subtotalCents: o.subtotal_cents,
      shippingCents: o.shipping_cents,
      shippingTaxable: o.shipping_taxable === 1,
      taxBps: o.tax_bps,
      taxBaseCents: o.tax_base_cents,
      taxCents: o.tax_cents,
      totalCents: o.total_cents,
      minimumOrderCents: o.minimum_order_cents,
    },
    events: events.map((e) => ({ fromState: e.old_state, toState: e.new_state, at: e.created_at })),
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

// ------------------------------------------------------------------ POST /orders

interface CandidateRow {
  id: string;
  name: string;
  brand: string;
  barcode: string | null;
  price_cents: number;
  pack_size: number;
  minimum_cartons: number;
  on_hand: number;
  reserved: number;
  active: number;
  is_demo: number;
  category_active: number;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** AK-YYMMDD-XXXXXX (UTC date, 6 random Crockford base-32 characters; ~1.07e9 per day). */
export function newDisplayNumber(t: number): string {
  const d = new Date(t);
  const date = `${String(d.getUTCFullYear() % 100).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const bytes = randomBytes(6);
  let suffix = '';
  for (const b of bytes) suffix += CROCKFORD[b & 31];
  return `AK-${date}-${suffix}`;
}

function merchantAccessVersion(ctx: RequestContext, merchantId: string): number | undefined {
  return (ctx.services.db.prepare('SELECT access_version FROM merchants WHERE id = ?').get(merchantId) as { access_version: number } | undefined)?.access_version;
}

function requireEligible(auth: AuthenticatedRequest): void {
  requireApproved(auth);
}

export async function createOrder(ctx: RequestContext): Promise<void> {
  const auth = requireSession(ctx);
  requireSessionCsrf(ctx, auth);
  requireEligible(auth);
  // Access-version baseline: any status change (even approved -> suspended -> approved) while the
  // body is in flight makes the commit fail (ABA protection, migration 0002).
  const accessVersion = merchantAccessVersion(ctx, auth.identity.merchantId);

  const limit = ctx.services.rateLimiter.consume('order_create_account', auth.identity.merchantId);
  if (!limit.allowed) throw new AppError('RATE_LIMITED', { headers: { 'Retry-After': String(limit.retryAfterSeconds) } });

  const raw = await readJsonBody(ctx.req, BODY_LIMIT);
  precheckCollection(raw);
  const parsed = createOrderSchema.safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error.issues);
  const request = parsed.data;
  const digest = orderRequestDigest(request);
  const { db, now } = ctx.services;

  const outcome = writeTransaction(db, () => {
    // 1. Eligibility at commit: session still valid, same user, still approved, no status change since the start.
    const actor = revalidateAtCommit(ctx, auth);
    if (actor.merchantStatus !== 'approved') throw new AppError('ACCOUNT_PENDING');
    if (actor.merchantId !== auth.identity.merchantId || merchantAccessVersion(ctx, actor.merchantId) !== accessVersion) throw new AppError('ACCESS_CHANGED');
    const merchantId = actor.merchantId;

    // 2. Idempotency (per merchant) BEFORE any current-state rule, so a retry after a lost response
    //    returns the committed order even if prices, stock, profile or settings changed since.
    const previous = db.prepare('SELECT o.id, o.request_digest FROM orders o WHERE o.merchant_id = ? AND o.request_key = ?').get(merchantId, request.requestKey) as
      | { id: string; request_digest: string }
      | undefined;
    if (previous) {
      if (previous.request_digest !== digest) throw new AppError('IDEMPOTENCY_KEY_REUSED');
      return { replayed: true as const, orderId: previous.id };
    }

    // 3. Authoritative product state (one lookup per line, at most 100).
    const select = db.prepare(
      `SELECT p.id, p.name, p.brand, p.barcode, p.price_cents, p.pack_size, p.minimum_cartons, p.on_hand, p.reserved, p.active, p.is_demo,
              c.active AS category_active
         FROM products p JOIN product_categories c ON c.id = p.category WHERE p.id = ?`,
    );
    const lines = request.items.map((item, index) => ({ item, index, product: select.get(item.productId) as unknown as CandidateRow | undefined }));
    const path = (index: number, field: string) => `items.${index}.${field}`;

    // 3a. Missing, inactive, or in an inactive category: indistinguishable (no existence disclosure).
    const unavailable = lines.filter((l) => !l.product || l.product.active !== 1 || l.product.category_active !== 1);
    if (unavailable.length) {
      throw new AppError('PRODUCT_UNAVAILABLE', {
        fields: unavailable.map((l) => ({ path: path(l.index, 'productId'), message: 'المنتج غير متاح للطلب حاليًا.' })),
        current: { items: unavailable.map((l) => ({ productId: l.item.productId })) },
      });
    }
    const resolved = lines.map((l) => ({ ...l, product: l.product as CandidateRow }));

    // 3b. Demo classification is derived from the products only.
    const demoCount = resolved.filter((l) => l.product.is_demo === 1).length;
    if (demoCount > 0 && ctx.config.isProduction) throw new AppError('DEMO_NOT_ALLOWED');
    if (demoCount > 0 && demoCount < resolved.length) throw new AppError('MIXED_DEMO_ITEMS');
    const isDemo = demoCount > 0;

    // 3c. Stale price / packaging: the trader must review the current terms (they may see them).
    const stale = resolved.filter((l) => l.product.price_cents !== l.item.expectedCartonPriceCents || l.product.pack_size !== l.item.expectedPackSize);
    if (stale.length) {
      const priceChanged = stale.some((l) => l.product.price_cents !== l.item.expectedCartonPriceCents);
      throw new AppError(priceChanged ? 'PRICE_CHANGED' : 'PACKAGING_CHANGED', {
        current: { items: stale.map((l) => ({ productId: l.product.id, cartonPriceCents: l.product.price_cents, packSize: l.product.pack_size })) },
      });
    }

    // 3d. Minimum quantity per product.
    const belowMinimum = resolved.filter((l) => l.item.cartons < l.product.minimum_cartons);
    if (belowMinimum.length) {
      throw new AppError('MINIMUM_QUANTITY_NOT_MET', {
        fields: belowMinimum.map((l) => ({ path: path(l.index, 'cartons'), message: `الحد الأدنى لهذا المنتج ${l.product.minimum_cartons} كرتونة.` })),
        current: { items: belowMinimum.map((l) => ({ productId: l.product.id, minimumCartons: l.product.minimum_cartons })) },
      });
    }

    // 3e. Availability at creation (not a reservation). Only the status is disclosed, never counts.
    const threshold = lowStockThreshold(ctx);
    const short = resolved.filter((l) => l.product.on_hand - l.product.reserved < l.item.cartons);
    if (short.length) {
      throw new AppError('INSUFFICIENT_STOCK', {
        fields: short.map((l) => ({ path: path(l.index, 'cartons'), message: 'الكمية المطلوبة غير متاحة حاليًا لهذا المنتج.' })),
        current: {
          items: short.map((l) => {
            const status = stockStatus(l.product.on_hand - l.product.reserved, threshold);
            return { productId: l.product.id, availability: { status, labelAr: STOCK_STATUS_LABEL_AR[status] } };
          }),
        },
      });
    }

    // 4. Settings and amounts (exact integer arithmetic; limits are rejected, never clamped).
    const settings = db.prepare('SELECT shipping_cents, shipping_taxable, tax_bps, minimum_order_cents FROM business_settings WHERE id = 1').get() as unknown as Settings;
    const amounts = computeAmounts(
      resolved.map((l) => ({ price: l.product.price_cents, cartons: l.item.cartons })),
      settings,
    );
    const max = BigInt(LIMITS.maxOrderTotalCents);
    if (amounts.subtotal > max || amounts.total > max) throw new AppError('AMOUNT_LIMIT_EXCEEDED');
    if (amounts.subtotal < BigInt(settings.minimum_order_cents)) {
      throw new AppError('MINIMUM_ORDER_NOT_MET', { current: { minimumOrderCents: settings.minimum_order_cents, subtotalCents: Number(amounts.subtotal) } });
    }

    // 5. Buyer snapshot from the current own profile.
    const buyer = db.prepare('SELECT business_name, contact_name, phone, governorate, address FROM merchants WHERE id = ?').get(merchantId) as unknown as {
      business_name: string;
      contact_name: string;
      phone: string;
      governorate: string;
      address: string;
    };

    // 6. Header -> items -> creation event (finalization marker) -> audit.
    const t = now();
    const orderId = randomUUID();
    let displayNumber = newDisplayNumber(t);
    const taken = db.prepare('SELECT 1 FROM orders WHERE display_number = ?');
    for (let attempt = 0; taken.get(displayNumber); attempt++) {
      if (attempt >= 5) throw new Error('could not allocate a unique display number');
      displayNumber = newDisplayNumber(t);
    }
    db.prepare(
      `INSERT INTO orders (id, display_number, merchant_id, created_by_user_id, state, subtotal_cents, shipping_cents, shipping_taxable, tax_bps,
         tax_base_cents, tax_cents, total_cents, minimum_order_cents, buyer_business_name, buyer_contact_name, buyer_phone, buyer_governorate,
         buyer_address, note, is_demo, request_key, request_digest, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      orderId, displayNumber, merchantId, actor.userId, amounts.subtotal, amounts.shipping, settings.shipping_taxable, settings.tax_bps,
      amounts.taxBase, amounts.tax, amounts.total, settings.minimum_order_cents, buyer.business_name, buyer.contact_name, buyer.phone,
      buyer.governorate, buyer.address, request.note, isDemo ? 1 : 0, request.requestKey, digest, t, t,
    );
    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, line_no, product_name, product_brand, product_barcode, pack_size, unit_price_cents, cartons, line_total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    resolved.forEach((l, index) => {
      insertItem.run(orderId, l.product.id, index + 1, l.product.name, l.product.brand, l.product.barcode, l.product.pack_size, l.product.price_cents, l.item.cartons, BigInt(l.product.price_cents) * BigInt(l.item.cartons));
    });
    db.prepare("INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, note, created_at) VALUES (?, ?, NULL, 'pending', NULL, ?)").run(orderId, actor.userId, t);
    writeAudit(db, {
      actorUserId: actor.userId,
      action: 'order.created',
      targetType: 'order',
      targetId: orderId,
      metadata: { display_number: displayNumber, lines: resolved.length, total_cents: Number(amounts.total), is_demo: isDemo },
      ipHmac: hmacHex(ctx.services.keys.ip, ctx.clientIp),
      requestId: ctx.requestId,
      now: t,
    });
    return { replayed: false as const, orderId };
  });

  const order = loadOwnOrder(ctx, auth.identity.merchantId, outcome.orderId);
  if (!order) throw new Error('committed order is not readable');
  sendJson(ctx.res, outcome.replayed ? 200 : 201, { replayed: outcome.replayed, order: orderDetail(ctx, order) });
}

// ------------------------------------------------------------------ GET /orders

const ORDER_STATES = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'] as const;

const listQuerySchema = z.strictObject({
  state: z.enum(ORDER_STATES).optional(),
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional(),
  cursor: z.string().max(2048).optional(),
});

export function listOwnOrders(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireEligible(auth);
  const query = parseQuery(ctx.query, listQuerySchema);
  const limit = query.limit ?? 25;
  const merchantId = auth.identity.merchantId;
  // Bound to the user (MAC), the merchant and the filter: a cursor cannot be reused elsewhere.
  const scope = ['orders.own', merchantId, query.state ?? ''].join('\0');
  const where = ['o.merchant_id = ?', FINALIZED];
  const params: Array<string | number> = [merchantId];
  if (query.state) {
    where.push('o.state = ?');
    params.push(query.state);
  }
  if (query.cursor) {
    const position = decodeCursor(ctx.services.keys.cursor, scope, auth.identity.userId, query.cursor);
    const [createdAt, id] = position;
    if (position.length !== 2 || typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || typeof id !== 'string' || !UUID.test(id)) {
      throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'cursor', message: 'مؤشر الصفحة غير صالح.' }] });
    }
    where.push('(o.created_at, o.id) < (?, ?)');
    params.push(createdAt, id);
  }
  const rows = ctx.services.db
    .prepare(
      `SELECT o.id, o.display_number, o.state, o.is_demo, o.total_cents, o.created_at, o.updated_at,
              (SELECT count(*) FROM order_items i WHERE i.order_id = o.id) AS line_count,
              (SELECT sum(i.cartons) FROM order_items i WHERE i.order_id = o.id) AS carton_count
         FROM orders o WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC, o.id DESC LIMIT ?`,
    )
    .all(...params, limit + 1) as unknown as Array<{
    id: string;
    display_number: string;
    state: string;
    is_demo: number;
    total_cents: number;
    created_at: number;
    updated_at: number;
    line_count: number;
    carton_count: number;
  }>;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  sendJson(ctx.res, 200, {
    items: page.map((o) => ({
      id: o.id,
      displayNumber: o.display_number,
      state: o.state,
      isDemo: o.is_demo === 1,
      lineCount: o.line_count,
      cartonCount: o.carton_count,
      totalCents: o.total_cents,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(ctx.services.keys.cursor, scope, auth.identity.userId, [last.created_at, last.id]) : null,
  });
}

// ------------------------------------------------------------------ GET /orders/:id

export function getOwnOrder(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireEligible(auth);
  parseQuery(ctx.query, z.strictObject({}));
  const id = ctx.params.id;
  // Foreign, unfinished and non-existent orders are indistinguishable.
  if (!id || !UUID.test(id)) throw new AppError('NOT_FOUND');
  const order = loadOwnOrder(ctx, auth.identity.merchantId, id);
  if (!order) throw new AppError('NOT_FOUND');
  sendJson(ctx.res, 200, { order: orderDetail(ctx, order) });
}
