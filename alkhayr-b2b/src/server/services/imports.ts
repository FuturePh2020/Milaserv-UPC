import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { assertNewWrite } from '../http/write-gate.ts';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { requireAdmin, requireRecentAdminAuth, requireSession, requireSessionCsrf, revalidateAtCommit } from '../auth/authorization.ts';
import { hmacBase64Url, hmacHex } from '../auth/keys.ts';
import { readTransaction, writeTransaction } from '../database/transaction.ts';
import { decodeCursor, encodeCursor } from '../http/cursor.ts';
import { AppError } from '../http/errors.ts';
import { parseQuery } from '../http/query.ts';
import { readJsonBody } from '../http/request-body.ts';
import { sendJson } from '../http/response.ts';
import type { RequestContext } from '../http/router.ts';
import { moneyEgp, parseCsv, wholeNumber, type Cell, type CsvRecord } from '../import/csv.ts';
import { LIMITS } from '../../shared/constants.ts';
import { ERROR_CATALOG } from '../../shared/errors.ts';
import { writeAudit } from './audit.ts';
import { applyStockAdjustment, MAX_ON_HAND, planStockAdjustment } from './inventory.ts';
import {
  applyProductUpdate,
  assertCatalogCapacity,
  barcodeField,
  barcodeOwner,
  brandField,
  categoryField,
  changedFields,
  imageField,
  insertProductRecord,
  isCategoryActive,
  loadProductDb,
  nameField,
  productCount,
  type NewProduct,
  type ProductChanges,
  type ProductRow,
  type UpdatableField,
  type WriteMeta,
} from './products.ts';

/**
 * Administrator CSV imports (stage 13; docs/API_CONTRACT.md §6, docs/IMPORT_GUIDE_AR.md).
 *
 * Flow: preview (validate, write nothing, return a signed binding) → explicit confirmation with the
 * SAME file bytes, the binding and a client operation key → one write transaction that re-checks
 * identity, recent authentication and every business rule, applies all records with the same
 * product/inventory cores as the single-record endpoints, and records the batch durably — or writes
 * nothing. The uploaded file is never stored; the preview is not a lock.
 */

export const IMPORT_MODES = ['create_products', 'update_products', 'receive_stock', 'set_stock_total'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

/** Exact header contract per mode (order free; names case-sensitive; no extra columns). */
export const IMPORT_COLUMNS: Readonly<Record<ImportMode, { required: readonly string[]; optional: readonly string[] }>> = {
  create_products: { required: ['name', 'brand', 'category', 'cartonPriceEgp', 'packSize', 'minimumCartons'], optional: ['barcode', 'imageUrl'] },
  update_products: {
    required: ['productId', 'expectedVersion'],
    optional: ['currentName', 'name', 'brand', 'category', 'cartonPriceEgp', 'packSize', 'minimumCartons', 'barcode', 'imageUrl'],
  },
  receive_stock: { required: ['productId', 'expectedVersion', 'quantity', 'reason'], optional: ['currentName', 'reference'] },
  set_stock_total: { required: ['productId', 'expectedVersion', 'total', 'reason'], optional: ['currentName', 'reference'] },
};

/** In update mode: an empty cell = unchanged; this exact token clears an OPTIONAL field (barcode, imageUrl) to null. */
export const CLEAR_TOKEN = '__CLEAR__';
export const PREVIEW_TTL_MS = 20 * 60_000;
const MAX_CONCURRENT_JOBS = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ARABIC = /[؀-ۿ]/;

// ------------------------------------------------------------------ bounded concurrent work

let activeJobs = 0;
/** At most MAX_CONCURRENT_JOBS uploads are decoded/parsed/evaluated at once (memory bound). */
async function withJobSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeJobs >= MAX_CONCURRENT_JOBS) throw new AppError('IMPORT_BUSY', { headers: { 'Retry-After': '5' } });
  activeJobs += 1;
  try {
    return await fn();
  } finally {
    activeJobs -= 1;
  }
}

// ------------------------------------------------------------------ request bodies

const base64File = z
  .string({ error: 'الملف مطلوب.' })
  .max(Math.ceil(LIMITS.importMaxFileBytes / 3) * 4 + 4, 'حجم الملف أكبر من 1 ميجابايت.')
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'محتوى الملف المرسل غير صالح (base64).');
const modeField = z.enum(IMPORT_MODES, { error: 'نوع الاستيراد غير صالح.' });
const previewSchema = z.strictObject({ mode: modeField, file: base64File });
const commitSchema = z.strictObject({
  mode: modeField,
  file: base64File,
  operationKey: z.string({ error: 'مفتاح العملية مطلوب.' }).regex(UUID, 'مفتاح العملية يجب أن يكون UUID v4 بأحرف صغيرة.'),
  previewToken: z.string({ error: 'رمز المعاينة مطلوب.' }).min(10).max(1024),
});

function fieldErrors(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): AppError {
  return new AppError('VALIDATION_FAILED', {
    fields: issues.slice(0, 10).map((i) => ({ path: i.path.map(String).join('.') || '(body)', message: ARABIC.test(i.message) ? i.message : 'قيمة غير صالحة أو حقل غير مسموح به.' })),
  });
}

async function readImportBody<T>(ctx: RequestContext, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await readJsonBody(ctx.req, LIMITS.jsonBodyImportBytes));
  if (!parsed.success) throw fieldErrors(parsed.error.issues);
  return parsed.data;
}

function decodeFile(b64: string): Buffer {
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length > LIMITS.importMaxFileBytes) throw new AppError('PAYLOAD_TOO_LARGE');
  if (bytes.length === 0) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'file', message: 'الملف فارغ.' }] });
  return bytes;
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
/** What a key commits to: the mode and the exact file bytes (not the preview token, which expires). */
export const requestDigest = (mode: ImportMode, contentSha256: string) => sha256(JSON.stringify(['import.commit.v1', mode, contentSha256]));

// ------------------------------------------------------------------ evaluation (shared by preview and commit)

export interface RowIssue {
  field: string | null;
  message: string;
}

export interface RowReport {
  recordNo: number;
  line: number;
  status: 'ok' | 'error';
  productId: string | null;
  /** Current name from the database (update/stock) or the name to create. Informational only. */
  productName: string | null;
  errors: RowIssue[];
  warnings: string[];
  change: Record<string, unknown> | null;
}

type Intent =
  | { kind: 'create'; product: NewProduct }
  | { kind: 'update'; product: ProductRow; expectedVersion: number; changes: ProductChanges }
  | { kind: 'stock'; product: ProductRow; expectedVersion: number; amount: number; reason: string; reference: string | null };

export interface Evaluation {
  mode: ImportMode;
  fileErrors: RowIssue[];
  rows: RowReport[];
  intents: Intent[];
  /** Digest of the target products' versions seen by this evaluation (binding for confirmation). */
  stateDigest: string;
}

const FIELD_LABEL: Record<string, string> = {
  name: 'اسم المنتج',
  brand: 'البراند',
  category: 'القسم',
  cartonPriceEgp: 'سعر الكرتونة',
  packSize: 'عدد القطع في الكرتونة',
  minimumCartons: 'الحد الأدنى بالكرتونة',
  barcode: 'الباركود',
  imageUrl: 'رابط الصورة',
  productId: 'معرّف المنتج',
  expectedVersion: 'الإصدار المتوقع',
  quantity: 'الكمية المستلمة',
  total: 'الإجمالي الفعلي',
  reason: 'السبب',
  reference: 'المرجع',
  currentName: 'الاسم الحالي (للمراجعة)',
};

/** Reuses the API's zod field schema (same limits, normalization and messages). */
function viaSchema<T>(schema: z.ZodType<T>, value: unknown): Cell<T> {
  const r = schema.safeParse(value);
  if (r.success) return { ok: true, value: r.data };
  const msg = r.error.issues[0]?.message ?? '';
  return { ok: false, message: ARABIC.test(msg) ? msg : 'قيمة غير صالحة.' };
}

const reasonField = z
  .string()
  .max(1200)
  .transform((s) => s.normalize('NFC').trim())
  .pipe(z.string().min(3, 'السبب من 3 إلى 300 حرف.').max(300, 'السبب من 3 إلى 300 حرف.'));
const referenceField = z
  .string()
  .max(400)
  .transform((s) => s.normalize('NFC').trim())
  .pipe(z.string().min(1, 'المرجع من 1 إلى 100 حرف.').max(100, 'المرجع من 1 إلى 100 حرف.'));

function headerCheck(mode: ImportMode, header: string[]): RowIssue[] {
  const spec = IMPORT_COLUMNS[mode];
  const allowed = new Set([...spec.required, ...spec.optional]);
  const issues: RowIssue[] = [];
  const seen = new Set<string>();
  for (const h of header) {
    if (seen.has(h)) issues.push({ field: h, message: `عنوان عمود مكرر: «${h}».` });
    seen.add(h);
    if (!allowed.has(h)) issues.push({ field: null, message: `عنوان عمود غير معروف لهذا النوع من الاستيراد: «${h.slice(0, 60)}». العناوين المسموحة: ${[...allowed].join('، ')}.` });
  }
  for (const r of spec.required) if (!seen.has(r)) issues.push({ field: r, message: `العمود المطلوب «${r}» غير موجود في صف العناوين.` });
  if (mode === 'update_products' && ![...seen].some((h) => !['productId', 'expectedVersion', 'currentName'].includes(h))) {
    issues.push({ field: null, message: 'ملف التعديل يجب أن يحتوي على عمود واحد على الأقل من الحقول القابلة للتعديل.' });
  }
  return issues;
}

function categoryLabel(db: DatabaseSync, id: string): string {
  return (db.prepare('SELECT label_ar FROM product_categories WHERE id = ?').get(id) as { label_ar: string } | undefined)?.label_ar ?? id;
}

/**
 * Validates every record against the CURRENT database state (call inside a read or write
 * transaction). Never writes. Returns per-record reports and, when there are no errors, the
 * typed intents the commit applies.
 */
export function evaluateImport(db: DatabaseSync, mode: ImportMode, header: string[], records: CsvRecord[]): Evaluation {
  const fileErrors = headerCheck(mode, header);
  const rows: RowReport[] = [];
  const intents: Intent[] = [];
  if (fileErrors.length) return { mode, fileErrors, rows, intents, stateDigest: '' };
  const index = new Map(header.map((h, i) => [h, i]));
  const seenProducts = new Map<string, number>();
  const seenBarcodes = new Map<string, number>();
  const versions: Array<[string, number]> = [];

  for (const rec of records) {
    const errors: RowIssue[] = [];
    const warnings: string[] = [];
    const report: RowReport = { recordNo: rec.recordNo, line: rec.line, status: 'ok', productId: null, productName: null, errors, warnings, change: null };
    rows.push(report);
    if (rec.cells.length !== header.length) {
      errors.push({ field: null, message: `عدد الخلايا (${rec.cells.length}) لا يساوي عدد العناوين (${header.length}).` });
      report.status = 'error';
      continue;
    }
    if (rec.cells.every((c) => c === '')) {
      errors.push({ field: null, message: 'صف فارغ (كل الخلايا فارغة). احذفه من الملف.' });
      report.status = 'error';
      continue;
    }
    const has = (col: string) => index.has(col);
    const cell = (col: string) => (index.has(col) ? rec.cells[index.get(col)!]! : '');
    const take = <T>(col: string, r: Cell<T>): T | undefined => {
      if (r.ok) return r.value;
      errors.push({ field: col, message: r.message.startsWith(FIELD_LABEL[col] ?? '\u0000') ? r.message : `${FIELD_LABEL[col] ?? col}: ${r.message}` });
      return undefined;
    };
    const barcodeInFile = (barcode: string | null | undefined) => {
      if (!barcode) return;
      const first = seenBarcodes.get(barcode);
      if (first !== undefined) errors.push({ field: 'barcode', message: `الباركود «${barcode}» مكرر في الملف (السجل ${first} أيضًا).` });
      else seenBarcodes.set(barcode, rec.recordNo);
    };

    if (mode === 'create_products') {
      const name = take('name', viaSchema(nameField, cell('name')));
      const brand = take('brand', viaSchema(brandField, cell('brand')));
      const category = take('category', viaSchema(categoryField, cell('category')));
      if (category !== undefined && !isCategoryActive(db, category)) errors.push({ field: 'category', message: `القسم «${category}» غير معروف أو غير مفعّل. استخدم معرّف القسم كما هو في القائمة.` });
      const price = take('cartonPriceEgp', moneyEgp(cell('cartonPriceEgp'), 1, LIMITS.maxCartonPriceCents, FIELD_LABEL.cartonPriceEgp!));
      const pack = take('packSize', wholeNumber(cell('packSize'), 1, 10_000, FIELD_LABEL.packSize!));
      const minimum = take('minimumCartons', wholeNumber(cell('minimumCartons'), 1, LIMITS.maxCartonsPerLine, FIELD_LABEL.minimumCartons!));
      const rawBarcode = cell('barcode');
      const barcode = rawBarcode === '' ? null : take('barcode', viaSchema(barcodeField, rawBarcode));
      const rawImage = cell('imageUrl');
      const imageUrl = rawImage === '' ? null : take('imageUrl', viaSchema(imageField, rawImage));
      if (barcode) {
        barcodeInFile(barcode);
        if (barcodeOwner(db, barcode)) errors.push({ field: 'barcode', message: `الباركود «${barcode}» مستخدم بالفعل لمنتج موجود.` });
      }
      report.productName = name ?? null;
      if (errors.length === 0) {
        const product: NewProduct = { name: name!, brand: brand!, category: category!, barcode: barcode ?? null, imageUrl: imageUrl ?? null, cartonPriceCents: price!, packSize: pack!, minimumCartons: minimum!, isDemo: false };
        intents.push({ kind: 'create', product });
        report.change = {
          product: { ...product, category: { id: product.category, labelAr: categoryLabel(db, product.category) } },
          active: false,
          onHand: 0,
        };
        warnings.push('سيُنشأ المنتج غير مفعّل وبرصيد صفر.');
      }
    } else {
      // Target product: stable id only (never matched by name).
      const productId = cell('productId');
      let product: ProductRow | null = null;
      if (!UUID.test(productId)) errors.push({ field: 'productId', message: 'معرّف المنتج غير صالح (UUID كما يظهر في صفحة المنتج).' });
      else {
        const first = seenProducts.get(productId);
        if (first !== undefined) errors.push({ field: 'productId', message: `المنتج نفسه مذكور أكثر من مرة في الملف (السجل ${first} أيضًا).` });
        else seenProducts.set(productId, rec.recordNo);
        try {
          product = loadProductDb(db, productId);
        } catch {
          errors.push({ field: 'productId', message: 'لا يوجد منتج بهذا المعرّف.' });
        }
      }
      report.productId = product?.id ?? (UUID.test(productId) ? productId : null);
      report.productName = product?.name ?? null;
      const expected = take('expectedVersion', wholeNumber(cell('expectedVersion'), 1, 2_147_483_647, FIELD_LABEL.expectedVersion!));
      if (product && expected !== undefined) {
        versions.push([product.id, product.version]);
        if (expected !== product.version) {
          errors.push({ field: 'expectedVersion', message: `الإصدار في الملف (${expected}) لا يطابق الإصدار الحالي (${product.version}): تغيّر المنتج بعد إعداد الملف. راجع بياناته الحالية ثم حدّث الصف.` });
        }
      }
      const refName = cell('currentName');
      if (product && refName !== '' && refName.normalize('NFC').trim() !== product.name) {
        warnings.push(`الاسم المكتوب للمراجعة «${refName.slice(0, 80)}» يختلف عن الاسم الحالي «${product.name}». تأكد من المعرّف؛ الاسم لا يُستخدم لتحديد المنتج.`);
      }

      if (mode === 'update_products') {
        const changes: ProductChanges = {};
        const optionalText = <T>(col: string, schema: z.ZodType<T>, clearable: boolean): T | null | undefined => {
          if (!has(col)) return undefined;
          const raw = cell(col);
          if (raw === '') return undefined; // unchanged
          if (raw === CLEAR_TOKEN) {
            if (clearable) return null;
            errors.push({ field: col, message: `${FIELD_LABEL[col]}: حقل إلزامي لا يمكن مسحه.` });
            return undefined;
          }
          return take(col, viaSchema(schema, raw));
        };
        const set = <K extends UpdatableField>(k: K, v: ProductChanges[K] | undefined) => {
          if (v !== undefined) (changes as Record<string, unknown>)[k] = v;
        };
        set('name', optionalText('name', nameField, false) ?? undefined);
        set('brand', optionalText('brand', brandField, false) ?? undefined);
        const category = optionalText('category', categoryField, false) ?? undefined;
        if (category !== undefined && !isCategoryActive(db, category)) errors.push({ field: 'category', message: `القسم «${category}» غير معروف أو غير مفعّل.` });
        set('category', category);
        set('barcode', optionalText('barcode', barcodeField, true));
        set('imageUrl', optionalText('imageUrl', imageField, true));
        const numeric = (col: string, parse: (raw: string) => Cell<number>, key: UpdatableField) => {
          if (!has(col)) return;
          const raw = cell(col);
          if (raw === '') return;
          if (raw === CLEAR_TOKEN) {
            errors.push({ field: col, message: `${FIELD_LABEL[col]}: حقل إلزامي لا يمكن مسحه.` });
            return;
          }
          set(key, take(col, parse(raw)));
        };
        numeric('cartonPriceEgp', (r) => moneyEgp(r, 1, LIMITS.maxCartonPriceCents, FIELD_LABEL.cartonPriceEgp!), 'cartonPriceCents');
        numeric('packSize', (r) => wholeNumber(r, 1, 10_000, FIELD_LABEL.packSize!), 'packSize');
        numeric('minimumCartons', (r) => wholeNumber(r, 1, LIMITS.maxCartonsPerLine, FIELD_LABEL.minimumCartons!), 'minimumCartons');
        if (product) {
          const changed = changedFields(product, changes);
          if (changes.barcode) {
            barcodeInFile(changes.barcode);
            const owner = barcodeOwner(db, changes.barcode);
            if (owner && owner !== product.id) errors.push({ field: 'barcode', message: `الباركود «${changes.barcode}» مستخدم لمنتج آخر.` });
          }
          if (changed.includes('packSize') && (product.on_hand !== 0 || product.reserved !== 0)) {
            errors.push({ field: 'packSize', message: ERROR_CATALOG.PACKAGING_LOCKED.messageAr });
          }
          if (errors.length === 0 && changed.length === 0) errors.push({ field: null, message: 'الصف لا يغيّر أي حقل (كل القيم مطابقة أو فارغة).' });
          if (errors.length === 0) {
            const before: Record<string, unknown> = {
              name: product.name, brand: product.brand, category: product.category, barcode: product.barcode, imageUrl: product.image_url,
              cartonPriceCents: product.price_cents, packSize: product.pack_size, minimumCartons: product.minimum_cartons,
            };
            intents.push({ kind: 'update', product, expectedVersion: expected!, changes });
            report.change = { version: product.version, changes: changed.map((f) => ({ field: f, from: before[f] ?? null, to: changes[f] ?? null })) };
            if (changed.includes('cartonPriceCents')) warnings.push('تغيير السعر يسري على الطلبات الجديدة فقط؛ الطلبات السابقة تحتفظ بأسعارها.');
          }
        }
      } else {
        const isReceipt = mode === 'receive_stock';
        const amountCol = isReceipt ? 'quantity' : 'total';
        const amount = take(amountCol, wholeNumber(cell(amountCol), isReceipt ? 1 : 0, MAX_ON_HAND, FIELD_LABEL[amountCol]!));
        const reason = take('reason', viaSchema(reasonField, cell('reason')));
        const rawRef = cell('reference');
        const reference = rawRef.trim() === '' ? null : take('reference', viaSchema(referenceField, rawRef));
        if (product && amount !== undefined) {
          const plan = planStockAdjustment(product, isReceipt ? 'receipt' : 'set_total', amount);
          if (plan.refusal) errors.push({ field: amountCol, message: ERROR_CATALOG[plan.refusal].messageAr + ` (الحالي ${product.on_hand}، المحجوز ${product.reserved})` });
          else if (errors.length === 0) {
            intents.push({ kind: 'stock', product, expectedVersion: expected!, amount, reason: reason!, reference: reference ?? null });
            report.change = { version: product.version, onHandBefore: product.on_hand, delta: plan.delta, onHandAfter: plan.onHandAfter, reserved: plan.reserved, availableAfter: plan.availableAfter };
            if (!isReceipt) warnings.push(`القيمة تستبدل الرصيد الفعلي الإجمالي (${product.on_hand} ← ${plan.onHandAfter}). المحجوز (${product.reserved}) لا يتغير.`);
            if (product.active !== 1) warnings.push('المنتج غير مفعّل حاليًا؛ الرصيد لا يظهر للتجار حتى التفعيل.');
          }
        }
      }
    }
    if (errors.length) report.status = 'error';
  }

  if (mode === 'create_products') {
    const current = productCount(db);
    if (current + records.length > LIMITS.maxProducts) {
      fileErrors.push({ field: null, message: `الكتالوج يحتوي على ${current} منتجًا؛ إضافة ${records.length} تتجاوز الحد الأقصى (${LIMITS.maxProducts}).` });
    }
  }
  versions.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { mode, fileErrors, rows, intents, stateDigest: sha256(JSON.stringify(['import.state.v1', mode, versions])) };
}

const hasErrors = (e: Evaluation) => e.fileErrors.length > 0 || e.rows.some((r) => r.status === 'error');

// ------------------------------------------------------------------ preview binding

interface Binding {
  v: 1;
  u: string;
  m: ImportMode;
  c: string;
  s: string;
  e: number;
}

export function signPreview(key: Buffer, b: Binding): string {
  const body = Buffer.from(JSON.stringify(b), 'utf8').toString('base64url');
  return `${body}.${hmacBase64Url(key, `import.preview.v1\0${body}`)}`;
}

/** Signature, administrator, mode and content must match; returns the binding or throws. */
export function verifyPreview(key: Buffer, token: string, expected: { userId: string; mode: ImportMode; contentSha256: string }, now: number): Binding {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) throw new AppError('IMPORT_PREVIEW_INVALID');
  const good = Buffer.from(hmacBase64Url(key, `import.preview.v1\0${body}`));
  const given = Buffer.from(sig);
  if (good.length !== given.length || !timingSafeEqual(good, given)) throw new AppError('IMPORT_PREVIEW_INVALID');
  let b: Binding;
  try {
    b = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Binding;
  } catch {
    throw new AppError('IMPORT_PREVIEW_INVALID');
  }
  if (b.v !== 1 || b.u !== expected.userId || b.m !== expected.mode || b.c !== expected.contentSha256 || typeof b.s !== 'string' || !Number.isSafeInteger(b.e)) {
    throw new AppError('IMPORT_PREVIEW_INVALID');
  }
  if (now >= b.e) throw new AppError('IMPORT_PREVIEW_EXPIRED');
  return b;
}

// ------------------------------------------------------------------ results

interface ImportRow {
  id: string;
  actor_user_id: string;
  operation_key: string;
  request_digest: string;
  mode: ImportMode;
  content_sha256: string;
  file_bytes: number;
  record_count: number;
  created_at: number;
}

function importResult(db: DatabaseSync, op: ImportRow) {
  const items = db
    .prepare(
      `SELECT i.record_no, i.line_no, i.product_id, p.name, i.ledger_id, i.product_version_after
         FROM import_operation_items i JOIN products p ON p.id = i.product_id
        WHERE i.import_id = ? ORDER BY i.record_no`,
    )
    .all(op.id) as Array<{ record_no: number; line_no: number; product_id: string; name: string; ledger_id: number | null; product_version_after: number }>;
  return {
    id: op.id,
    mode: op.mode,
    status: 'committed' as const,
    recordCount: op.record_count,
    fileBytes: op.file_bytes,
    contentSha256: op.content_sha256,
    createdAt: op.created_at,
    items: items.map((i) => ({ recordNo: i.record_no, line: i.line_no, productId: i.product_id, productName: i.name, ledgerId: i.ledger_id, productVersionAfter: i.product_version_after })),
  };
}

function rejection(e: Evaluation): AppError {
  return new AppError('IMPORT_REJECTED', {
    current: { fileErrors: e.fileErrors, rows: e.rows.filter((r) => r.status === 'error').slice(0, LIMITS.importMaxRows) },
  });
}

function summary(e: Evaluation) {
  const invalid = e.rows.filter((r) => r.status === 'error').length;
  return { records: e.rows.length, valid: e.rows.length - invalid, invalid };
}

// ------------------------------------------------------------------ GET templates

const TEMPLATE_PARAM = /^(create_products|update_products|receive_stock|set_stock_total)\.csv$/;

/** Header-only UTF-8 (BOM) template with CRLF. No example rows (they would be imported by mistake). */
export function templateCsv(mode: ImportMode): string {
  const spec = IMPORT_COLUMNS[mode];
  return `﻿${[...spec.required, ...spec.optional].join(',')}\r\n`;
}

export function getImportTemplate(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireAdmin(auth);
  parseQuery(ctx.query, z.strictObject({}));
  const m = TEMPLATE_PARAM.exec(ctx.params.file ?? '');
  if (!m) throw new AppError('NOT_FOUND');
  const body = Buffer.from(templateCsv(m[1] as ImportMode), 'utf8');
  ctx.res.statusCode = 200;
  ctx.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  ctx.res.setHeader('Content-Disposition', `attachment; filename="alkhayr-import-${m[1]}.csv"`);
  ctx.res.setHeader('Cache-Control', 'no-store');
  ctx.res.setHeader('Content-Length', String(body.length));
  ctx.res.end(ctx.req.method === 'HEAD' ? undefined : body);
}

// ------------------------------------------------------------------ POST preview

export async function previewImport(ctx: RequestContext): Promise<void> {
  const auth = requireSession(ctx);
  requireSessionCsrf(ctx, auth);
  requireAdmin(auth);
  const limit = ctx.services.rateLimiter.consume('import_preview_account', auth.identity.userId);
  if (!limit.allowed) throw new AppError('RATE_LIMITED', { headers: { 'Retry-After': String(limit.retryAfterSeconds) } });
  await withJobSlot(async () => {
    const body = await readImportBody(ctx, previewSchema);
    const bytes = decodeFile(body.file);
    const contentSha256 = sha256(bytes);
    const file = { bytes: bytes.length, sha256: contentSha256 };
    const parsed = parseCsv(bytes);
    if (!parsed.ok) {
      sendJson(ctx.res, 200, {
        mode: body.mode,
        file,
        summary: { records: 0, valid: 0, invalid: 0 },
        fileErrors: [{ field: null, message: parsed.line ? `السطر ${parsed.line}: ${parsed.message}` : parsed.message }],
        rows: [],
        previewToken: null,
        expiresAt: null,
      });
      return;
    }
    const { db, now } = ctx.services;
    // Reads only; the current identity must still be an administrator at evaluation time.
    const evaluation = readTransaction(db, () => {
      revalidateAtCommit(ctx, auth, { admin: 'any' });
      return evaluateImport(db, body.mode, parsed.table.header, parsed.table.records);
    });
    const ok = !hasErrors(evaluation);
    const expiresAt = now() + PREVIEW_TTL_MS;
    sendJson(ctx.res, 200, {
      mode: body.mode,
      file,
      summary: summary(evaluation),
      fileErrors: evaluation.fileErrors,
      rows: evaluation.rows,
      previewToken: ok ? signPreview(ctx.services.keys.importPreview, { v: 1, u: auth.identity.userId, m: body.mode, c: contentSha256, s: evaluation.stateDigest, e: expiresAt }) : null,
      expiresAt: ok ? expiresAt : null,
    });
  });
}

// ------------------------------------------------------------------ POST commit

export async function commitImport(ctx: RequestContext): Promise<void> {
  const auth = requireSession(ctx);
  requireSessionCsrf(ctx, auth);
  requireRecentAdminAuth(ctx, auth);
  const limit = ctx.services.rateLimiter.consume('import_commit_account', auth.identity.userId);
  if (!limit.allowed) throw new AppError('RATE_LIMITED', { headers: { 'Retry-After': String(limit.retryAfterSeconds) } });
  await withJobSlot(async () => {
    const body = await readImportBody(ctx, commitSchema);
    const bytes = decodeFile(body.file);
    const contentSha256 = sha256(bytes);
    const digest = requestDigest(body.mode, contentSha256);
    // Parsing happens BEFORE the write transaction (no lock held while parsing).
    const parsed = parseCsv(bytes);
    const { db, now } = ctx.services;

    const outcome = writeTransaction(db, () => {
      // 1. Current session, administrator role and recent authentication — also for replays.
      const actor = revalidateAtCommit(ctx, auth, { admin: 'recent' });

      // 2. Durable idempotency FIRST: a committed identical batch is returned even after the
      //    preview expired or the versions moved on; a different request under the key is refused.
      const previous = db.prepare('SELECT * FROM import_operations WHERE actor_user_id = ? AND operation_key = ?').get(actor.userId, body.operationKey) as unknown as ImportRow | undefined;
      if (previous) {
        if (previous.request_digest !== digest) throw new AppError('IDEMPOTENCY_KEY_REUSED');
        return { replayed: true, op: previous };
      }
      // 2b. A NEW batch: writes open and prepared under the current recovery epoch (stage 16).
      assertNewWrite(ctx);

      // 3. The preview binding (signature, administrator, mode, exact content, expiry).
      if (!parsed.ok) throw new AppError('IMPORT_REJECTED', { current: { fileErrors: [{ field: null, message: parsed.message }], rows: [] } });
      const binding = verifyPreview(ctx.services.keys.importPreview, body.previewToken, { userId: actor.userId, mode: body.mode, contentSha256 }, now());

      // 4. Every rule again, against the state inside this transaction. All-or-nothing.
      const evaluation = evaluateImport(db, body.mode, parsed.table.header, parsed.table.records);
      if (hasErrors(evaluation)) throw rejection(evaluation);
      if (evaluation.stateDigest !== binding.s) {
        throw new AppError('IMPORT_PREVIEW_STALE', { current: { fileErrors: [], rows: evaluation.rows } });
      }
      if (body.mode === 'create_products') assertCatalogCapacity(db, evaluation.intents.length);
      // Stock modes: every touched product's ledger must be consistent (stage-16 write guard).
      const stockProducts = evaluation.intents.flatMap((i) => (i.kind === 'stock' ? [i.product.id] : []));
      if (stockProducts.length) assertNewWrite(ctx, { productIds: stockProducts });

      if (evaluation.intents.length !== parsed.table.records.length) throw new Error('import evaluation/intent mismatch');
      // 5. Apply with the same cores as the single-record endpoints. Any throw rolls back everything.
      const t = now();
      const meta: WriteMeta = { actorUserId: actor.userId, ipHmac: hmacHex(ctx.services.keys.ip, ctx.clientIp), requestId: ctx.requestId, now: t };
      const importId = randomUUID();
      db.prepare(
        `INSERT INTO import_operations (id, actor_user_id, operation_key, request_digest, mode, content_sha256, file_bytes, record_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(importId, actor.userId, body.operationKey, digest, body.mode, contentSha256, bytes.length, parsed.table.records.length, t);
      const addItem = db.prepare('INSERT INTO import_operation_items (import_id, record_no, line_no, product_id, ledger_id, product_version_after) VALUES (?, ?, ?, ?, ?, ?)');
      evaluation.intents.forEach((intent, k) => {
        const rec = parsed.table.records[k]!;
        try {
          if (intent.kind === 'create') {
            const id = insertProductRecord(db, intent.product, meta);
            addItem.run(importId, rec.recordNo, rec.line, id, null, 1);
          } else if (intent.kind === 'update') {
            const after = applyProductUpdate(db, loadProductDb(db, intent.product.id), intent.expectedVersion, intent.changes, meta);
            addItem.run(importId, rec.recordNo, rec.line, after.id, null, after.version);
          } else {
            const r = applyStockAdjustment(
              db,
              loadProductDb(db, intent.product.id),
              { type: body.mode === 'receive_stock' ? 'receipt' : 'set_total', amount: intent.amount, expectedVersion: intent.expectedVersion, reason: intent.reason, reference: intent.reference, operationKey: null, digest: null },
              meta,
            );
            addItem.run(importId, rec.recordNo, rec.line, intent.product.id, r.ledgerId, r.versionAfter);
          }
        } catch (err) {
          if (err instanceof AppError) {
            throw new AppError('IMPORT_REJECTED', {
              current: { fileErrors: [], rows: [{ recordNo: rec.recordNo, line: rec.line, status: 'error', productId: null, productName: null, errors: [{ field: err.fields?.[0]?.path ?? null, message: err.fields?.[0]?.message ?? ERROR_CATALOG[err.code].messageAr }], warnings: [], change: null }] },
            });
          }
          throw err;
        }
      });
      writeAudit(db, {
        actorUserId: actor.userId,
        action: 'import.committed',
        targetType: 'import',
        targetId: importId,
        metadata: { import_id: importId, mode: body.mode, records: parsed.table.records.length, file_bytes: bytes.length },
        ipHmac: meta.ipHmac,
        requestId: ctx.requestId,
        now: t,
      });
      return { replayed: false, op: db.prepare('SELECT * FROM import_operations WHERE id = ?').get(importId) as unknown as ImportRow };
    });

    sendJson(ctx.res, outcome.replayed ? 200 : 201, { replayed: outcome.replayed, import: importResult(db, outcome.op) });
  });
}

// ------------------------------------------------------------------ GET committed imports (stage 14)

const listQuery = z.strictObject({
  mode: modeField.optional(),
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional(),
  cursor: z.string().max(2048).optional(),
});

/**
 * Read-only history of COMMITTED import batches for reconciliation (newest first, signed keyset
 * cursor). No file content, preview tokens, operation keys or digests are returned. There is no
 * "run again": a new key is a new operation.
 */
export function listImports(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireAdmin(auth);
  const q = parseQuery(ctx.query, listQuery);
  const limit = q.limit ?? 25;
  const scope = `admin.imports\0${q.mode ?? ''}`;
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (q.mode) {
    where.push('o.mode = ?');
    params.push(q.mode);
  }
  if (q.cursor) {
    const p = decodeCursor(ctx.services.keys.cursor, scope, auth.identity.userId, q.cursor);
    if (p.length !== 2 || typeof p[0] !== 'number' || typeof p[1] !== 'string' || !UUID.test(p[1])) {
      throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'cursor', message: 'مؤشر الصفحة غير صالح.' }] });
    }
    where.push('(o.created_at, o.id) < (?, ?)');
    params.push(p[0], p[1]);
  }
  const rows = ctx.services.db
    .prepare(
      `SELECT o.id, o.mode, o.record_count, o.file_bytes, o.created_at, u.username FROM import_operations o JOIN auth_users u ON u.id = o.actor_user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.created_at DESC, o.id DESC LIMIT ?`,
    )
    .all(...params, limit + 1) as Array<{ id: string; mode: ImportMode; record_count: number; file_bytes: number; created_at: number; username: string }>;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  sendJson(ctx.res, 200, {
    items: page.map((r) => ({ id: r.id, mode: r.mode, recordCount: r.record_count, fileBytes: r.file_bytes, createdAt: r.created_at, actor: r.username })),
    nextCursor: rows.length > limit && last ? encodeCursor(ctx.services.keys.cursor, scope, auth.identity.userId, [last.created_at, last.id]) : null,
  });
}

export function getImport(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireAdmin(auth);
  parseQuery(ctx.query, z.strictObject({}));
  const id = ctx.params.id;
  if (!id || !UUID.test(id)) throw new AppError('NOT_FOUND');
  const op = ctx.services.db.prepare('SELECT * FROM import_operations WHERE id = ?').get(id) as unknown as ImportRow | undefined;
  if (!op) throw new AppError('NOT_FOUND');
  const actor = (ctx.services.db.prepare('SELECT username FROM auth_users WHERE id = ?').get(op.actor_user_id) as { username: string }).username;
  const r = importResult(ctx.services.db, op);
  sendJson(ctx.res, 200, { import: { id: r.id, mode: r.mode, recordCount: r.recordCount, fileBytes: r.fileBytes, createdAt: r.createdAt, actor, items: r.items } });
}
