import type { DatabaseSync } from 'node:sqlite';
import { assertNewWrite } from '../http/write-gate.ts';
import { z } from 'zod';
import { requireAdmin, requireRecentAdminAuth, requireSession, requireSessionCsrf, revalidateAtCommit } from '../auth/authorization.ts';
import { hmacHex } from '../auth/keys.ts';
import { writeTransaction } from '../database/transaction.ts';
import { AppError } from '../http/errors.ts';
import { parseQuery } from '../http/query.ts';
import { readJsonBody } from '../http/request-body.ts';
import { sendJson } from '../http/response.ts';
import type { RequestContext } from '../http/router.ts';
import { writeAudit } from './audit.ts';

/**
 * Business settings (stage 14; SPEC "Company settings"). One row (`business_settings`, id = 1).
 * Exposes ONLY the business fields: no secrets, cookies, authentication policy, paths or deployment
 * configuration. Financial values apply to FUTURE quotes and orders only; every order keeps its own
 * snapshot (shipping, tax rate, minimum) from creation. A configured tax rate is a business choice of
 * the operator, not a statement of legal correctness.
 */

const BODY_LIMIT = 8 * 1024;
const ARABIC = /[؀-ۿ]/;

export interface SettingsRow {
  company_name: string | null;
  company_phone: string | null;
  company_email: string | null;
  company_address: string | null;
  shipping_cents: number;
  shipping_taxable: number;
  tax_bps: number;
  minimum_order_cents: number;
  low_stock_threshold_cartons: number;
  version: number;
  updated_at: number;
  updated_by: string | null;
}

export function loadSettings(db: DatabaseSync): SettingsRow {
  return db
    .prepare(
      `SELECT s.company_name, s.company_phone, s.company_email, s.company_address, s.shipping_cents, s.shipping_taxable, s.tax_bps,
              s.minimum_order_cents, s.low_stock_threshold_cartons, s.version, s.updated_at, u.username AS updated_by
         FROM business_settings s LEFT JOIN auth_users u ON u.id = s.updated_by_user_id WHERE s.id = 1`,
    )
    .get() as unknown as SettingsRow;
}

/** Current company details (null when not configured). Never invented. */
export function companyDetails(s: SettingsRow) {
  return { name: s.company_name, phone: s.company_phone, email: s.company_email, address: s.company_address };
}

export function settingsView(s: SettingsRow) {
  return {
    company: companyDetails(s),
    shippingCents: s.shipping_cents,
    shippingTaxable: s.shipping_taxable === 1,
    taxBps: s.tax_bps,
    minimumOrderCents: s.minimum_order_cents,
    lowStockThresholdCartons: s.low_stock_threshold_cartons,
    version: s.version,
    updatedAt: s.updated_at,
    updatedBy: s.updated_by,
  };
}

const optionalText = (min: number, max: number, message: string) =>
  z.union([
    z.null(),
    z
      .string({ error: message })
      .max(max * 4)
      .transform((s) => s.normalize('NFC').trim())
      .pipe(z.string().min(min, message).max(max, message).refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'النص يحتوي على رموز تحكم غير مسموح بها.')),
  ]);
const int = (min: number, max: number, message: string) => z.number({ error: message }).int(message).min(min, message).max(max, message);

/** Every field optional except expectedVersion; null clears an optional company field. */
const patchSchema = z
  .strictObject({
    expectedVersion: z.number({ error: 'رقم الإصدار المتوقع مطلوب.' }).int().min(1).max(2_147_483_647),
    companyName: optionalText(2, 120, 'اسم الشركة من 2 إلى 120 حرفًا.').optional(),
    companyPhone: z.union([z.null(), z.string().regex(/^\+?[0-9]{8,19}$/, 'رقم الهاتف من 8 إلى 20 رقمًا (يُسمح بـ + في البداية).')]).optional(),
    companyEmail: z
      .union([z.null(), z.string().max(254, 'البريد الإلكتروني أطول من المسموح.').regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'البريد الإلكتروني غير صالح.')])
      .optional(),
    companyAddress: optionalText(5, 300, 'العنوان من 5 إلى 300 حرف.').optional(),
    shippingCents: int(0, 10_000_000, 'رسوم الشحن بالقروش عدد صحيح من 0 حتى 10000000 (100000 ج.م).').optional(),
    shippingTaxable: z.boolean({ error: 'خضوع الشحن للضريبة قيمة نعم/لا.' }).optional(),
    taxBps: int(0, 10_000, 'نسبة الضريبة بنقاط الأساس عدد صحيح من 0 حتى 10000 (100%).').optional(),
    minimumOrderCents: int(0, 1_000_000_000, 'الحد الأدنى للطلب بالقروش عدد صحيح من 0 حتى 1000000000.').optional(),
    lowStockThresholdCartons: int(0, 100_000, 'حد الكمية المنخفضة عدد صحيح من 0 حتى 100000 كرتونة.').optional(),
  })
  .refine((b) => Object.keys(b).some((k) => k !== 'expectedVersion'), { message: 'لا توجد حقول للتعديل.' });

const COLUMNS = {
  companyName: 'company_name',
  companyPhone: 'company_phone',
  companyEmail: 'company_email',
  companyAddress: 'company_address',
  shippingCents: 'shipping_cents',
  shippingTaxable: 'shipping_taxable',
  taxBps: 'tax_bps',
  minimumOrderCents: 'minimum_order_cents',
  lowStockThresholdCartons: 'low_stock_threshold_cartons',
} as const;
type Field = keyof typeof COLUMNS;
/** Fields that change future quotes/orders (their before/after values are audited). */
export const FINANCIAL_FIELDS: readonly Field[] = ['shippingCents', 'shippingTaxable', 'taxBps', 'minimumOrderCents'];

export function getSettings(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireAdmin(auth);
  parseQuery(ctx.query, z.strictObject({}));
  sendJson(ctx.res, 200, { settings: settingsView(loadSettings(ctx.services.db)) });
}

export async function updateSettings(ctx: RequestContext): Promise<void> {
  const auth = requireSession(ctx);
  requireSessionCsrf(ctx, auth);
  requireRecentAdminAuth(ctx, auth);
  const parsed = patchSchema.safeParse(await readJsonBody(ctx.req, BODY_LIMIT));
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', {
      fields: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.') || '(body)', message: ARABIC.test(i.message) ? i.message : 'قيمة غير صالحة أو حقل غير مسموح به.' })),
    });
  }
  const body = parsed.data;
  const { db, now } = ctx.services;
  const result = writeTransaction(db, () => {
    const actor = revalidateAtCommit(ctx, auth, { admin: 'recent' });
    assertNewWrite(ctx);
    const current = loadSettings(db);
    if (current.version !== body.expectedVersion) throw new AppError('VERSION_CONFLICT', { current: { settings: settingsView(current) } });
    const before: Record<Field, unknown> = {
      companyName: current.company_name,
      companyPhone: current.company_phone,
      companyEmail: current.company_email,
      companyAddress: current.company_address,
      shippingCents: current.shipping_cents,
      shippingTaxable: current.shipping_taxable === 1,
      taxBps: current.tax_bps,
      minimumOrderCents: current.minimum_order_cents,
      lowStockThresholdCartons: current.low_stock_threshold_cartons,
    };
    const changed = (Object.keys(COLUMNS) as Field[]).filter((k) => body[k] !== undefined && body[k] !== before[k]);
    if (changed.length === 0) return { settings: current, changed };
    const t = Math.max(now(), current.updated_at);
    const values = changed.map((k) => (k === 'shippingTaxable' ? (body[k] ? 1 : 0) : (body[k] as string | number | null)));
    const r = db
      .prepare(`UPDATE business_settings SET ${changed.map((k) => `${COLUMNS[k]} = ?`).join(', ')}, version = version + 1, updated_at = ?, updated_by_user_id = ? WHERE id = 1 AND version = ?`)
      .run(...values, t, actor.userId, body.expectedVersion);
    if (r.changes !== 1) throw new AppError('VERSION_CONFLICT', { current: { settings: settingsView(current) } });
    // Field names always; before/after only for financial and stock-threshold values (no free text).
    const meta: Record<string, string | number | boolean> = { fields: changed.join(','), version: current.version + 1 };
    const pairs: Array<[Field, string]> = [
      ['shippingCents', 'shipping'],
      ['shippingTaxable', 'shipping_taxable'],
      ['taxBps', 'tax_bps'],
      ['minimumOrderCents', 'minimum_order'],
      ['lowStockThresholdCartons', 'low_stock_threshold'],
    ];
    for (const [f, k] of pairs) {
      if (!changed.includes(f)) continue;
      meta[`${k}_from`] = before[f] as number | boolean;
      meta[`${k}_to`] = body[f] as number | boolean;
    }
    writeAudit(db, {
      actorUserId: actor.userId,
      action: 'settings.updated',
      targetType: 'settings',
      targetId: '1',
      metadata: meta,
      ipHmac: hmacHex(ctx.services.keys.ip, ctx.clientIp),
      requestId: ctx.requestId,
      now: t,
    });
    return { settings: loadSettings(db), changed };
  });
  sendJson(ctx.res, 200, { settings: settingsView(result.settings), changedFields: result.changed });
}
