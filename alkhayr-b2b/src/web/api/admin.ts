import { apiDownload, apiGet, apiMutate, type ApiResult, type SessionCsrfToken } from './client.ts';
import { isOrderState, isPage, type AdminOrder, type AdminOrderSummary, type MerchantStatus, type OrderState, type Page, type StockStatus } from './contracts.ts';

/**
 * Administrator endpoints (docs/API_CONTRACT.md §3–4, stages 05–09). One function per real
 * endpoint; field names are the server's. These are only ever called from AdminLayout screens,
 * which mount only after /auth/me reports an administrator — the server authorizes every call.
 */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ------------------------------------------------------------------ merchants

export interface AdminMerchant {
  id: string;
  status: MerchantStatus;
  businessName: string;
  contactName: string;
  email: string | null;
  phone: string;
  governorate: string;
  address: string;
  version: number;
  updatedAt: number;
  username: string;
  role: 'trader' | 'admin';
  createdAt: number;
  statusChangedAt: number | null;
}
export interface MerchantHistoryEntry {
  from: MerchantStatus | null;
  to: MerchantStatus | null;
  reason: string | null;
  at: number;
  actor: string | null;
}

export const isAdminMerchant = (v: unknown): v is AdminMerchant =>
  isObject(v) && isString(v.id) && isString(v.businessName) && isString(v.username) && isInt(v.version) && (v.status === 'pending' || v.status === 'approved' || v.status === 'suspended');

export function listMerchants(q: { status?: MerchantStatus; q?: string; sort?: 'newest' | 'oldest' | 'name'; cursor?: string }, signal?: AbortSignal): Promise<ApiResult<Page<AdminMerchant>>> {
  return apiGet(`/api/v1/admin/merchants${qs(q)}`, isPage(isAdminMerchant), signal);
}

export function getMerchant(id: string, signal?: AbortSignal): Promise<ApiResult<{ merchant: AdminMerchant; statusHistory: MerchantHistoryEntry[] }>> {
  return apiGet(
    `/api/v1/admin/merchants/${encodeURIComponent(id)}`,
    (v): v is { merchant: AdminMerchant; statusHistory: MerchantHistoryEntry[] } => isObject(v) && isAdminMerchant(v.merchant) && Array.isArray(v.statusHistory),
    signal,
  );
}

export function changeMerchantStatus(csrf: SessionCsrfToken, id: string, body: { status: MerchantStatus; expectedVersion: number; reason?: string }): Promise<ApiResult<{ merchant: AdminMerchant; sessionsRevoked: number }>> {
  return apiMutate({
    method: 'PATCH',
    path: `/api/v1/admin/merchants/${encodeURIComponent(id)}`,
    csrf,
    body,
    validate: (v): v is { merchant: AdminMerchant; sessionsRevoked: number } => isObject(v) && isAdminMerchant(v.merchant) && isInt(v.sessionsRevoked),
  });
}

// ------------------------------------------------------------------ products

export interface AdminProduct {
  id: string;
  name: string;
  brand: string;
  category: { id: string; labelAr: string };
  barcode: string | null;
  imageUrl: string | null;
  cartonPriceCents: number;
  packSize: number;
  minimumCartons: number;
  active: boolean;
  isDemo: boolean;
  stock: { onHand: number; reserved: number; available: number };
  version: number;
  createdAt: number;
  updatedAt: number;
}

export const isAdminProduct = (v: unknown): v is AdminProduct =>
  isObject(v) && isString(v.id) && isString(v.name) && isInt(v.cartonPriceCents) && isInt(v.packSize) && isInt(v.version) && typeof v.active === 'boolean' && isObject(v.stock) && isInt(v.stock.onHand);

const isProductEnvelope = (v: unknown): v is { product: AdminProduct } => isObject(v) && isAdminProduct(v.product);

export interface AdminProductQuery {
  q?: string;
  category?: string;
  brand?: string;
  active?: 'true' | 'false';
  sort?: 'newest' | 'oldest' | 'name' | 'price_asc' | 'price_desc';
  cursor?: string;
}

export function listAdminProducts(q: AdminProductQuery, signal?: AbortSignal): Promise<ApiResult<Page<AdminProduct>>> {
  return apiGet(`/api/v1/admin/products${qs({ ...q })}`, isPage(isAdminProduct), signal);
}

export async function getAdminProduct(id: string, signal?: AbortSignal): Promise<ApiResult<AdminProduct>> {
  const r = await apiGet(`/api/v1/admin/products/${encodeURIComponent(id)}`, isProductEnvelope, signal);
  return r.ok ? { ...r, data: r.data.product } : r;
}

/** Creation fields (no stock, activation or demo fields: products start inactive with zero stock). */
export interface ProductCreate {
  name: string;
  brand: string;
  category: string;
  barcode?: string;
  imageUrl?: string;
  cartonPriceCents: number;
  packSize: number;
  minimumCartons: number;
}

export async function createProduct(csrf: SessionCsrfToken, body: ProductCreate): Promise<ApiResult<AdminProduct>> {
  const r = await apiMutate({ method: 'POST', path: '/api/v1/admin/products', csrf, body, validate: isProductEnvelope });
  return r.ok ? { ...r, data: r.data.product } : r;
}

export type ProductPatch = Partial<Omit<ProductCreate, 'barcode' | 'imageUrl'>> & { barcode?: string | null; imageUrl?: string | null; active?: boolean };

export async function updateProduct(csrf: SessionCsrfToken, id: string, expectedVersion: number, changes: ProductPatch): Promise<ApiResult<AdminProduct>> {
  const r = await apiMutate({ method: 'PATCH', path: `/api/v1/admin/products/${encodeURIComponent(id)}`, csrf, body: { expectedVersion, ...changes }, validate: isProductEnvelope });
  return r.ok ? { ...r, data: r.data.product } : r;
}

// ------------------------------------------------------------------ inventory

export interface InventoryItem {
  product: { id: string; name: string; brand: string; category: { id: string; labelAr: string }; barcode: string | null; active: boolean; isDemo: boolean };
  onHand: number;
  reserved: number;
  available: number;
  status: StockStatus;
  statusLabelAr: string;
  version: number;
  updatedAt: number;
}

export interface LedgerEntry {
  id: number;
  productId: string;
  kind: 'opening' | 'receipt' | 'correction' | 'reserve' | 'release' | 'ship' | 'import';
  adjustmentType: 'receipt' | 'correction_delta' | 'set_total' | null;
  onHandDelta: number;
  reservedDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  availableAfter: number;
  reason: string | null;
  reference: string | null;
  orderId: string | null;
  actor: string | null;
  productVersionAfter: number | null;
  createdAt: number;
}

export const isInventoryItem = (v: unknown): v is InventoryItem =>
  isObject(v) && isObject(v.product) && isString(v.product.id) && isInt(v.onHand) && isInt(v.reserved) && isInt(v.available) && isInt(v.version);
const isLedgerEntry = (v: unknown): v is LedgerEntry => isObject(v) && isInt(v.id) && isString(v.kind) && isInt(v.onHandDelta) && isInt(v.onHandAfter) && isInt(v.reservedAfter);

export function listInventory(q: { q?: string; category?: string; active?: 'true' | 'false'; status?: StockStatus; sort?: 'name' | 'available_asc' | 'available_desc' | 'updated'; cursor?: string }, signal?: AbortSignal): Promise<ApiResult<Page<InventoryItem>>> {
  return apiGet(`/api/v1/admin/inventory${qs({ ...q })}`, isPage(isInventoryItem), signal);
}

export function getLedger(id: string, cursor: string | undefined, signal?: AbortSignal): Promise<ApiResult<{ product: InventoryItem; items: LedgerEntry[]; nextCursor: string | null }>> {
  return apiGet(
    `/api/v1/admin/inventory/${encodeURIComponent(id)}/ledger${qs({ cursor })}`,
    (v): v is { product: InventoryItem; items: LedgerEntry[]; nextCursor: string | null } =>
      isObject(v) && isInventoryItem(v.product) && Array.isArray(v.items) && v.items.every(isLedgerEntry) && (v.nextCursor === null || isString(v.nextCursor)),
    signal,
  );
}

export type AdjustmentPayload =
  | { type: 'receipt'; quantity: number; expectedVersion: number; operationKey: string; reason: string; reference?: string }
  | { type: 'correction_delta'; delta: number; expectedVersion: number; operationKey: string; reason: string; reference?: string }
  | { type: 'set_total'; total: number; expectedVersion: number; operationKey: string; reason: string; reference?: string };

export interface AdjustmentResult {
  replayed: boolean;
  operation: LedgerEntry;
  product: InventoryItem;
}

/** Idempotent per (administrator, operationKey): a same-key retry returns the original movement. */
export function adjustInventory(csrf: SessionCsrfToken, productId: string, payload: AdjustmentPayload): Promise<ApiResult<AdjustmentResult>> {
  return apiMutate({
    method: 'POST',
    path: `/api/v1/admin/inventory/${encodeURIComponent(productId)}/adjustments`,
    csrf,
    body: payload,
    validate: (v): v is AdjustmentResult => isObject(v) && typeof v.replayed === 'boolean' && isLedgerEntry(v.operation) && isInventoryItem(v.product),
  });
}

// ------------------------------------------------------------------ orders

const isAdminOrderSummary = (v: unknown): v is AdminOrderSummary => isObject(v) && isString(v.id) && isString(v.displayNumber) && isOrderState(v.state) && isInt(v.version);
const isAdminOrder = (v: unknown): v is AdminOrder =>
  isObject(v) && isString(v.id) && isOrderState(v.state) && isInt(v.version) && Array.isArray(v.items) && Array.isArray(v.events) && Array.isArray(v.allowedTransitions) && isObject(v.merchant);

export function listAdminOrders(q: { state?: OrderState; merchantId?: string; q?: string; demo?: 'true' | 'false'; sort?: 'newest' | 'oldest'; cursor?: string }, signal?: AbortSignal): Promise<ApiResult<Page<AdminOrderSummary>>> {
  return apiGet(`/api/v1/admin/orders${qs({ ...q })}`, isPage(isAdminOrderSummary), signal);
}

export async function getAdminOrder(id: string, signal?: AbortSignal): Promise<ApiResult<AdminOrder>> {
  const r = await apiGet(`/api/v1/admin/orders/${encodeURIComponent(id)}`, (v): v is { order: AdminOrder } => isObject(v) && isAdminOrder(v.order), signal);
  return r.ok ? { ...r, data: r.data.order } : r;
}

export interface TransitionPayload {
  to: Exclude<OrderState, 'pending'>;
  expectedVersion: number;
  operationKey: string;
  reason?: string;
}

export interface TransitionResult {
  replayed: boolean;
  /** The committed operation (the ORIGINAL one on a replay). */
  operation: { eventId: number; fromState: OrderState; toState: OrderState; orderVersionAfter: number; reason: string | null; actor: string | null; at: number };
  /** The order as it is NOW (may have advanced past the operation). */
  order: AdminOrder;
}

/** Idempotent per (administrator, operationKey): a same-key retry returns the original operation. */
export function transitionOrder(csrf: SessionCsrfToken, orderId: string, payload: TransitionPayload): Promise<ApiResult<TransitionResult>> {
  return apiMutate({
    method: 'POST',
    path: `/api/v1/admin/orders/${encodeURIComponent(orderId)}/transitions`,
    csrf,
    body: payload,
    validate: (v): v is TransitionResult => isObject(v) && typeof v.replayed === 'boolean' && isObject(v.operation) && isOrderState(v.operation.toState) && isAdminOrder(v.order),
  });
}

// ------------------------------------------------------------------ CSV imports (stage 13)

export const IMPORT_MODES = ['create_products', 'update_products', 'receive_stock', 'set_stock_total'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export interface ImportIssue {
  field: string | null;
  message: string;
}
export interface ImportRowReport {
  recordNo: number;
  line: number;
  status: 'ok' | 'error';
  productId: string | null;
  productName: string | null;
  errors: ImportIssue[];
  warnings: string[];
  change: Record<string, unknown> | null;
}
export interface ImportPreview {
  mode: ImportMode;
  file: { bytes: number; sha256: string };
  summary: { records: number; valid: number; invalid: number };
  fileErrors: ImportIssue[];
  rows: ImportRowReport[];
  previewToken: string | null;
  expiresAt: number | null;
}
export interface ImportCommitPayload {
  mode: ImportMode;
  /** The exact file bytes, base64 (identical to the previewed file). */
  file: string;
  operationKey: string;
  previewToken: string;
}
export interface ImportResult {
  replayed: boolean;
  import: {
    id: string;
    mode: ImportMode;
    status: 'committed';
    recordCount: number;
    fileBytes: number;
    contentSha256: string;
    createdAt: number;
    items: Array<{ recordNo: number; line: number; productId: string; productName: string; ledgerId: number | null; productVersionAfter: number }>;
  };
}

const isImportMode = (v: unknown): v is ImportMode => typeof v === 'string' && (IMPORT_MODES as readonly string[]).includes(v);
const isIssue = (v: unknown): v is ImportIssue => isObject(v) && (v.field === null || isString(v.field)) && isString(v.message);
const isRowReport = (v: unknown): v is ImportRowReport =>
  isObject(v) && isInt(v.recordNo) && isInt(v.line) && (v.status === 'ok' || v.status === 'error') && Array.isArray(v.errors) && v.errors.every(isIssue) && Array.isArray(v.warnings) && v.warnings.every(isString);
const isPreview = (v: unknown): v is ImportPreview =>
  isObject(v) && isImportMode(v.mode) && isObject(v.summary) && Array.isArray(v.fileErrors) && v.fileErrors.every(isIssue) && Array.isArray(v.rows) && v.rows.every(isRowReport) && (v.previewToken === null || isString(v.previewToken));
const isImportResult = (v: unknown): v is ImportResult =>
  isObject(v) && typeof v.replayed === 'boolean' && isObject(v.import) && isString(v.import.id) && isImportMode(v.import.mode) && v.import.status === 'committed' && isInt(v.import.recordCount) && Array.isArray(v.import.items);
export const isImportRowReport = isRowReport;

export function importTemplateUrl(mode: ImportMode): string {
  return `/api/v1/admin/imports/templates/${mode}.csv`;
}

/** Validation only: writes nothing on the server. */
export function previewImport(csrf: SessionCsrfToken, mode: ImportMode, file: string): Promise<ApiResult<ImportPreview>> {
  return apiMutate({ method: 'POST', path: '/api/v1/admin/imports/preview', csrf, body: { mode, file }, validate: isPreview });
}

/** All-or-nothing; idempotent per (administrator, operationKey): a same-key retry returns the original batch. */
export function commitImport(csrf: SessionCsrfToken, payload: ImportCommitPayload): Promise<ApiResult<ImportResult>> {
  return apiMutate({ method: 'POST', path: '/api/v1/admin/imports/commit', csrf, body: payload, validate: isImportResult });
}

// ------------------------------------------------------------------ settings, reports, exports, import history (stage 14)

export interface BusinessSettings {
  company: { name: string | null; phone: string | null; email: string | null; address: string | null };
  shippingCents: number;
  shippingTaxable: boolean;
  taxBps: number;
  minimumOrderCents: number;
  lowStockThresholdCartons: number;
  version: number;
  updatedAt: number;
  updatedBy: string | null;
}
const isSettings = (v: unknown): v is BusinessSettings =>
  isObject(v) && isObject(v.company) && isInt(v.shippingCents) && typeof v.shippingTaxable === 'boolean' && isInt(v.taxBps) && isInt(v.minimumOrderCents) && isInt(v.lowStockThresholdCartons) && isInt(v.version);
export type SettingsPatch = Partial<{ companyName: string | null; companyPhone: string | null; companyEmail: string | null; companyAddress: string | null; shippingCents: number; shippingTaxable: boolean; taxBps: number; minimumOrderCents: number; lowStockThresholdCartons: number }>;

export async function getSettings(signal?: AbortSignal): Promise<ApiResult<BusinessSettings>> {
  const r = await apiGet('/api/v1/admin/settings', (v): v is { settings: BusinessSettings } => isObject(v) && isSettings(v.settings), signal);
  return r.ok ? { ...r, data: r.data.settings } : r;
}
export async function updateSettings(csrf: SessionCsrfToken, expectedVersion: number, changes: SettingsPatch): Promise<ApiResult<BusinessSettings>> {
  const r = await apiMutate({ method: 'PATCH', path: '/api/v1/admin/settings', csrf, body: { expectedVersion, ...changes }, validate: (v): v is { settings: BusinessSettings } => isObject(v) && isSettings(v.settings) });
  return r.ok ? { ...r, data: r.data.settings } : r;
}

export interface MoneyRow {
  orders: number;
  subtotalCents: string;
  shippingCents: string;
  taxCents: string;
  totalCents: string;
}
export interface ReportRange {
  from: string;
  to: string;
  timeZone: string;
}
export interface OrdersReport {
  range: ReportRange;
  states: Array<MoneyRow & { state: OrderState }>;
  notCancelled: MoneyRow;
}
export interface ProductsReport {
  range: ReportRange;
  filters: { states: OrderState[] };
  items: Array<{ productId: string; name: string; brand: string; barcode: string | null; orders: number; cartons: string; valueCents: string }>;
  totals: { products: number; cartons: string; valueCents: string };
}
export interface InventoryReport {
  threshold: number;
  items: Array<{ productId: string; name: string; brand: string; barcode: string | null; category: string; active: boolean; onHand: number; reserved: number; available: number; status: StockStatus }>;
  totals: { products: number; onHand: string; reserved: string; available: string; byStatus: Record<StockStatus, number> };
}
export interface MovementsReport {
  range: ReportRange;
  items: Array<{ type: string; kind: string; adjustmentType: string | null; movements: number; products: number; onHandDelta: string; reservedDelta: string }>;
}
const isReport = (v: unknown): v is { report: unknown } => isObject(v) && isObject(v.report);
async function report<T>(path: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  const r = await apiGet(path, isReport, signal);
  return r.ok ? { ...r, data: r.data.report as T } : r;
}
export const getOrdersReport = (q: Record<string, string | undefined>, signal?: AbortSignal) => report<OrdersReport>(`/api/v1/admin/reports/orders${qs(q)}`, signal);
export const getProductsReport = (q: Record<string, string | undefined>, signal?: AbortSignal) => report<ProductsReport>(`/api/v1/admin/reports/products${qs(q)}`, signal);
export const getInventoryReport = (q: Record<string, string | undefined>, signal?: AbortSignal) => report<InventoryReport>(`/api/v1/admin/reports/inventory${qs(q)}`, signal);
export const getMovementsReport = (q: Record<string, string | undefined>, signal?: AbortSignal) => report<MovementsReport>(`/api/v1/admin/reports/movements${qs(q)}`, signal);

export type ExportType = 'products' | 'inventory' | 'orders' | 'report_orders' | 'report_products' | 'report_movements';
/** Spreadsheet-safe VIEW export (not a re-import format). Requires recent authentication. */
export function exportFile(csrf: SessionCsrfToken, body: { type: ExportType; filters?: Record<string, unknown>; includeBuyerContact?: boolean }) {
  return apiDownload({ path: '/api/v1/admin/exports', csrf, body });
}
/** Canonical pre-filled import template (stage-13 headers; amounts and reasons left empty). */
export function prefilledTemplate(csrf: SessionCsrfToken, mode: 'update_products' | 'receive_stock' | 'set_stock_total', filters: Record<string, string> = {}) {
  return apiDownload({ path: '/api/v1/admin/imports/templates/prefilled', csrf, body: { mode, filters } });
}

export interface ImportHistoryItem {
  id: string;
  mode: ImportMode;
  recordCount: number;
  fileBytes: number;
  createdAt: number;
  actor: string;
}
const isHistoryItem = (v: unknown): v is ImportHistoryItem => isObject(v) && isString(v.id) && isImportMode(v.mode) && isInt(v.recordCount) && isInt(v.createdAt) && isString(v.actor);
export function listImports(q: { mode?: ImportMode; cursor?: string }, signal?: AbortSignal): Promise<ApiResult<Page<ImportHistoryItem>>> {
  return apiGet(`/api/v1/admin/imports${qs(q)}`, isPage(isHistoryItem), signal);
}
export async function getImport(id: string, signal?: AbortSignal): Promise<ApiResult<ImportHistoryItem & { items: ImportResult['import']['items'] }>> {
  const r = await apiGet(`/api/v1/admin/imports/${encodeURIComponent(id)}`, (v): v is { import: ImportHistoryItem & { items: ImportResult['import']['items'] } } => isObject(v) && isHistoryItem(v.import) && Array.isArray((v.import as { items?: unknown }).items), signal);
  return r.ok ? { ...r, data: r.data.import } : r;
}
