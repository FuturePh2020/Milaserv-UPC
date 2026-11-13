import { ERROR_CATALOG, isErrorCode, type ApiFieldError, type ErrorCode } from '../../shared/errors.ts';

/**
 * Typed API client (stage 10).
 *
 * - Authentication is ONLY the HttpOnly session cookie (same-origin `credentials`). This module
 *   never reads, writes or persists session tokens, passwords, MFA codes or CSRF tokens in
 *   localStorage/sessionStorage/cookies; CSRF tokens live in memory (React state) only.
 * - Two distinct CSRF contracts (docs/SECURITY.md §6): a SESSION token for authenticated
 *   mutations and a PRE-LOGIN token for login/registration. They are separate branded types,
 *   so one cannot be passed where the other is required.
 * - Every failure is a distinct `kind`; a failed request is never turned into empty data.
 * - Nothing is retried automatically. Mutations carry the caller's idempotency key; the UI may
 *   offer a manual retry of the SAME request (same key), never a silent one.
 * - The server's X-Request-Id is kept for support references.
 */

export type SessionCsrfToken = string & { readonly __brand: 'session-csrf' };
export type PreLoginCsrfToken = string & { readonly __brand: 'pre-login-csrf' };

export type ApiFailureKind =
  | 'network' // no response (offline, DNS, connection reset) — outcome of a mutation is UNKNOWN
  | 'unauthenticated' // 401: no valid session (signed out or expired)
  | 'forbidden' // 403: role/approval/CSRF/origin refusal
  | 'not_found' // 404
  | 'conflict' // 409: version/state/idempotency/stock conflicts — show, never overwrite
  | 'reauth_required' // 428: administrator must sign in again (recent authentication)
  | 'validation' // 400 / 415 / 422
  | 'payload_too_large' // 413
  | 'rate_limited' // 429 (see retryAfterSeconds)
  | 'unavailable' // 503 (capacity / not ready)
  | 'server' // 500 and anything unexpected
  | 'invalid_response'; // body missing or not matching the contract

export interface ApiFailure {
  ok: false;
  kind: ApiFailureKind;
  status: number;
  code: ErrorCode | null;
  message: string;
  requestId: string | null;
  fields: ApiFieldError[];
  /** Safe current state returned with conflicts (e.g. current product, order state/version). */
  current: Record<string, unknown> | null;
  retryAfterSeconds: number | null;
}

export type ApiResult<T> = { ok: true; status: number; data: T; requestId: string | null } | ApiFailure;

export const NETWORK_MESSAGE = 'تعذّر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.';
export const NETWORK_MUTATION_MESSAGE = 'انقطع الاتصال قبل وصول الرد؛ قد تكون العملية نُفذت أو لم تُنفذ. أعد المحاولة بالطلب نفسه، فلن تتكرر.';
const INVALID_RESPONSE_MESSAGE = 'استجابة غير متوقعة من الخادم.';

export function kindForStatus(status: number): ApiFailureKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'payload_too_large';
  if (status === 428) return 'reauth_required';
  if (status === 400 || status === 415 || status === 422) return 'validation';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'unavailable';
  return 'server';
}

function failure(partial: Partial<ApiFailure> & Pick<ApiFailure, 'kind' | 'status' | 'message'>): ApiFailure {
  return { ok: false, code: null, requestId: null, fields: [], current: null, retryAfterSeconds: null, ...partial };
}

const API_PATH = /^\/(api\/v1\/|healthz$|readyz$)/;

interface RequestSpec<T> {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  validate: (value: unknown) => value is T;
  body?: unknown;
  csrf?: SessionCsrfToken | PreLoginCsrfToken;
  signal?: AbortSignal;
}

async function request<T>(spec: RequestSpec<T>): Promise<ApiResult<T>> {
  // Same-origin relative API paths only: credentials are never sent elsewhere.
  if (!API_PATH.test(spec.path)) throw new Error(`Refusing to call a non-API path: ${spec.path}`);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (spec.body !== undefined) headers['Content-Type'] = 'application/json';
  if (spec.csrf) headers['X-CSRF-Token'] = spec.csrf;
  let response: Response;
  try {
    response = await fetch(spec.path, {
      method: spec.method,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers,
      ...(spec.body !== undefined ? { body: JSON.stringify(spec.body) } : {}),
      ...(spec.signal ? { signal: spec.signal } : {}),
    });
  } catch (err) {
    if (spec.signal?.aborted) throw err; // caller cancelled: not a network failure to display
    return failure({ kind: 'network', status: 0, message: spec.method === 'GET' ? NETWORK_MESSAGE : NETWORK_MUTATION_MESSAGE });
  }
  const requestId = response.headers.get('X-Request-Id');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return failure({ kind: response.ok ? 'invalid_response' : kindForStatus(response.status), status: response.status, message: INVALID_RESPONSE_MESSAGE, requestId });
  }
  if (response.ok) {
    if (spec.validate(body)) return { ok: true, status: response.status, data: body, requestId };
    return failure({ kind: 'invalid_response', status: response.status, message: INVALID_RESPONSE_MESSAGE, requestId });
  }
  const err = (body as { error?: { code?: unknown; details?: { fields?: unknown; current?: unknown } } } | null)?.error;
  const code = isErrorCode(err?.code) ? err.code : null;
  const fields = Array.isArray(err?.details?.fields)
    ? (err.details.fields as unknown[]).filter((f): f is ApiFieldError => typeof f === 'object' && f !== null && typeof (f as ApiFieldError).path === 'string' && typeof (f as ApiFieldError).message === 'string')
    : [];
  const current = typeof err?.details?.current === 'object' && err.details.current !== null ? (err.details.current as Record<string, unknown>) : null;
  const retryAfter = Number(response.headers.get('Retry-After'));
  return failure({
    kind: kindForStatus(response.status),
    status: response.status,
    code,
    message: code ? ERROR_CATALOG[code].messageAr : INVALID_RESPONSE_MESSAGE,
    requestId,
    fields,
    current,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  });
}

/** Read request. Callers must not fetch administrator resources before identity is established. */
export function apiGet<T>(path: string, validate: (value: unknown) => value is T, signal?: AbortSignal): Promise<ApiResult<T>> {
  return request({ method: 'GET', path, validate, ...(signal ? { signal } : {}) });
}

/** Authenticated mutation: requires the SESSION CSRF token. Never retried automatically. */
export function apiMutate<T>(spec: { method: 'POST' | 'PATCH'; path: string; body?: unknown; csrf: SessionCsrfToken; validate: (value: unknown) => value is T; signal?: AbortSignal }): Promise<ApiResult<T>> {
  return request(spec);
}

/** Pre-login mutation (login/registration only): requires the PRE-LOGIN token. Used from stage 11. */
export function apiPreLogin<T>(spec: {
  path: '/api/v1/auth/login' | '/api/v1/auth/register';
  body: unknown;
  csrf: PreLoginCsrfToken;
  validate: (value: unknown) => value is T;
  signal?: AbortSignal;
}): Promise<ApiResult<T>> {
  return request({ ...spec, method: 'POST' });
}

/** Typed split of GET /api/v1/auth/csrf into its two distinct tokens (memory only). */
export function csrfTokens(raw: { csrfToken: string | null; preLoginToken: string; preLoginExpiresAt: number }): {
  session: SessionCsrfToken | null;
  preLogin: PreLoginCsrfToken;
  preLoginExpiresAt: number;
} {
  return { session: raw.csrfToken as SessionCsrfToken | null, preLogin: raw.preLoginToken as PreLoginCsrfToken, preLoginExpiresAt: raw.preLoginExpiresAt };
}

/** The session CSRF token returned by GET /auth/me and POST /auth/login. */
export function sessionCsrf(token: string): SessionCsrfToken {
  return token as SessionCsrfToken;
}

/** Thrown when no cryptographically secure random source exists; no weaker fallback is ever used. */
export class SecureRandomUnavailableError extends Error {
  constructor() {
    super('crypto.getRandomValues is unavailable');
    this.name = 'SecureRandomUnavailableError';
  }
}

export const SECURE_RANDOM_MESSAGE =
  'هذا المتصفح لا يوفر مولّد أرقام عشوائية آمنًا، لذلك لم يُرسل أي شيء. استخدم متصفحًا حديثًا (Chrome أو Edge أو Firefox أو Safari بإصدار حديث).';

/**
 * Fresh UUID v4 for idempotency/operation keys (one per intended action; reuse only for retries).
 * Source: crypto.getRandomValues (Web Crypto CSPRNG). Unlike crypto.randomUUID and crypto.subtle it
 * is exposed outside secure contexts too, so a plain-HTTP test host works; production still
 * requires HTTPS for every other reason (cookies, transport). If it is missing, this THROWS:
 * there is no Math.random, timestamp or counter fallback. Callers must not send the mutation.
 */
export function newRequestKey(): string {
  const source = (globalThis as { crypto?: { getRandomValues?: <T extends ArrayBufferView>(a: T) => T } }).crypto;
  if (!source || typeof source.getRandomValues !== 'function') throw new SecureRandomUnavailableError();
  const b = source.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Authenticated CSV download (stage 14 exports): POST with session CSRF, returns the file as a Blob.
 * Errors use the same typed failures as JSON requests. The filename is accepted only if it matches
 * the server's fixed pattern. Never retried automatically.
 */
export async function apiDownload(spec: { path: string; csrf: SessionCsrfToken; body: unknown }): Promise<ApiResult<{ blob: Blob; filename: string; omittedNames: number }>> {
  if (!API_PATH.test(spec.path)) throw new Error(`Refusing to call a non-API path: ${spec.path}`);
  let response: Response;
  try {
    response = await fetch(spec.path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'text/csv, application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': spec.csrf },
      body: JSON.stringify(spec.body),
    });
  } catch {
    return failure({ kind: 'network', status: 0, message: NETWORK_MESSAGE });
  }
  const requestId = response.headers.get('X-Request-Id');
  if (response.ok) {
    if (!(response.headers.get('Content-Type') ?? '').startsWith('text/csv')) return failure({ kind: 'invalid_response', status: response.status, message: INVALID_RESPONSE_MESSAGE, requestId });
    const m = /filename="(alkhayr-[a-z0-9-]{1,80}\.csv)"/.exec(response.headers.get('Content-Disposition') ?? '');
    const omitted = Number(response.headers.get('X-Omitted-Display-Names') ?? '0');
    try {
      return { ok: true, status: response.status, data: { blob: await response.blob(), filename: m?.[1] ?? 'alkhayr-export.csv', omittedNames: Number.isSafeInteger(omitted) ? omitted : 0 }, requestId };
    } catch {
      return failure({ kind: 'network', status: 0, message: NETWORK_MESSAGE, requestId });
    }
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    /* non-JSON error */
  }
  const err = (body as { error?: { code?: unknown; details?: { fields?: unknown; current?: unknown } } } | null)?.error;
  const code = isErrorCode(err?.code) ? err.code : null;
  const current = typeof err?.details?.current === 'object' && err.details.current !== null ? (err.details.current as Record<string, unknown>) : null;
  const retryAfter = Number(response.headers.get('Retry-After'));
  return failure({
    kind: kindForStatus(response.status),
    status: response.status,
    code,
    message: code ? ERROR_CATALOG[code].messageAr : INVALID_RESPONSE_MESSAGE,
    requestId,
    current,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  });
}
