import type { SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import { requireRecentAdminAuth, requireSession, requireSessionCsrf, revalidateAtCommit } from '../auth/authorization.ts';
import { hmacHex } from '../auth/keys.ts';
import { readTransaction, writeTransaction } from '../database/transaction.ts';
import { AppError } from '../http/errors.ts';
import { readJsonBody } from '../http/request-body.ts';
import type { RequestContext } from '../http/router.ts';
import { likePattern } from '../http/search.ts';
import { BOM, canonicalCell, CRLF, egp, isFormulaLike, num, text, viewCell, type Cell } from '../reports/csv-out.ts';
import { localDateTime, dateRange } from '../reports/time.ts';
import { STOCK_STATUS_LABEL_AR } from '../../shared/stock-status.ts';
import { writeAudit } from './audit.ts';
import { IMPORT_COLUMNS } from './imports.ts';
import { FINALIZED } from './orders.ts';
import {
  exactAll,
  inventoryReport,
  inventoryReportQuery,
  movementsReport,
  movementsReportQuery,
  ORDER_STATES,
  ordersReport,
  ordersReportQuery,
  productsReport,
  productsReportQuery,
} from './reports.ts';

/**
 * Administrator exports (stage 14; docs/API_CONTRACT.md §8). Sensitive bulk output: recent
 * authentication, session CSRF, exact Origin, per-administrator rate limit, at most two at once,
 * fixed row and byte caps (a request above a cap is REFUSED, never truncated), one read transaction
 * for rows and totals, an audit event with metadata only. No write transaction is open while the
 * file is sent. Filenames are fixed ASCII patterns (no user text in headers).
 */

export const EXPORT_MAX_ROWS = 10_000;
export const EXPORT_MAX_BYTES = 8 * 1024 * 1024;
const BODY_LIMIT = 4 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ARABIC = /[؀-ۿ]/;

const STATE_AR: Record<string, string> = { pending: 'قيد المراجعة', confirmed: 'مؤكد', preparing: 'قيد التجهيز', shipped: 'تم الشحن', delivered: 'تم التسليم', cancelled: 'ملغي' };
const MOVEMENT_AR: Record<string, string> = {
  opening: 'رصيد افتتاحي',
  receipt: 'استلام',
  'correction:correction_delta': 'تسوية بفرق',
  'correction:set_total': 'جرد (ضبط الإجمالي)',
  correction: 'تسوية',
  reserve: 'حجز لطلب مؤكد',
  release: 'إلغاء حجز',
  ship: 'خصم بالشحن',
  import: 'استيراد',
};

let active = 0;
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 2) throw new AppError('IMPORT_BUSY', { headers: { 'Retry-After': '5' } });
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
  }
}

const productFilter = z.strictObject({
  q: z.string().max(80).transform((s) => s.normalize('NFKC').trim()).optional(),
  category: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
  active: z.enum(['true', 'false']).optional(),
  status: z.enum(['out_of_stock', 'low_stock', 'normal']).optional(),
});
const ordersFilter = z.strictObject({
  from: z.string().max(10),
  to: z.string().max(10),
  state: z.enum(ORDER_STATES).optional(),
  merchantId: z.string().regex(UUID).optional(),
  demo: z.enum(['exclude', 'include', 'only']).optional(),
});

const exportSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('products'), filters: productFilter.omit({ status: true }).default({}) }),
  z.strictObject({ type: z.literal('inventory'), filters: inventoryReportQuery.default({}) }),
  z.strictObject({ type: z.literal('orders'), filters: ordersFilter, includeBuyerContact: z.boolean().default(false) }),
  z.strictObject({ type: z.literal('report_orders'), filters: ordersReportQuery }),
  z.strictObject({ type: z.literal('report_products'), filters: productsReportQuery }),
  z.strictObject({ type: z.literal('report_movements'), filters: movementsReportQuery }),
]);
type ExportRequest = z.infer<typeof exportSchema>;

const templateSchema = z.strictObject({
  mode: z.enum(['update_products', 'receive_stock', 'set_stock_total']),
  filters: productFilter.default({}),
});

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new AppError('VALIDATION_FAILED', {
      fields: r.error.issues.slice(0, 10).map((i) => ({ path: i.path.map(String).join('.') || '(body)', message: ARABIC.test(i.message) ? i.message : 'قيمة غير صالحة أو حقل غير مسموح به.' })),
    });
  }
  return r.data;
}

// ------------------------------------------------------------------ table builder with caps

class Table {
  #lines: string[] = [];
  #bytes = 0;
  constructor(header: string[]) {
    this.push(header.map((h) => text(h)));
  }
  push(cells: Cell[]) {
    const line = cells.map(viewCell).join(',');
    this.#bytes += Buffer.byteLength(line, 'utf8') + 2;
    if (this.#bytes > EXPORT_MAX_BYTES) throw new AppError('EXPORT_TOO_LARGE', { current: { maxBytes: EXPORT_MAX_BYTES } });
    this.#lines.push(line);
  }
  get rows() {
    return this.#lines.length - 1;
  }
  toString() {
    return BOM + this.#lines.join(CRLF) + CRLF;
  }
}

function tooMany(count: number) {
  if (count > EXPORT_MAX_ROWS) throw new AppError('EXPORT_TOO_LARGE', { current: { rows: count, maxRows: EXPORT_MAX_ROWS } });
}

function productWhere(f: z.infer<typeof productFilter>) {
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  if (f.active) {
    where.push('p.active = ?');
    params.push(f.active === 'true' ? 1 : 0);
  }
  if (f.category) {
    where.push('p.category = ?');
    params.push(f.category);
  }
  if (f.q) {
    const pattern = likePattern(f.q);
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR p.barcode = ?)");
    params.push(pattern, pattern, f.q);
  }
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

// ------------------------------------------------------------------ view exports

function buildExport(ctx: RequestContext, req: ExportRequest): { table: Table; filters: string } {
  const db = ctx.services.db;
  switch (req.type) {
    case 'products': {
      const w = productWhere(req.filters);
      const rows = exactAll(
        db,
        `SELECT p.id, p.name, p.brand, p.category, c.label_ar, p.barcode, p.price_cents, p.pack_size, p.minimum_cartons, p.active, p.is_demo, p.on_hand, p.reserved, p.version, p.updated_at
           FROM products p JOIN product_categories c ON c.id = p.category${w.sql} ORDER BY p.name COLLATE NOCASE, p.id`,
        w.params,
      );
      tooMany(rows.length);
      const t = new Table(['معرّف المنتج', 'الاسم', 'البراند', 'القسم', 'معرّف القسم', 'الباركود', 'سعر الكرتونة (ج.م)', 'القطع/الكرتونة', 'الحد الأدنى (كرتونة)', 'مفعّل', 'عرض تجريبي', 'الرصيد الإجمالي', 'المحجوز', 'المتاح', 'الإصدار', 'آخر تحديث (القاهرة)']);
      for (const r of rows) {
        t.push([text(String(r.id)), text(String(r.name)), text(String(r.brand)), text(String(r.label_ar)), text(String(r.category)), text(r.barcode === null ? '' : String(r.barcode)), num(egp(r.price_cents as bigint)), num(r.pack_size as bigint), num(r.minimum_cartons as bigint), text(r.active === 1n ? 'نعم' : 'لا'), text(r.is_demo === 1n ? 'نعم' : 'لا'), num(r.on_hand as bigint), num(r.reserved as bigint), num((r.on_hand as bigint) - (r.reserved as bigint)), num(r.version as bigint), text(localDateTime(Number(r.updated_at)))]);
      }
      return { table: t, filters: JSON.stringify(req.filters) };
    }
    case 'inventory': {
      const rep = inventoryReport(db, req.filters);
      const t = new Table(['معرّف المنتج', 'الاسم', 'البراند', 'القسم', 'الباركود', 'مفعّل', 'الرصيد الإجمالي', 'المحجوز', 'المتاح', 'الحالة']);
      for (const r of rep.items) t.push([text(r.productId), text(r.name), text(r.brand), text(r.category), text(r.barcode ?? ''), text(r.active ? 'نعم' : 'لا'), num(r.onHand), num(r.reserved), num(r.available), text(STOCK_STATUS_LABEL_AR[r.status])]);
      t.push([text('الإجمالي'), null, null, null, null, null, num(rep.totals.onHand), num(rep.totals.reserved), num(rep.totals.available), text(`حد الكمية المنخفضة: ${rep.threshold}`)]);
      return { table: t, filters: JSON.stringify(req.filters) };
    }
    case 'orders': {
      const f = req.filters;
      const range = dateRange(f.from, f.to);
      const params: SQLInputValue[] = [range.startMs, range.endMs];
      let where = `o.created_at >= ? AND o.created_at < ? AND ${FINALIZED}`;
      where += f.demo === 'include' ? '' : f.demo === 'only' ? ' AND o.is_demo = 1' : ' AND o.is_demo = 0';
      if (f.state) {
        where += ' AND o.state = ?';
        params.push(f.state);
      }
      if (f.merchantId) {
        where += ' AND o.merchant_id = ?';
        params.push(f.merchantId);
      }
      const count = Number((exactAll(db, `SELECT count(*) AS n FROM orders o WHERE ${where}`, params)[0]!.n as bigint));
      tooMany(count);
      const rows = exactAll(
        db,
        `SELECT o.display_number, o.created_at, o.state, o.is_demo, o.buyer_business_name, o.buyer_governorate, o.buyer_contact_name, o.buyer_phone, o.buyer_address,
                o.subtotal_cents, o.shipping_cents, o.tax_bps, o.tax_cents, o.total_cents, (SELECT count(*) FROM order_items i WHERE i.order_id = o.id) AS lines
           FROM orders o WHERE ${where} ORDER BY o.created_at, o.id`,
        params,
      );
      const contact = req.includeBuyerContact;
      const t = new Table([
        'رقم الطلب', 'تاريخ الإنشاء (القاهرة)', 'الحالة الحالية', 'عرض تجريبي', 'النشاط التجاري', 'المحافظة',
        ...(contact ? ['اسم المسؤول', 'الهاتف', 'العنوان'] : []),
        'عدد الأصناف', 'إجمالي البضاعة (ج.م)', 'الشحن (ج.م)', 'نسبة الضريبة (نقاط أساس)', 'الضريبة (ج.م)', 'الإجمالي (ج.م)',
      ]);
      for (const r of rows) {
        t.push([
          text(String(r.display_number)), text(localDateTime(Number(r.created_at))), text(STATE_AR[String(r.state)] ?? String(r.state)), text(r.is_demo === 1n ? 'نعم' : 'لا'),
          text(String(r.buyer_business_name)), text(String(r.buyer_governorate)),
          ...(contact ? [text(String(r.buyer_contact_name)), text(String(r.buyer_phone)), text(String(r.buyer_address))] : []),
          num(r.lines as bigint), num(egp(r.subtotal_cents as bigint)), num(egp(r.shipping_cents as bigint)), num(r.tax_bps as bigint), num(egp(r.tax_cents as bigint)), num(egp(r.total_cents as bigint)),
        ]);
      }
      return { table: t, filters: JSON.stringify({ ...f, includeBuyerContact: contact }) };
    }
    case 'report_orders': {
      const rep = ordersReport(db, req.filters);
      const t = new Table(['الحالة الحالية', 'عدد الطلبات', 'إجمالي البضاعة (ج.م)', 'الشحن (ج.م)', 'الضريبة (ج.م)', 'الإجمالي (ج.م)']);
      for (const s of rep.states) t.push([text(STATE_AR[s.state] ?? s.state), num(s.orders), num(egp(BigInt(s.subtotalCents))), num(egp(BigInt(s.shippingCents))), num(egp(BigInt(s.taxCents))), num(egp(BigInt(s.totalCents)))]);
      const c = rep.notCancelled;
      t.push([text('كل الحالات عدا الملغاة (قيمة طلبات، ليست إيرادًا محصّلًا)'), num(c.orders), num(egp(BigInt(c.subtotalCents))), num(egp(BigInt(c.shippingCents))), num(egp(BigInt(c.taxCents))), num(egp(BigInt(c.totalCents)))]);
      return { table: t, filters: JSON.stringify(req.filters) };
    }
    case 'report_products': {
      const rep = productsReport(db, req.filters);
      tooMany(rep.items.length);
      const t = new Table(['معرّف المنتج', 'الاسم الحالي', 'البراند', 'الباركود', 'عدد الطلبات', 'الكراتين المطلوبة', 'قيمة الأسطر وقت الطلب (ج.م)']);
      for (const r of rep.items) t.push([text(r.productId), text(r.name), text(r.brand), text(r.barcode ?? ''), num(r.orders), num(r.cartons), num(egp(BigInt(r.valueCents)))]);
      t.push([text('الإجمالي'), null, null, null, null, num(rep.totals.cartons), num(egp(BigInt(rep.totals.valueCents)))]);
      return { table: t, filters: JSON.stringify(req.filters) };
    }
    case 'report_movements': {
      const rep = movementsReport(db, req.filters);
      const t = new Table(['نوع الحركة', 'المعرّف', 'عدد الحركات', 'عدد المنتجات', 'صافي تغيّر الرصيد الإجمالي (كرتونة)', 'صافي تغيّر المحجوز (كرتونة)']);
      for (const r of rep.items) t.push([text(MOVEMENT_AR[r.type] ?? r.type), text(r.type), num(r.movements), num(r.products), num(r.onHandDelta), num(r.reservedDelta)]);
      return { table: t, filters: JSON.stringify(req.filters) };
    }
  }
}

function sendCsv(ctx: RequestContext, kind: string, body: string): void {
  const stamp = localDateTime(ctx.services.now()).replace(/[-: ]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
  const buf = Buffer.from(body, 'utf8');
  ctx.res.statusCode = 200;
  ctx.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  // Fixed ASCII pattern: no user-supplied text ever reaches a header.
  ctx.res.setHeader('Content-Disposition', `attachment; filename="alkhayr-${kind}-${stamp}.csv"`);
  ctx.res.setHeader('Cache-Control', 'no-store, private');
  ctx.res.setHeader('Content-Length', String(buf.length));
  ctx.res.end(buf);
}

function audit(ctx: RequestContext, auth: ReturnType<typeof requireSession>, type: string, filters: string, rows: number, bytes: number, contact: boolean) {
  writeTransaction(ctx.services.db, () => {
    // Authorization is re-checked right before anything is released.
    const actor = revalidateAtCommit(ctx, auth, { admin: 'recent' });
    writeAudit(ctx.services.db, {
      actorUserId: actor.userId,
      action: 'export.created',
      targetType: 'export',
      targetId: type,
      metadata: { type, filters: filters.slice(0, 400), rows, bytes, contact_data: contact },
      ipHmac: hmacHex(ctx.services.keys.ip, ctx.clientIp),
      requestId: ctx.requestId,
      now: ctx.services.now(),
    });
  });
}

/** POST /api/v1/admin/exports — spreadsheet-safe VIEW export (not for re-import). */
export async function createExport(ctx: RequestContext): Promise<void> {
  const auth = requireSession(ctx);
  requireSessionCsrf(ctx, auth);
  requireRecentAdminAuth(ctx, auth);
  const limit = ctx.services.rateLimiter.consume('export_account', auth.identity.userId);
  if (!limit.allowed) throw new AppError('RATE_LIMITED', { headers: { 'Retry-After': String(limit.retryAfterSeconds) } });
  await withSlot(async () => {
    const req = parse(exportSchema, await readJsonBody(ctx.req, BODY_LIMIT));
    const { table, filters } = readTransaction(ctx.services.db, () => buildExport(ctx, req));
    const body = table.toString();
    audit(ctx, auth, req.type, filters, table.rows, Buffer.byteLength(body, 'utf8'), req.type === 'orders' && req.includeBuyerContact);
    sendCsv(ctx, req.type.replace(/_/g, '-'), body);
  });
}

/**
 * POST /api/v1/admin/imports/templates/prefilled — CANONICAL stage-13 template with stable ids and
 * current versions. Amount, reason and change columns are left EMPTY (nothing that could look like an
 * approved quantity or count). `currentName` is written exactly, or left empty when it is
 * formula-like (an optional display field is omitted rather than altered).
 */
export async function createPrefilledTemplate(ctx: RequestContext): Promise<void> {
  const auth = requireSession(ctx);
  requireSessionCsrf(ctx, auth);
  requireRecentAdminAuth(ctx, auth);
  const limit = ctx.services.rateLimiter.consume('export_account', auth.identity.userId);
  if (!limit.allowed) throw new AppError('RATE_LIMITED', { headers: { 'Retry-After': String(limit.retryAfterSeconds) } });
  await withSlot(async () => {
    const req = parse(templateSchema, await readJsonBody(ctx.req, BODY_LIMIT));
    const spec = IMPORT_COLUMNS[req.mode];
    const header = [...spec.required, ...spec.optional];
    const { lines, omitted } = readTransaction(ctx.services.db, () => {
      let rows = exactAll(ctx.services.db, `SELECT p.id, p.name, p.version, p.on_hand, p.reserved FROM products p${productWhere(req.filters).sql} ORDER BY p.name COLLATE NOCASE, p.id`, productWhere(req.filters).params);
      if (req.filters.status) {
        const threshold = Number((exactAll(ctx.services.db, 'SELECT low_stock_threshold_cartons AS t FROM business_settings WHERE id = 1')[0]!.t as bigint));
        rows = rows.filter((r) => {
          const a = Number(r.on_hand) - Number(r.reserved);
          const s = a === 0 ? 'out_of_stock' : a <= threshold ? 'low_stock' : 'normal';
          return s === req.filters.status;
        });
      }
      tooMany(rows.length);
      let omittedNames = 0;
      const out = [header.map(canonicalCell).join(',')];
      for (const r of rows) {
        const name = String(r.name);
        const safeName = isFormulaLike(name) ? '' : name;
        if (!safeName) omittedNames += 1;
        const value = (col: string) => (col === 'productId' ? String(r.id) : col === 'expectedVersion' ? String(r.version) : col === 'currentName' ? safeName : '');
        out.push(header.map((h) => canonicalCell(value(h))).join(','));
      }
      return { lines: out, omitted: omittedNames };
    });
    const body = BOM + lines.join(CRLF) + CRLF;
    if (Buffer.byteLength(body, 'utf8') > 1024 * 1024) throw new AppError('EXPORT_TOO_LARGE', { current: { maxBytes: 1024 * 1024 } });
    ctx.res.setHeader('X-Omitted-Display-Names', String(omitted));
    audit(ctx, auth, `template_${req.mode}`, JSON.stringify(req.filters), lines.length - 1, Buffer.byteLength(body, 'utf8'), false);
    sendCsv(ctx, `template-${req.mode.replace(/_/g, '-')}`, body);
  });
}
