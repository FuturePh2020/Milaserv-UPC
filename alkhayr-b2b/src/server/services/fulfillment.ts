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
import { writeAudit } from './audit.ts';
import { FINALIZED, orderDetail, orderSummary, type OrderRow } from './orders.ts';

/**
 * Administrator order reads and fulfillment (stage 09).
 *
 * State machine (no reopening, no post-shipment cancellation, no returns, no partial fulfillment):
 *   pending -> confirmed -> preparing -> shipped -> delivered
 *   pending | confirmed | preparing -> cancelled
 *
 * Stock (per order line, through order_allocations, migration 0005):
 *   confirm            reserve: reserved += q                      allocation created 'reserved'
 *   cancel (conf/prep) release: reserved -= q                      allocation 'released'
 *   ship               ship:    on_hand -= q, reserved -= q        allocation 'consumed'
 *   prepare / deliver / cancel pending: no stock movement
 * Write order per line: ledger row -> allocation -> linked product update; then event -> order update.
 * Everything happens in ONE write transaction with no awaits inside it.
 */

const BODY_LIMIT = 4 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ARABIC = /[؀-ۿ]/;
const STATES = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'] as const;
type State = (typeof STATES)[number];

export const TRANSITIONS: Readonly<Record<State, readonly State[]>> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};
/** Forward processing before shipment requires an approved buyer; cancellation and delivery do not. */
const NEEDS_APPROVED_BUYER: ReadonlySet<State> = new Set(['confirmed', 'preparing', 'shipped']);

// ------------------------------------------------------------------ request schema

export const transitionSchema = z
  .strictObject({
    to: z.enum(['confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'], { error: 'الحالة المطلوبة غير صالحة.' }),
    expectedVersion: z.number({ error: 'رقم الإصدار المتوقع مطلوب.' }).int().min(1).max(2_147_483_647),
    /** Client-generated UUID v4 per intended transition; scoped to the authenticated administrator. */
    operationKey: z.string({ error: 'مفتاح العملية مطلوب.' }).regex(UUID, 'مفتاح العملية يجب أن يكون UUID v4 بأحرف صغيرة.'),
    reason: z
      .string({ error: 'السبب يجب أن يكون نصًا.' })
      .max(1200)
      .transform((s) => s.normalize('NFC').trim())
      .pipe(
        z
          .string()
          .min(3, 'السبب من 3 إلى 300 حرف.')
          .max(300, 'السبب من 3 إلى 300 حرف.')
          .refine((s) => !/[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/.test(s), 'السبب يحتوي على رموز تحكم غير مسموح بها.'),
      )
      .optional(),
  })
  .superRefine((b, ctx) => {
    if (b.to === 'cancelled' && b.reason === undefined) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'سبب الإلغاء مطلوب.' });
  });
type TransitionRequest = z.infer<typeof transitionSchema>;

/** Canonical digest: the order, the target, the client's expected version and the reason. */
export function transitionDigest(orderId: string, r: TransitionRequest): string {
  return createHash('sha256').update(JSON.stringify(['order.transition.v1', orderId, r.to, r.expectedVersion, r.reason ?? null]), 'utf8').digest('hex');
}

function validationError(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): AppError {
  return new AppError('VALIDATION_FAILED', {
    fields: issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.') || '(body)', message: ARABIC.test(i.message) ? i.message : 'قيمة غير صالحة أو حقل غير مسموح به.' })),
  });
}

// ------------------------------------------------------------------ representations

interface LineState {
  line_no: number;
  product_id: string;
  cartons: number;
  pack_size: number;
  allocation_status: string | null;
  allocation_quantity: number | null;
  p_active: number;
  p_pack_size: number;
  p_on_hand: number;
  p_reserved: number;
  p_version: number;
  p_updated_at: number;
  c_active: number;
}

function lineStates(ctx: RequestContext, orderId: string): LineState[] {
  return ctx.services.db
    .prepare(
      `SELECT i.line_no, i.product_id, i.cartons, i.pack_size, a.status AS allocation_status, a.quantity AS allocation_quantity,
              p.active AS p_active, p.pack_size AS p_pack_size, p.on_hand AS p_on_hand, p.reserved AS p_reserved,
              p.version AS p_version, p.updated_at AS p_updated_at, c.active AS c_active
         FROM order_items i
         JOIN products p ON p.id = i.product_id
         JOIN product_categories c ON c.id = p.category
         LEFT JOIN order_allocations a ON a.order_id = i.order_id AND a.product_id = i.product_id
        WHERE i.order_id = ? ORDER BY i.line_no`,
    )
    .all(orderId) as unknown as LineState[];
}

function loadOrder(ctx: RequestContext, id: string | undefined): OrderRow {
  if (!id || !UUID.test(id)) throw new AppError('NOT_FOUND');
  const row = ctx.services.db.prepare(`SELECT o.* FROM orders o WHERE o.id = ? AND ${FINALIZED}`).get(id) as unknown as OrderRow | undefined;
  if (!row) throw new AppError('NOT_FOUND');
  return row;
}

/** Administrator view: the snapshot order plus allocation and current product state per line, events with actors. */
function adminOrder(ctx: RequestContext, o: OrderRow) {
  const { db } = ctx.services;
  const base = orderDetail(ctx, o);
  const lines = new Map(lineStates(ctx, o.id).map((l) => [l.product_id, l]));
  const merchant = db
    .prepare('SELECT m.id, m.status, m.business_name, u.username FROM merchants m JOIN auth_users u ON u.id = m.user_id WHERE m.id = ?')
    .get(o.merchant_id) as { id: string; status: string; business_name: string; username: string };
  const events = db
    .prepare(
      `SELECT e.id, e.old_state, e.new_state, e.note, e.order_version_after, e.created_at, u.username
         FROM order_events e LEFT JOIN auth_users u ON u.id = e.actor_user_id WHERE e.order_id = ? ORDER BY e.id`,
    )
    .all(o.id) as unknown as Array<{ id: number; old_state: string | null; new_state: string; note: string | null; order_version_after: number | null; created_at: number; username: string | null }>;
  return {
    ...base,
    merchant: { id: merchant.id, username: merchant.username, currentStatus: merchant.status, currentBusinessName: merchant.business_name },
    items: base.items.map((item) => {
      const l = lines.get(item.productId) as LineState;
      return {
        ...item,
        allocation: l.allocation_status
          ? { status: l.allocation_status, quantity: l.allocation_quantity, outstanding: l.allocation_status === 'reserved' ? l.allocation_quantity : 0 }
          : null,
        currentProduct: {
          active: l.p_active === 1 && l.c_active === 1,
          packSize: l.p_pack_size,
          onHand: l.p_on_hand,
          reserved: l.p_reserved,
          available: l.p_on_hand - l.p_reserved,
        },
      };
    }),
    events: events.map((e) => ({ id: e.id, fromState: e.old_state, toState: e.new_state, reason: e.note, versionAfter: e.order_version_after ?? 1, actor: e.username, at: e.created_at })),
    allowedTransitions: TRANSITIONS[o.state as State],
  };
}

// ------------------------------------------------------------------ GET /admin/orders

const SORTS = {
  newest: { order: 'o.created_at DESC, o.id DESC', after: '(o.created_at, o.id) < (?, ?)' },
  oldest: { order: 'o.created_at ASC, o.id ASC', after: '(o.created_at, o.id) > (?, ?)' },
} as const;

const listQuerySchema = z.strictObject({
  state: z.enum(STATES).optional(),
  merchantId: z.string().regex(UUID).optional(),
  /** Exact display number (case-insensitive) or a literal substring of the buyer business name. */
  q: z
    .string()
    .transform((s) => s.normalize('NFKC').trim())
    .pipe(z.string().min(1, 'نص البحث فارغ.').max(80, 'نص البحث أطول من 80 حرفًا.'))
    .optional(),
  demo: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'oldest']).optional(),
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional(),
  cursor: z.string().max(2048).optional(),
});

export function listAdminOrders(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireAdmin(auth);
  const query = parseQuery(ctx.query, listQuerySchema);
  const sortName = query.sort ?? 'newest';
  const sort = SORTS[sortName];
  const limit = query.limit ?? 25;
  const scope = ['admin.orders', sortName, query.state ?? '', query.merchantId ?? '', query.q ?? '', query.demo ?? ''].join('\0');
  const where = [FINALIZED];
  const params: Array<string | number> = [];
  if (query.state) {
    where.push('o.state = ?');
    params.push(query.state);
  }
  if (query.merchantId) {
    where.push('o.merchant_id = ?');
    params.push(query.merchantId);
  }
  if (query.demo) {
    where.push('o.is_demo = ?');
    params.push(query.demo === 'true' ? 1 : 0);
  }
  if (query.q) {
    where.push("(o.display_number = ? OR o.buyer_business_name LIKE ? ESCAPE '\\')");
    params.push(query.q.toUpperCase(), likePattern(query.q));
  }
  if (query.cursor) {
    const position = decodeCursor(ctx.services.keys.cursor, scope, auth.identity.userId, query.cursor);
    const [createdAt, id] = position;
    if (position.length !== 2 || typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || typeof id !== 'string' || !UUID.test(id)) {
      throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'cursor', message: 'مؤشر الصفحة غير صالح.' }] });
    }
    where.push(sort.after);
    params.push(createdAt, id);
  }
  const rows = ctx.services.db
    .prepare(
      `SELECT o.id, o.display_number, o.merchant_id, o.buyer_business_name, o.buyer_governorate, o.state, o.version, o.is_demo,
              o.total_cents, o.created_at, o.updated_at,
              (SELECT count(*) FROM order_items i WHERE i.order_id = o.id) AS line_count
         FROM orders o WHERE ${where.join(' AND ')} ORDER BY ${sort.order} LIMIT ?`,
    )
    .all(...params, limit + 1) as unknown as Array<{
    id: string;
    display_number: string;
    merchant_id: string;
    buyer_business_name: string;
    buyer_governorate: string;
    state: string;
    version: number;
    is_demo: number;
    total_cents: number;
    created_at: number;
    updated_at: number;
    line_count: number;
  }>;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  sendJson(ctx.res, 200, {
    items: page.map((o) => ({
      id: o.id,
      displayNumber: o.display_number,
      merchantId: o.merchant_id,
      buyerBusinessName: o.buyer_business_name,
      buyerGovernorate: o.buyer_governorate,
      state: o.state,
      version: o.version,
      isDemo: o.is_demo === 1,
      lineCount: o.line_count,
      totalCents: o.total_cents,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(ctx.services.keys.cursor, scope, auth.identity.userId, [last.created_at, last.id]) : null,
  });
}

// ------------------------------------------------------------------ GET /admin/orders/:id

export function getAdminOrder(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireAdmin(auth);
  parseQuery(ctx.query, z.strictObject({}));
  sendJson(ctx.res, 200, { order: adminOrder(ctx, loadOrder(ctx, ctx.params.id)) });
}

/** Administrator access to the SAME trader-safe printable summary (no internal data on paper). */
export function getAdminOrderSummary(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireAdmin(auth);
  parseQuery(ctx.query, z.strictObject({}));
  sendJson(ctx.res, 200, { summary: orderSummary(ctx, loadOrder(ctx, ctx.params.id)) });
}

// ------------------------------------------------------------------ POST /admin/orders/:id/transitions

interface EventRow {
  id: number;
  order_id: string;
  old_state: string;
  new_state: string;
  note: string | null;
  operation_digest: string;
  order_version_after: number;
  created_at: number;
  username: string | null;
}

function operation(e: EventRow) {
  return { eventId: e.id, fromState: e.old_state, toState: e.new_state, orderVersionAfter: e.order_version_after, reason: e.note, actor: e.username, at: e.created_at };
}

type Movement = 'reserve' | 'release' | 'ship';

export async function transitionOrder(ctx: RequestContext): Promise<void> {
  const auth = requireSession(ctx);
  requireSessionCsrf(ctx, auth);
  requireRecentAdminAuth(ctx, auth);
  const orderId = ctx.params.id;
  if (!orderId || !UUID.test(orderId)) throw new AppError('NOT_FOUND');
  const parsed = transitionSchema.safeParse(await readJsonBody(ctx.req, BODY_LIMIT));
  if (!parsed.success) throw validationError(parsed.error.issues);
  const request = parsed.data;
  const digest = transitionDigest(orderId, request);
  const { db, now } = ctx.services;
  const selectEvent = `SELECT e.id, e.order_id, e.old_state, e.new_state, e.note, e.operation_digest, e.order_version_after, e.created_at, u.username
                         FROM order_events e LEFT JOIN auth_users u ON u.id = e.actor_user_id`;

  const outcome = writeTransaction(db, () => {
    // 1. The administrator must still be eligible (session, role, recent authentication) — also for replays.
    const actor = revalidateAtCommit(ctx, auth, { admin: 'recent' });

    // 2. Idempotency BEFORE current version/state checks: a committed identical operation is returned
    //    even if the order advanced further afterwards; nothing is applied again.
    const previous = db.prepare(`${selectEvent} WHERE e.actor_user_id = ? AND e.operation_key = ?`).get(actor.userId, request.operationKey) as unknown as EventRow | undefined;
    if (previous) {
      if (previous.operation_digest !== digest || previous.order_id !== orderId) throw new AppError('IDEMPOTENCY_KEY_REUSED');
      return { replayed: true as const, eventId: previous.id };
    }

    // 3. Current order, the client's version, and the state machine.
    const order = loadOrder(ctx, orderId);
    const current = { order: { state: order.state, version: order.version } };
    if (order.version !== request.expectedVersion) throw new AppError('VERSION_CONFLICT', { current });
    const from = order.state as State;
    if (!TRANSITIONS[from].includes(request.to)) throw new AppError('ORDER_STATE_CONFLICT', { current });

    // 4. Buyer eligibility: forward processing before shipment needs an approved buyer.
    if (NEEDS_APPROVED_BUYER.has(request.to)) {
      const buyer = db.prepare('SELECT status FROM merchants WHERE id = ?').get(order.merchant_id) as { status: string };
      if (buyer.status !== 'approved') throw new AppError('BUYER_NOT_APPROVED', { current: { ...current, buyerStatus: buyer.status } });
    }

    // 5. Line rules for the movement this transition needs.
    const lines = lineStates(ctx, order.id);
    const movement: Movement | null = request.to === 'confirmed' ? 'reserve' : request.to === 'shipped' ? 'ship' : request.to === 'cancelled' && from !== 'pending' ? 'release' : null;
    if (request.to === 'confirmed') {
      const unavailable = lines.filter((l) => l.p_active !== 1 || l.c_active !== 1);
      if (unavailable.length) throw new AppError('CONFIRM_PRODUCT_UNAVAILABLE', { current: { ...current, items: unavailable.map((l) => ({ productId: l.product_id, lineNo: l.line_no })) } });
      // Never reinterpret an ordered carton quantity with a different pieces-per-carton.
      const repacked = lines.filter((l) => l.p_pack_size !== l.pack_size);
      if (repacked.length) {
        throw new AppError('CONFIRM_PACKAGING_CHANGED', {
          current: { ...current, items: repacked.map((l) => ({ productId: l.product_id, lineNo: l.line_no, orderedPackSize: l.pack_size, currentPackSize: l.p_pack_size })) },
        });
      }
      const short = lines.filter((l) => l.p_on_hand - l.p_reserved < l.cartons);
      if (short.length) {
        throw new AppError('CONFIRM_STOCK_INSUFFICIENT', {
          current: { ...current, items: short.map((l) => ({ productId: l.product_id, lineNo: l.line_no, requested: l.cartons, available: l.p_on_hand - l.p_reserved })) },
        });
      }
      if (lines.some((l) => l.allocation_status !== null)) throw new AppError('ORDER_RESERVATION_MISMATCH', { current });
    } else if (from === 'confirmed' || from === 'preparing') {
      // Moving or releasing requires THIS order's own outstanding allocation for every line.
      if (lines.some((l) => l.allocation_status !== 'reserved' || l.allocation_quantity !== l.cartons)) throw new AppError('ORDER_RESERVATION_MISMATCH', { current });
    }

    // 6. Per-line movements: ledger row -> allocation -> linked product update (database-checked, 0003/0005).
    const t = Math.max(now(), order.updated_at);
    if (movement) {
      const insertLedger = db.prepare(
        `INSERT INTO inventory_ledger (product_id, actor_user_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after,
                                       reason, external_ref, order_id, operation_key, operation_digest, product_version_after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?, ?)`,
      );
      const reserve = db.prepare("INSERT INTO order_allocations (order_id, product_id, quantity, status, reserve_ledger_id, created_at) VALUES (?, ?, ?, 'reserved', ?, ?)");
      const settle = db.prepare("UPDATE order_allocations SET status = ?, settle_ledger_id = ?, settled_at = ? WHERE order_id = ? AND product_id = ? AND status = 'reserved'");
      const updateProduct = db.prepare('UPDATE products SET on_hand = ?, reserved = ?, version = version + 1, updated_at = ?, last_ledger_id = ? WHERE id = ? AND version = ?');
      for (const l of lines) {
        const q = l.cartons;
        const [dOn, dRes] = movement === 'reserve' ? [0, q] : movement === 'release' ? [0, -q] : [-q, -q];
        const ledgerId = Number(
          insertLedger.run(l.product_id, actor.userId, movement, dOn, dRes, l.p_on_hand + dOn, l.p_reserved + dRes, order.id, l.p_version + 1, t).lastInsertRowid,
        );
        if (movement === 'reserve') reserve.run(order.id, l.product_id, q, ledgerId, t);
        else if (settle.run(movement === 'release' ? 'released' : 'consumed', ledgerId, t, order.id, l.product_id).changes !== 1) throw new AppError('ORDER_RESERVATION_MISMATCH', { current });
        if (updateProduct.run(l.p_on_hand + dOn, l.p_reserved + dRes, Math.max(t, l.p_updated_at), ledgerId, l.product_id, l.p_version).changes !== 1) {
          throw new Error('product changed inside the serialized transaction');
        }
      }
    }

    // 7. Event first (it records the operation), then the state change bound to the CLIENT's version.
    const versionAfter = request.expectedVersion + 1;
    const event = db
      .prepare(
        `INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, note, operation_key, operation_digest, order_version_after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(order.id, actor.userId, from, request.to, request.reason ?? null, request.operationKey, digest, versionAfter, t);
    const eventId = Number(event.lastInsertRowid);
    const updated = db.prepare('UPDATE orders SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').run(request.to, t, order.id, request.expectedVersion);
    if (updated.changes !== 1) throw new AppError('VERSION_CONFLICT', { current });

    // 8. Minimal audit (the reason lives in the event; per-line quantities in the ledger).
    writeAudit(db, {
      actorUserId: actor.userId,
      action: 'order.transitioned',
      targetType: 'order',
      targetId: order.id,
      metadata: { from, to: request.to, version: versionAfter, event_id: eventId, movement: movement ?? 'none', lines_moved: movement ? lines.length : 0 },
      ipHmac: hmacHex(ctx.services.keys.ip, ctx.clientIp),
      requestId: ctx.requestId,
      now: t,
    });
    return { replayed: false as const, eventId };
  });

  const event = db.prepare(`${selectEvent} WHERE e.id = ?`).get(outcome.eventId) as unknown as EventRow;
  sendJson(ctx.res, outcome.replayed ? 200 : 201, {
    replayed: outcome.replayed,
    /** The committed operation (original result on a replay). */
    operation: operation(event),
    /** The order as it is NOW (may have advanced past the operation). */
    order: adminOrder(ctx, loadOrder(ctx, orderId)),
  });
}
