import { apiGet, apiMutate, apiPreLogin, csrfTokens, type ApiResult, type PreLoginCsrfToken, type SessionCsrfToken } from './client.ts';
import {
  isCatalogFilters,
  isCatalogProduct,
  isCsrfResponse,
  isLoginResponse,
  isOrderResponse,
  isOrderSummary,
  isPage,
  isPasswordChangeResponse,
  isProductResponse,
  isProfileResponse,
  isQuoteResponse,
  isRegisterResponse,
  type CatalogFilters,
  type CatalogProduct,
  type LoginResponse,
  type Order,
  type OrderQuote,
  type OrderState,
  type OrderSummary,
  type OwnProfile,
  type Page,
  type PasswordChangeResponse,
  type RegisterResponse,
} from './contracts.ts';

/**
 * One typed function per real endpoint used by the merchant experience (docs/API_CONTRACT.md).
 * No endpoint exists here that the server does not implement.
 */

export interface OrderLinePayload {
  productId: string;
  cartons: number;
  expectedCartonPriceCents: number;
  expectedPackSize: number;
}

/** Fresh pre-login token (always fetched immediately before sign-in/registration). */
export async function fetchPreLoginToken(signal?: AbortSignal): Promise<ApiResult<PreLoginCsrfToken>> {
  const r = await apiGet('/api/v1/auth/csrf', isCsrfResponse, signal);
  return r.ok ? { ...r, data: csrfTokens(r.data).preLogin } : r;
}

/** Username and password are sent exactly as typed: never trimmed, lowercased or truncated here. */
export async function login(input: { username: string; password: string; totp?: string }): Promise<ApiResult<LoginResponse>> {
  const token = await fetchPreLoginToken();
  if (!token.ok) return token;
  return apiPreLogin({ path: '/api/v1/auth/login', csrf: token.data, validate: isLoginResponse, body: input });
}

export interface RegistrationInput {
  username: string;
  password: string;
  businessName: string;
  contactName: string;
  phone: string;
  governorate: string;
  address: string;
  email?: string;
}

export async function register(input: RegistrationInput): Promise<ApiResult<RegisterResponse>> {
  const token = await fetchPreLoginToken();
  if (!token.ok) return token;
  return apiPreLogin({ path: '/api/v1/auth/register', csrf: token.data, validate: isRegisterResponse, body: input });
}

export function changePassword(csrf: SessionCsrfToken, input: { currentPassword: string; newPassword: string; totp?: string }): Promise<ApiResult<PasswordChangeResponse>> {
  return apiMutate({ method: 'POST', path: '/api/v1/auth/password', csrf, body: input, validate: isPasswordChangeResponse });
}

export async function getProfile(signal?: AbortSignal): Promise<ApiResult<OwnProfile>> {
  const r = await apiGet('/api/v1/merchant/profile', isProfileResponse, signal);
  return r.ok ? { ...r, data: r.data.profile } : r;
}

export type ProfilePatch = Partial<Pick<OwnProfile, 'businessName' | 'contactName' | 'phone' | 'governorate' | 'address'>> & { email?: string | null };

export async function patchProfile(csrf: SessionCsrfToken, expectedVersion: number, changes: ProfilePatch): Promise<ApiResult<OwnProfile>> {
  const r = await apiMutate({ method: 'PATCH', path: '/api/v1/merchant/profile', csrf, body: { expectedVersion, ...changes }, validate: isProfileResponse });
  return r.ok ? { ...r, data: r.data.profile } : r;
}

export interface CatalogQuery {
  q?: string;
  category?: string;
  brand?: string;
  sort?: 'name' | 'newest' | 'price_asc' | 'price_desc';
  cursor?: string;
  limit?: number;
}

export function catalogQueryString(q: CatalogQuery): string {
  const params = new URLSearchParams();
  for (const key of ['q', 'category', 'brand', 'sort', 'cursor'] as const) {
    const value = q[key];
    if (value) params.set(key, value);
  }
  if (q.limit) params.set('limit', String(q.limit));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function listProducts(q: CatalogQuery, signal?: AbortSignal): Promise<ApiResult<Page<CatalogProduct>>> {
  return apiGet(`/api/v1/products${catalogQueryString(q)}`, isPage(isCatalogProduct), signal);
}

export async function getProduct(id: string, signal?: AbortSignal): Promise<ApiResult<CatalogProduct>> {
  const r = await apiGet(`/api/v1/products/${encodeURIComponent(id)}`, isProductResponse, signal);
  return r.ok ? { ...r, data: r.data.product } : r;
}

export function getCatalogFilters(signal?: AbortSignal): Promise<ApiResult<CatalogFilters>> {
  return apiGet('/api/v1/catalog/filters', isCatalogFilters, signal);
}

export async function quoteOrder(csrf: SessionCsrfToken, items: OrderLinePayload[], signal?: AbortSignal): Promise<ApiResult<OrderQuote>> {
  const r = await apiMutate({ method: 'POST', path: '/api/v1/orders/quote', csrf, body: { items }, validate: isQuoteResponse, ...(signal ? { signal } : {}) });
  return r.ok ? { ...r, data: r.data.quote } : r;
}

export interface CreateOrderPayload {
  requestKey: string;
  note?: string;
  items: OrderLinePayload[];
}

/** Never retried automatically; the caller keeps the key and payload for an explicit same-request retry. */
export async function createOrder(csrf: SessionCsrfToken, payload: CreateOrderPayload): Promise<ApiResult<{ order: Order; replayed: boolean }>> {
  const r = await apiMutate({ method: 'POST', path: '/api/v1/orders', csrf, body: payload, validate: isOrderResponse });
  return r.ok ? { ...r, data: { order: r.data.order, replayed: r.data.replayed === true } } : r;
}

export function listOrders(q: { state?: OrderState; cursor?: string }, signal?: AbortSignal): Promise<ApiResult<Page<OrderSummary>>> {
  const params = new URLSearchParams();
  if (q.state) params.set('state', q.state);
  if (q.cursor) params.set('cursor', q.cursor);
  const s = params.toString();
  return apiGet(`/api/v1/orders${s ? `?${s}` : ''}`, isPage(isOrderSummary), signal);
}

export async function getOrder(id: string, signal?: AbortSignal): Promise<ApiResult<Order>> {
  const r = await apiGet(`/api/v1/orders/${encodeURIComponent(id)}`, isOrderResponse, signal);
  return r.ok ? { ...r, data: r.data.order } : r;
}
