/**
 * Browser-side response contracts, transcribed from docs/API_CONTRACT.md and the stage 04–09
 * server code (field names are the server's). Each guard checks the fields the UI relies on;
 * a response that fails its guard is reported as `invalid_response`, never as empty data.
 */
import type { StockStatus } from '../../shared/stock-status.ts';

export type { StockStatus };
export type Role = 'trader' | 'admin';
export type MerchantStatus = 'pending' | 'approved' | 'suspended';
export type OrderState = 'pending' | 'confirmed' | 'preparing' | 'shipped' | 'delivered' | 'cancelled';
export type AllocationStatus = 'reserved' | 'released' | 'consumed';

export const ORDER_STATES: readonly OrderState[] = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'];

export interface HealthResponse {
  status: 'ok';
}

/** GET /api/v1/auth/csrf — two DIFFERENT tokens (see client.ts). */
export interface CsrfResponse {
  authenticated: boolean;
  csrfToken: string | null;
  preLoginToken: string;
  preLoginExpiresAt: number;
}

/** GET /api/v1/auth/me */
export interface MeResponse {
  user: { id: string; username: string; role: Role };
  merchant: {
    id: string;
    status: MerchantStatus;
    businessName: string;
    contactName: string;
    email: string | null;
    phone: string;
    governorate: string;
    address: string;
    version: number;
  };
  session: { absoluteExpiresAt: number; idleExpiresAt: number; recentAuthUntil: number | null };
  csrfToken: string;
}

export interface LogoutResponse {
  loggedOut: true;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Trader catalog view (§3a): availability status only, never stock counts. */
export interface CatalogProduct {
  id: string;
  name: string;
  brand: string;
  category: { id: string; labelAr: string };
  barcode: string | null;
  imageUrl: string | null;
  cartonPriceCents: number;
  packSize: number;
  minimumCartons: number;
  availability: { status: StockStatus; labelAr: string };
  isDemo: boolean;
}

export interface OrderItemSnapshot {
  lineNo: number;
  productId: string;
  name: string;
  brand: string;
  barcode: string | null;
  packSize: number;
  cartonPriceCents: number;
  cartons: number;
  lineTotalCents: number;
}

export interface OrderAmounts {
  subtotalCents: number;
  shippingCents: number;
  shippingTaxable: boolean;
  taxBps: number;
  taxBaseCents: number;
  taxCents: number;
  totalCents: number;
  minimumOrderCents: number;
}

/** Trader order (§3c): snapshots only; events without administrator names or reasons. */
export interface Order {
  id: string;
  displayNumber: string;
  state: OrderState;
  version: number;
  isDemo: boolean;
  note: string | null;
  requestKey: string;
  buyer: { businessName: string; contactName: string; phone: string; governorate: string; address: string };
  items: OrderItemSnapshot[];
  amounts: OrderAmounts;
  events: Array<{ fromState: OrderState | null; toState: OrderState; at: number }>;
  createdAt: number;
  updatedAt: number;
}

export interface OrderSummary {
  id: string;
  displayNumber: string;
  state: OrderState;
  isDemo: boolean;
  lineCount: number;
  cartonCount: number;
  totalCents: number;
  createdAt: number;
  updatedAt: number;
}

/** Administrator order (§4): adds allocations, current stock and event actors/reasons. */
export interface AdminOrder extends Omit<Order, 'items' | 'events'> {
  merchant: { id: string; username: string; currentStatus: MerchantStatus; currentBusinessName: string };
  items: Array<
    OrderItemSnapshot & {
      allocation: { status: AllocationStatus; quantity: number; outstanding: number } | null;
      currentProduct: { active: boolean; packSize: number; onHand: number; reserved: number; available: number };
    }
  >;
  events: Array<{ id: number; fromState: OrderState | null; toState: OrderState; reason: string | null; versionAfter: number; actor: string | null; at: number }>;
  allowedTransitions: OrderState[];
}

export interface AdminOrderSummary {
  id: string;
  displayNumber: string;
  merchantId: string;
  buyerBusinessName: string;
  buyerGovernorate: string;
  state: OrderState;
  version: number;
  isDemo: boolean;
  lineCount: number;
  totalCents: number;
  createdAt: number;
  updatedAt: number;
}

// ------------------------------------------------------------------ guards

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const oneOf = <T extends string>(values: readonly T[]) => (v: unknown): v is T => typeof v === 'string' && (values as readonly string[]).includes(v);

export const isOrderState = oneOf(ORDER_STATES);
export const isStockStatus = oneOf<StockStatus>(['out_of_stock', 'low_stock', 'normal']);

export function isHealth(v: unknown): v is HealthResponse {
  return isObject(v) && v.status === 'ok';
}

export function isCsrfResponse(v: unknown): v is CsrfResponse {
  return isObject(v) && typeof v.authenticated === 'boolean' && (v.csrfToken === null || isString(v.csrfToken)) && isString(v.preLoginToken) && isInt(v.preLoginExpiresAt);
}

export function isMeResponse(v: unknown): v is MeResponse {
  if (!isObject(v) || !isObject(v.user) || !isObject(v.merchant) || !isObject(v.session) || !isString(v.csrfToken)) return false;
  const { user, merchant, session } = v;
  return (
    isString(user.id) &&
    isString(user.username) &&
    oneOf<Role>(['trader', 'admin'])(user.role) &&
    isString(merchant.id) &&
    oneOf<MerchantStatus>(['pending', 'approved', 'suspended'])(merchant.status) &&
    isString(merchant.businessName) &&
    isInt(merchant.version) &&
    isInt(session.absoluteExpiresAt) &&
    isInt(session.idleExpiresAt) &&
    (session.recentAuthUntil === null || isInt(session.recentAuthUntil))
  );
}

export function isLogoutResponse(v: unknown): v is LogoutResponse {
  return isObject(v) && v.loggedOut === true;
}

export function isPage<T>(item: (v: unknown) => v is T) {
  return (v: unknown): v is Page<T> => isObject(v) && Array.isArray(v.items) && v.items.every(item) && (v.nextCursor === null || isString(v.nextCursor));
}

export function isCatalogProduct(v: unknown): v is CatalogProduct {
  return (
    isObject(v) &&
    isString(v.id) &&
    isString(v.name) &&
    isInt(v.cartonPriceCents) &&
    isInt(v.packSize) &&
    isInt(v.minimumCartons) &&
    isObject(v.availability) &&
    isStockStatus(v.availability.status) &&
    // The trader contract never carries stock counts; a response that does is rejected.
    !('stock' in v) &&
    !('onHand' in v)
  );
}

export function isOrderSummary(v: unknown): v is OrderSummary {
  return isObject(v) && isString(v.id) && isString(v.displayNumber) && isOrderState(v.state) && isInt(v.totalCents) && isInt(v.createdAt);
}

export function isOrder(v: unknown): v is Order {
  return (
    isObject(v) &&
    isString(v.id) &&
    isString(v.displayNumber) &&
    isOrderState(v.state) &&
    isInt(v.version) &&
    Array.isArray(v.items) &&
    isObject(v.amounts) &&
    isInt(v.amounts.totalCents) &&
    Array.isArray(v.events)
  );
}

// ------------------------------------------------------------------ stage 11 contracts

/** POST /auth/register — identical for new and duplicate usernames (no account discovery). */
export interface RegisterResponse {
  status: 'received';
  message: string;
}

/** POST /auth/login */
export interface LoginResponse {
  user: { id: string; username: string; role: Role };
  merchant: { status: MerchantStatus };
  session: { expiresAt: number; idleTimeoutMinutes: number };
  csrfToken: string;
}

/** POST /auth/password — every session of the account is revoked. */
export interface PasswordChangeResponse {
  passwordChanged: true;
  sessionsRevoked: number;
  reloginRequired: true;
}

/** GET/PATCH /merchant/profile */
export interface OwnProfile {
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
}

/** GET /catalog/filters */
export interface CatalogFilters {
  categories: Array<{ id: string; labelAr: string; productCount: number }>;
  brands: Array<{ name: string; productCount: number }>;
}

/** POST /orders/quote — read-only preview; not a price lock or reservation. */
export interface OrderQuote {
  items: Array<{ lineNo: number; productId: string; name: string; brand: string; packSize: number; cartonPriceCents: number; cartons: number; lineTotalCents: number }>;
  amounts: OrderAmounts;
  minimumOrderMet: boolean;
  isDemo: boolean;
  quotedAt: number;
}

export function isRegisterResponse(v: unknown): v is RegisterResponse {
  return isObject(v) && v.status === 'received' && isString(v.message);
}
export function isLoginResponse(v: unknown): v is LoginResponse {
  return isObject(v) && isObject(v.user) && isString(v.user.id) && isObject(v.merchant) && isString(v.csrfToken);
}
export function isPasswordChangeResponse(v: unknown): v is PasswordChangeResponse {
  return isObject(v) && v.passwordChanged === true && v.reloginRequired === true;
}
export function isOwnProfile(v: unknown): v is OwnProfile {
  return isObject(v) && isString(v.id) && isString(v.businessName) && isString(v.contactName) && isString(v.phone) && isString(v.governorate) && isString(v.address) && isInt(v.version) && (v.email === null || isString(v.email));
}
export function isProfileResponse(v: unknown): v is { profile: OwnProfile } {
  return isObject(v) && isOwnProfile(v.profile);
}
export function isCatalogFilters(v: unknown): v is CatalogFilters {
  return (
    isObject(v) &&
    Array.isArray(v.categories) &&
    v.categories.every((c) => isObject(c) && isString(c.id) && isString(c.labelAr)) &&
    Array.isArray(v.brands) &&
    v.brands.every((b) => isObject(b) && isString(b.name))
  );
}
export function isProductResponse(v: unknown): v is { product: CatalogProduct } {
  return isObject(v) && isCatalogProduct(v.product);
}
export function isOrderResponse(v: unknown): v is { order: Order; replayed?: boolean } {
  return isObject(v) && isOrder(v.order);
}
export function isQuoteResponse(v: unknown): v is { quote: OrderQuote } {
  return isObject(v) && isObject(v.quote) && Array.isArray(v.quote.items) && isObject(v.quote.amounts) && isInt(v.quote.amounts.totalCents) && typeof v.quote.minimumOrderMet === 'boolean';
}
