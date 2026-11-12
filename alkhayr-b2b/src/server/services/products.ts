import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAdmin, requireApproved, requireRecentAdminAuth, requireSession, requireSessionCsrf, revalidateAtCommit } from '../auth/authorization.ts';
import { hmacHex } from '../auth/keys.ts';
import { isSqliteError, SQLITE } from '../database/errors.ts';
import { writeTransaction } from '../database/transaction.ts';
import { decodeCursor, encodeCursor } from '../http/cursor.ts';
import { AppError } from '../http/errors.ts';
import { parseQuery } from '../http/query.ts';
import { readJsonBody } from '../http/request-body.ts';
import { sendJson } from '../http/response.ts';
import type { RequestContext } from '../http/router.ts';
import { likePattern } from '../http/search.ts';
import { LIMITS } from '../../shared/constants.ts';
import { STOCK_STATUS_LABEL_AR, stockStatus } from '../../shared/stock-status.ts';
import { writeAudit } from './audit.ts';

/**
 * Product administration and the approved-trader catalog (stage 06).
 * Inventory quantities are NOT writable here: new products start with
 * on_hand = reserved = 0 and inactive; stock changes belong to the stage-07
 * inventory service (with ledger rows). Categories come only from the
 * product_categories table.
 */

const BODY_LIMIT = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ARABIC = /[؀-ۿ]/;

interface ProductRow {
  id: string;
  name: string;
  brand: string;
  category: string;
  category_label_ar: string;
  barcode: string | null;
  image_url: string | null;
  price_cents: number;
  on_hand: number;
  reserved: number;
  pack_size: number;
  minimum_cartons: number;
  active: number;
  is_demo: number;
  version: number;
  created_at: number;
  updated_at: number;
}

const SELECT_PRODUCT = `SELECT p.id, p.name, p.brand, p.category, c.label_ar AS category_label_ar, p.barcode, p.image_url, p.price_cents,
                               p.on_hand, p.reserved, p.pack_size, p.minimum_cartons, p.active, p.is_demo, p.version, p.created_at, p.updated_at
                          FROM products p JOIN product_categories c ON c.id = p.category`;

/** Full administrative record. `available` is computed from authoritative columns, never stored. */
function adminProduct(p: ProductRow) {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: { id: p.category, labelAr: p.category_label_ar },
    barcode: p.barcode,
    imageUrl: p.image_url,
    cartonPriceCents: p.price_cents,
    packSize: p.pack_size,
    minimumCartons: p.minimum_cartons,
    active: p.active === 1,
    isDemo: p.is_demo === 1,
    stock: { onHand: p.on_hand, reserved: p.reserved, available: p.on_hand - p.reserved },
    version: p.version,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

/** Trader view: no physical/reserved quantities, no version or audit data, only an availability status. */
function catalogProduct(p: ProductRow, threshold: number) {
  const status = stockStatus(p.on_hand - p.reserved, threshold);
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: { id: p.category, labelAr: p.category_label_ar },
    barcode: p.barcode,
    imageUrl: p.image_url,
    cartonPriceCents: p.price_cents,
    packSize: p.pack_size,
    minimumCartons: p.minimum_cartons,
    availability: { status, labelAr: STOCK_STATUS_LABEL_AR[status] },
    isDemo: p.is_demo === 1,
  };
}

function validationError(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): AppError {
  return new AppError('VALIDATION_FAILED', {
    fields: issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.') || '(body)', message: ARABIC.test(i.message) ? i.message : 'قيمة غير صالحة أو حقل غير مسموح به.' })),
  });
}

async function parseBody<T>(ctx: RequestContext, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await readJsonBody(ctx.req, BODY_LIMIT));
  if (!parsed.success) throw validationError(parsed.error.issues);
  return parsed.data;
}

// ------------------------------------------------------------------ field schemas (types checked BEFORE SQLite)

const text = (min: number, max: number, message: string) =>
  z.string({ error: message }).max(max * 4).transform((s) => s.normalize('NFC').trim()).pipe(z.string().min(min, message).max(max, message));

/** Integers only: z.number().int() rejects strings, booleans, NaN, ±Infinity, fractions and unsafe integers. */
const int = (min: number, max: number, message: string) => z.number({ error: message }).int(message).min(min, message).max(max, message);

const nameField = text(2, 160, 'اسم المنتج من 2 إلى 160 حرفًا.');
const brandField = text(1, 80, 'اسم البراند من 1 إلى 80 حرفًا.');
const categoryField = z.string({ error: 'القسم مطلوب.' }).regex(/^[a-z][a-z0-9_]{1,39}$/, 'القسم غير معروف.');
/** No barcode = null. "" is invalid. Exact text: case and leading zeros are kept; no trimming. */
const barcodeField = z.union([z.null(), z.string().regex(/^[0-9A-Za-z-]{1,32}$/, 'الباركود من 1 إلى 32 حرفًا (أرقام أو حروف لاتينية أو -)، أو null بدون باركود.')]);
const priceField = int(1, LIMITS.maxCartonPriceCents, `سعر الكرتونة بالقروش عدد صحيح من 1 إلى ${LIMITS.maxCartonPriceCents}.`);
const packField = int(1, 10_000, 'عدد القطع في الكرتونة عدد صحيح من 1 إلى 10000.');
const minimumField = int(1, LIMITS.maxCartonsPerLine, `الحد الأدنى عدد صحيح من 1 إلى ${LIMITS.maxCartonsPerLine} كرتونة.`);

/**
 * Image: absolute https URL without credentials, stored in canonical form.
 * The server never fetches it (no proxy, no download); browsers load it with no-referrer.
 */
export function canonicalImageUrl(raw: string): string | null {
  if (raw.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(raw)) return null;
  // Any userinfo delimiter in the authority is refused, even "https://@host" (empty credentials),
  // instead of letting the URL parser silently rewrite it.
  if (!/^https:\/\//i.test(raw) || /@/.test(raw.slice(8).split(/[/?#]/)[0] ?? '')) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || url.hostname.length > 253) return null;
  const href = url.href;
  return href.length <= 2048 && href.startsWith('https://') ? href : null;
}

const imageField = z.union([
  z.null(),
  z
    .string()
    .max(2048, 'رابط الصورة أطول من المسموح.')
    .transform((s, ctx) => {
      const href = canonicalImageUrl(s);
      if (!href) {
        ctx.addIssue({ code: 'custom', message: 'رابط الصورة يجب أن يبدأ بـ https:// وبدون اسم مستخدم أو كلمة مرور.' });
        return z.NEVER;
      }
      return href;
    }),
]);

const expectedVersion = z.number({ error: 'رقم الإصدار المتوقع مطلوب.' }).int().min(1).max(2_147_483_647);

/** Create: no id, stock, reservation, version, timestamps or active flag (always created inactive). */
const createSchema = z.strictObject({
  name: nameField,
  brand: brandField,
  category: categoryField,
  barcode: barcodeField.optional(),
  imageUrl: imageField.optional(),
  cartonPriceCents: priceField,
  packSize: packField,
  minimumCartons: minimumField,
  /** Demo merchandise only outside production; fixed at creation (never converted later). */
  isDemo: z.boolean().optional(),
});

/** Update: metadata, price and activation only. Stock/reservation/demo/id fields are rejected. */
const updateSchema = z
  .strictObject({
    expectedVersion,
    name: nameField.optional(),
    brand: brandField.optional(),
    category: categoryField.optional(),
    barcode: barcodeField.optional(),
    imageUrl: imageField.optional(),
    cartonPriceCents: priceField.optional(),
    packSize: packField.optional(),
    minimumCartons: minimumField.optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).some((k) => k !== 'expectedVersion'), { message: 'لا توجد حقول للتعديل.' });

/** Fixed API field → column map; column names never come from the request. */
const UPDATE_COLUMNS = {
  name: 'name',
  brand: 'brand',
  category: 'category',
  barcode: 'barcode',
  imageUrl: 'image_url',
  cartonPriceCents: 'price_cents',
  packSize: 'pack_size',
  minimumCartons: 'minimum_cartons',
  active: 'active',
} as const;
type UpdatableField = keyof typeof UPDATE_COLUMNS;

// ------------------------------------------------------------------ shared helpers

function assertCategory(ctx: RequestContext, id: string): void {
  const row = ctx.services.db.prepare('SELECT active FROM product_categories WHERE id = ?').get(id) as { active: number } | undefined;
  if (!row || row.active !== 1) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'category', message: 'القسم غير معروف أو غير مفعّل.' }] });
}

function assertBarcodeFree(ctx: RequestContext, barcode: string | null | undefined, exceptId?: string): void {
  if (barcode === null || barcode === undefined) return;
  const row = ctx.services.db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode) as { id: string } | undefined;
  if (row && row.id !== exceptId) throw new AppError('DUPLICATE', { fields: [{ path: 'barcode', message: 'هذا الباركود مستخدم لمنتج آخر.' }] });
}

/** Database UNIQUE violation on the barcode index (defence in depth for the pre-check). */
function mapBarcodeConflict(err: unknown): never {
  if (isSqliteError(err) && err.errcode === SQLITE.CONSTRAINT_UNIQUE && /products\.barcode/.test(err.message)) {
    throw new AppError('DUPLICATE', { fields: [{ path: 'barcode', message: 'هذا الباركود مستخدم لمنتج آخر.' }] });
  }
  throw err;
}

function loadProduct(ctx: RequestContext, id: string | undefined, where = ''): ProductRow {
  if (!id || !UUID.test(id)) throw new AppError('NOT_FOUND');
  const row = ctx.services.db.prepare(`${SELECT_PRODUCT} WHERE p.id = ?${where}`).get(id) as unknown as ProductRow | undefined;
  if (!row) throw new AppError('NOT_FOUND');
  return row;
}

function lowStockThreshold(ctx: RequestContext): number {
  return (ctx.services.db.prepare('SELECT low_stock_threshold_cartons AS t FROM business_settings WHERE id = 1').get() as { t: number }).t;
}

// ------------------------------------------------------------------ list queries (admin and catalog)

const SORTS = {
  name: { order: 'p.name COLLATE NOCASE ASC, p.id ASC', after: '(p.name COLLATE NOCASE, p.id) > (?, ?)', key: (p: ProductRow) => [p.name, p.id] },
  newest: { order: 'p.created_at DESC, p.id DESC', after: '(p.created_at, p.id) < (?, ?)', key: (p: ProductRow) => [p.created_at, p.id] },
  oldest: { order: 'p.created_at ASC, p.id ASC', after: '(p.created_at, p.id) > (?, ?)', key: (p: ProductRow) => [p.created_at, p.id] },
  price_asc: { order: 'p.price_cents ASC, p.id ASC', after: '(p.price_cents, p.id) > (?, ?)', key: (p: ProductRow) => [p.price_cents, p.id] },
  price_desc: { order: 'p.price_cents DESC, p.id DESC', after: '(p.price_cents, p.id) < (?, ?)', key: (p: ProductRow) => [p.price_cents, p.id] },
} as const;
type SortName = keyof typeof SORTS;

const searchText = z
  .string()
  .transform((s) => s.normalize('NFKC').trim())
  .pipe(z.string().min(1, 'نص البحث فارغ.').max(80, 'نص البحث أطول من 80 حرفًا.'));
const limitParam = z
  .string()
  .regex(/^\d{1,3}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(100));
const boolParam = z.enum(['true', 'false']);
const brandParam = z
  .string()
  .transform((s) => s.normalize('NFC').trim())
  .pipe(z.string().min(1).max(80));

const catalogQuerySchema = z.strictObject({
  q: searchText.optional(),
  category: categoryField.optional(),
  brand: brandParam.optional(),
  sort: z.enum(['name', 'newest', 'price_asc', 'price_desc']).optional(),
  limit: limitParam.optional(),
  cursor: z.string().max(2048).optional(),
});

const adminQuerySchema = catalogQuerySchema.extend({
  sort: z.enum(['name', 'newest', 'oldest', 'price_asc', 'price_desc']).optional(),
  active: boolParam.optional(),
  demo: boolParam.optional(),
});

interface ListOptions {
  scope: string;
  visibleOnly: boolean;
  query: z.infer<typeof adminQuerySchema>;
  defaultSort: SortName;
}

function queryProducts(ctx: RequestContext, userId: string, o: ListOptions): { rows: ProductRow[]; nextCursor: string | null } {
  const sortName: SortName = o.query.sort ?? o.defaultSort;
  const sort = SORTS[sortName];
  const limit = o.query.limit ?? 25;
  const scope = [o.scope, sortName, o.query.q ?? '', o.query.category ?? '', o.query.brand ?? '', o.query.active ?? '', o.query.demo ?? ''].join('\0');
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (o.visibleOnly) where.push('p.active = 1');
  if (o.query.active) {
    where.push('p.active = ?');
    params.push(o.query.active === 'true' ? 1 : 0);
  }
  if (o.query.demo) {
    where.push('p.is_demo = ?');
    params.push(o.query.demo === 'true' ? 1 : 0);
  }
  if (o.query.category) {
    assertCategory(ctx, o.query.category);
    where.push('p.category = ?');
    params.push(o.query.category);
  }
  if (o.query.brand) {
    where.push('p.brand = ?');
    params.push(o.query.brand);
  }
  if (o.query.q) {
    const pattern = likePattern(o.query.q);
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR p.barcode = ?)");
    params.push(pattern, pattern, o.query.q);
  }
  if (o.query.cursor) {
    const position = decodeCursor(ctx.services.keys.cursor, scope, userId, o.query.cursor);
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
  return { rows: page, nextCursor: rows.length > limit && last ? encodeCursor(ctx.services.keys.cursor, scope, userId, sort.key(last)) : null };
}

// ------------------------------------------------------------------ approved catalog

export function listCatalog(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireApproved(auth);
  const query = parseQuery(ctx.query, catalogQuerySchema);
  const { rows, nextCursor } = queryProducts(ctx, auth.identity.userId, { scope: 'catalog', visibleOnly: true, query, defaultSort: 'name' });
  const threshold = lowStockThreshold(ctx);
  sendJson(ctx.res, 200, { items: rows.map((r) => catalogProduct(r, threshold)), nextCursor });
}

export function getCatalogProduct(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireApproved(auth);
  parseQuery(ctx.query, z.strictObject({}));
  // Inactive and non-existent products are indistinguishable for traders (404).
  const row = loadProduct(ctx, ctx.params.id, ' AND p.active = 1');
  sendJson(ctx.res, 200, { product: catalogProduct(row, lowStockThreshold(ctx)) });
}

/** Filter choices derived only from what the caller may see: active categories, brands of active products. */
export function catalogFilters(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireApproved(auth);
  parseQuery(ctx.query, z.strictObject({}));
  const { db } = ctx.services;
  const categories = db
    .prepare(
      `SELECT c.id, c.label_ar, count(p.id) AS n FROM product_categories c
         LEFT JOIN products p ON p.category = c.id AND p.active = 1
        WHERE c.active = 1 GROUP BY c.id ORDER BY c.sort_order`,
    )
    .all() as Array<{ id: string; label_ar: string; n: number }>;
  const brands = db.prepare('SELECT brand, count(*) AS n FROM products WHERE active = 1 GROUP BY brand ORDER BY brand COLLATE NOCASE LIMIT 500').all() as Array<{ brand: string; n: number }>;
  sendJson(ctx.res, 200, {
    categories: categories.map((c) => ({ id: c.id, labelAr: c.label_ar, productCount: c.n })),
    brands: brands.map((b) => ({ name: b.brand, productCount: b.n })),
  });
}

// ------------------------------------------------------------------ administration

export function listAdminProducts(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireAdmin(auth);
  const query = parseQuery(ctx.query, adminQuerySchema);
  const { rows, nextCursor } = queryProducts(ctx, auth.identity.userId, { scope: 'admin.products', visibleOnly: false, query, defaultSort: 'newest' });
  sendJson(ctx.res, 200, { items: rows.map(adminProduct), nextCursor });
}

export function getAdminProduct(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireAdmin(auth);
  parseQuery(ctx.query, z.strictObject({}));
  sendJson(ctx.res, 200, { product: adminProduct(loadProduct(ctx, ctx.params.id)) });
}

export async function createProduct(ctx: RequestContext): Promise<void> {
  const auth = requireSession(ctx);
  requireSessionCsrf(ctx, auth);
  requireRecentAdminAuth(ctx, auth);
  const body = await parseBody(ctx, createSchema);
  if (body.isDemo && ctx.config.isProduction) {
    throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'isDemo', message: 'منتجات العرض التجريبي غير مسموحة في بيئة الإنتاج.' }] });
  }
  const { db, now } = ctx.services;
  const product = writeTransaction(db, () => {
    const actor = revalidateAtCommit(ctx, auth, { admin: 'recent' });
    // Counted inside the serialized (BEGIN IMMEDIATE) transaction: concurrent creates cannot exceed the cap.
    const total = (db.prepare('SELECT count(*) AS n FROM products').get() as { n: number }).n;
    if (total >= LIMITS.maxProducts) throw new AppError('CATALOG_LIMIT');
    assertCategory(ctx, body.category);
    assertBarcodeFree(ctx, body.barcode);
    const id = randomUUID();
    const t = now();
    try {
      db.prepare(
        `INSERT INTO products (id, name, brand, category, barcode, image_url, price_cents, on_hand, reserved, pack_size, minimum_cartons, active, is_demo, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 0, ?, 1, ?, ?)`,
      ).run(id, body.name, body.brand, body.category, body.barcode ?? null, body.imageUrl ?? null, body.cartonPriceCents, body.packSize, body.minimumCartons, body.isDemo ? 1 : 0, t, t);
    } catch (err) {
      mapBarcodeConflict(err);
    }
    writeAudit(db, {
      actorUserId: actor.userId,
      action: 'product.created',
      targetType: 'product',
      targetId: id,
      metadata: { version: 1, category: body.category, price_to: body.cartonPriceCents, active_to: false, is_demo: body.isDemo === true },
      ipHmac: hmacHex(ctx.services.keys.ip, ctx.clientIp),
      requestId: ctx.requestId,
      now: t,
    });
    return db.prepare(`${SELECT_PRODUCT} WHERE p.id = ?`).get(id) as unknown as ProductRow;
  });
  sendJson(ctx.res, 201, { product: adminProduct(product) });
}

export async function updateProduct(ctx: RequestContext): Promise<void> {
  const auth = requireSession(ctx);
  requireSessionCsrf(ctx, auth);
  requireRecentAdminAuth(ctx, auth);
  const id = ctx.params.id;
  if (!id || !UUID.test(id)) throw new AppError('NOT_FOUND');
  const body = await parseBody(ctx, updateSchema);
  const { db, now } = ctx.services;

  const product = writeTransaction(db, () => {
    const actor = revalidateAtCommit(ctx, auth, { admin: 'recent' });
    const current = loadProduct(ctx, id);
    if (current.version !== body.expectedVersion) throw new AppError('VERSION_CONFLICT', { current: { product: adminProduct(current) } });

    const before: Record<UpdatableField, unknown> = {
      name: current.name,
      brand: current.brand,
      category: current.category,
      barcode: current.barcode,
      imageUrl: current.image_url,
      cartonPriceCents: current.price_cents,
      packSize: current.pack_size,
      minimumCartons: current.minimum_cartons,
      active: current.active === 1,
    };
    const changed = (Object.keys(UPDATE_COLUMNS) as UpdatableField[]).filter((k) => body[k] !== undefined && body[k] !== before[k]);
    if (changed.length === 0) return current; // nothing differs: no version bump, no audit
    if (changed.includes('category')) assertCategory(ctx, body.category as string);
    if (changed.includes('barcode')) assertBarcodeFree(ctx, body.barcode, current.id);

    const t = Math.max(now(), current.updated_at);
    const values = changed.map((k) => (k === 'active' ? (body.active ? 1 : 0) : (body[k] as string | number | null)));
    try {
      const result = db
        .prepare(`UPDATE products SET ${changed.map((k) => `${UPDATE_COLUMNS[k]} = ?`).join(', ')}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`)
        // Bound to the CLIENT's expectedVersion: an independent second check besides the pre-check above.
        .run(...values, t, current.id, body.expectedVersion);
      if (result.changes !== 1) throw new AppError('VERSION_CONFLICT', { current: { product: adminProduct(current) } });
    } catch (err) {
      if (err instanceof AppError) throw err;
      mapBarcodeConflict(err);
    }
    const meta: Record<string, string | number | boolean> = { fields: changed.join(','), version: current.version + 1 };
    if (changed.includes('cartonPriceCents')) {
      meta.price_from = current.price_cents;
      meta.price_to = body.cartonPriceCents as number;
    }
    if (changed.includes('active')) {
      meta.active_from = current.active === 1;
      meta.active_to = body.active as boolean;
    }
    writeAudit(db, {
      actorUserId: actor.userId,
      action: 'product.updated',
      targetType: 'product',
      targetId: current.id,
      metadata: meta,
      ipHmac: hmacHex(ctx.services.keys.ip, ctx.clientIp),
      requestId: ctx.requestId,
      now: t,
    });
    return loadProduct(ctx, current.id);
  });
  sendJson(ctx.res, 200, { product: adminProduct(product) });
}
