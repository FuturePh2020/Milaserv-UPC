import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import { requireAdmin, requireSession } from '../auth/authorization.ts';
import { readTransaction } from '../database/transaction.ts';
import { AppError } from '../http/errors.ts';
import { parseQuery } from '../http/query.ts';
import { sendJson } from '../http/response.ts';
import type { RequestContext } from '../http/router.ts';
import { dateRange, REPORT_TIME_ZONE, type DateRange } from '../reports/time.ts';
import { stockStatus, type StockStatus } from '../../shared/stock-status.ts';
import { FINALIZED } from './orders.ts';
import { loadSettings } from './settings.ts';

/**
 * Operational reports (stage 14; docs/API_CONTRACT.md §7). Administrator only, read-only, one read
 * transaction per report (coherent snapshot). Amounts are ORDER VALUES from the immutable order
 * snapshots — never collected revenue, paid sales, profit or receivables (the system does not know
 * payments). Money is aggregated in SQLite 64-bit integers read as BigInt (no floating point); an
 * overflow is an error, never a silently wrong total. Money values are returned as decimal strings
 * of integer piastres.
 */

export const ORDER_STATES = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'] as const;
export type OrderStateName = (typeof ORDER_STATES)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Runs an aggregate query reading integers as BigInt; maps SQLite's integer overflow to an explicit error. */
export function exactAll(db: DatabaseSync, sql: string, params: SQLInputValue[] = []): Array<Record<string, unknown>> {
  const stmt = db.prepare(sql);
  stmt.setReadBigInts(true);
  try {
    return stmt.all(...params) as Array<Record<string, unknown>>;
  } catch (err) {
    if (err instanceof Error && /integer overflow/i.test(err.message)) throw new AppError('AGGREGATE_OVERFLOW');
    throw err;
  }
}

const big = (v: unknown): bigint => (typeof v === 'bigint' ? v : v === null || v === undefined ? 0n : BigInt(v as number));
const n = (v: unknown): number => {
  const b = big(v);
  if (b > BigInt(Number.MAX_SAFE_INTEGER)) throw new AppError('AGGREGATE_OVERFLOW');
  return Number(b);
};

// ------------------------------------------------------------------ filters

const dateParam = z.string().max(10);
const demoParam = z.enum(['exclude', 'include', 'only']).optional();
const uuidParam = z.string().regex(UUID, 'معرّف غير صالح.');

export const ordersReportQuery = z.strictObject({ from: dateParam, to: dateParam, merchantId: uuidParam.optional(), demo: demoParam });
export const productsReportQuery = z.strictObject({ from: dateParam, to: dateParam, states: z.string().max(80).optional(), demo: demoParam });
export const inventoryReportQuery = z.strictObject({ status: z.enum(['out_of_stock', 'low_stock', 'normal']).optional(), active: z.enum(['true', 'false']).optional() });
export const movementsReportQuery = z.strictObject({ from: dateParam, to: dateParam, productId: uuidParam.optional() });

/** States for the products report: explicit list or the default (every state except cancelled). */
export function parseStates(raw: string | undefined): OrderStateName[] {
  if (raw === undefined) return ORDER_STATES.filter((s) => s !== 'cancelled');
  const list = raw.split(',');
  if (list.length === 0 || list.some((s) => !(ORDER_STATES as readonly string[]).includes(s)) || new Set(list).size !== list.length) {
    throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'states', message: 'قائمة الحالات غير صالحة.' }] });
  }
  return list as OrderStateName[];
}

function demoClause(demo: 'exclude' | 'include' | 'only' | undefined, column = 'o.is_demo'): string {
  return demo === 'include' ? '' : demo === 'only' ? ` AND ${column} = 1` : ` AND ${column} = 0`;
}

// ------------------------------------------------------------------ A. orders by current state

export interface MoneyTotals {
  orders: number;
  subtotalCents: string;
  shippingCents: string;
  taxCents: string;
  totalCents: string;
}

export function ordersReport(db: DatabaseSync, q: z.infer<typeof ordersReportQuery>) {
  const range = dateRange(q.from, q.to);
  const params: SQLInputValue[] = [range.startMs, range.endMs];
  let where = `o.created_at >= ? AND o.created_at < ? AND ${FINALIZED}${demoClause(q.demo)}`;
  if (q.merchantId) {
    where += ' AND o.merchant_id = ?';
    params.push(q.merchantId);
  }
  const rows = exactAll(
    db,
    `SELECT o.state, count(*) AS n, sum(o.subtotal_cents) AS subtotal, sum(o.shipping_cents) AS shipping, sum(o.tax_cents) AS tax, sum(o.total_cents) AS total
       FROM orders o WHERE ${where} GROUP BY o.state`,
    params,
  );
  const byState = new Map(rows.map((r) => [String(r.state), r]));
  const acc = { orders: 0, subtotal: 0n, shipping: 0n, tax: 0n, total: 0n };
  const states = ORDER_STATES.map((state) => {
    const r = byState.get(state);
    const t = { orders: r ? n(r.n) : 0, subtotal: big(r?.subtotal), shipping: big(r?.shipping), tax: big(r?.tax), total: big(r?.total) };
    if (state !== 'cancelled') {
      acc.orders += t.orders;
      acc.subtotal += t.subtotal;
      acc.shipping += t.shipping;
      acc.tax += t.tax;
      acc.total += t.total;
    }
    return { state, ...money(t) };
  });
  return {
    range: rangeView(range),
    filters: { merchantId: q.merchantId ?? null, demo: q.demo ?? 'exclude' },
    states,
    /** Sum of the five non-cancelled states (disjoint: every order has exactly one current state). */
    notCancelled: money(acc),
  };
}

function money(t: { orders: number; subtotal: bigint; shipping: bigint; tax: bigint; total: bigint }): MoneyTotals {
  return { orders: t.orders, subtotalCents: t.subtotal.toString(), shippingCents: t.shipping.toString(), taxCents: t.tax.toString(), totalCents: t.total.toString() };
}

function rangeView(r: DateRange) {
  return { from: r.from, to: r.to, timeZone: REPORT_TIME_ZONE, startMs: r.startMs, endMsExclusive: r.endMs };
}

// ------------------------------------------------------------------ B. products ordered

export function productsReport(db: DatabaseSync, q: z.infer<typeof productsReportQuery>) {
  const range = dateRange(q.from, q.to);
  const states = parseStates(q.states);
  const rows = exactAll(
    db,
    `SELECT i.product_id, p.name, p.brand, p.barcode, count(DISTINCT o.id) AS orders, sum(i.cartons) AS cartons, sum(i.line_total_cents) AS value
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
      WHERE o.created_at >= ? AND o.created_at < ? AND o.state IN (${states.map(() => '?').join(', ')}) AND ${FINALIZED}${demoClause(q.demo)}
      GROUP BY i.product_id ORDER BY cartons DESC, i.product_id ASC`,
    [range.startMs, range.endMs, ...states],
  );
  let cartons = 0n;
  let value = 0n;
  const items = rows.map((r) => {
    cartons += big(r.cartons);
    value += big(r.value);
    return { productId: String(r.product_id), name: String(r.name), brand: String(r.brand), barcode: r.barcode === null ? null : String(r.barcode), orders: n(r.orders), cartons: big(r.cartons).toString(), valueCents: big(r.value).toString() };
  });
  return { range: rangeView(range), filters: { states, demo: q.demo ?? 'exclude' }, items, totals: { products: items.length, cartons: cartons.toString(), valueCents: value.toString() } };
}

// ------------------------------------------------------------------ C. current inventory

export function inventoryReport(db: DatabaseSync, q: z.infer<typeof inventoryReportQuery>) {
  const threshold = loadSettings(db).low_stock_threshold_cartons;
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  if (q.active) {
    where.push('p.active = ?');
    params.push(q.active === 'true' ? 1 : 0);
  }
  const rows = exactAll(
    db,
    `SELECT p.id, p.name, p.brand, p.barcode, p.active, p.on_hand, p.reserved, c.label_ar FROM products p JOIN product_categories c ON c.id = p.category
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.name COLLATE NOCASE, p.id`,
    params,
  );
  const counts: Record<StockStatus, number> = { out_of_stock: 0, low_stock: 0, normal: 0 };
  let onHand = 0n;
  let reserved = 0n;
  const items = [];
  for (const r of rows) {
    const available = n(r.on_hand) - n(r.reserved);
    const status = stockStatus(available, threshold);
    if (q.status && status !== q.status) continue;
    counts[status] += 1;
    onHand += big(r.on_hand);
    reserved += big(r.reserved);
    items.push({ productId: String(r.id), name: String(r.name), brand: String(r.brand), barcode: r.barcode === null ? null : String(r.barcode), category: String(r.label_ar), active: n(r.active) === 1, onHand: n(r.on_hand), reserved: n(r.reserved), available, status });
  }
  return { threshold, filters: { status: q.status ?? null, active: q.active ?? null }, items, totals: { products: items.length, onHand: onHand.toString(), reserved: reserved.toString(), available: (onHand - reserved).toString(), byStatus: counts } };
}

// ------------------------------------------------------------------ D. stock movements

/** Exact ledger kinds (inventory_ledger.kind) and manual adjustment subtypes; nothing invented. */
export const MOVEMENT_TYPES = ['opening', 'receipt', 'correction:correction_delta', 'correction:set_total', 'correction', 'reserve', 'release', 'ship', 'import'] as const;

export function movementsReport(db: DatabaseSync, q: z.infer<typeof movementsReportQuery>) {
  const range = dateRange(q.from, q.to);
  const params: SQLInputValue[] = [range.startMs, range.endMs];
  let where = 'l.created_at >= ? AND l.created_at < ?';
  if (q.productId) {
    where += ' AND l.product_id = ?';
    params.push(q.productId);
  }
  const rows = exactAll(
    db,
    `SELECT l.kind, l.adjustment_type, count(*) AS n, count(DISTINCT l.product_id) AS products, sum(l.on_hand_delta) AS on_hand, sum(l.reserved_delta) AS reserved
       FROM inventory_ledger l WHERE ${where} GROUP BY l.kind, l.adjustment_type ORDER BY l.kind, l.adjustment_type`,
    params,
  );
  const items = rows.map((r) => {
    const kind = String(r.kind);
    const sub = r.adjustment_type === null ? null : String(r.adjustment_type);
    const type = kind === 'correction' && sub ? `correction:${sub}` : kind;
    return { type, kind, adjustmentType: sub, movements: n(r.n), products: n(r.products), onHandDelta: big(r.on_hand).toString(), reservedDelta: big(r.reserved).toString() };
  });
  return { range: rangeView(range), filters: { productId: q.productId ?? null }, items };
}

// ------------------------------------------------------------------ HTTP

function admin(ctx: RequestContext) {
  const auth = requireSession(ctx);
  requireAdmin(auth);
  return auth;
}

export function getOrdersReport(ctx: RequestContext): void {
  admin(ctx);
  const q = parseQuery(ctx.query, ordersReportQuery);
  sendJson(ctx.res, 200, { report: readTransaction(ctx.services.db, () => ordersReport(ctx.services.db, q)) });
}
export function getProductsReport(ctx: RequestContext): void {
  admin(ctx);
  const q = parseQuery(ctx.query, productsReportQuery);
  sendJson(ctx.res, 200, { report: readTransaction(ctx.services.db, () => productsReport(ctx.services.db, q)) });
}
export function getInventoryReport(ctx: RequestContext): void {
  admin(ctx);
  const q = parseQuery(ctx.query, inventoryReportQuery);
  sendJson(ctx.res, 200, { report: readTransaction(ctx.services.db, () => inventoryReport(ctx.services.db, q)) });
}
export function getMovementsReport(ctx: RequestContext): void {
  admin(ctx);
  const q = parseQuery(ctx.query, movementsReportQuery);
  sendJson(ctx.res, 200, { report: readTransaction(ctx.services.db, () => movementsReport(ctx.services.db, q)) });
}
