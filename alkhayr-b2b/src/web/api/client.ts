import { ERROR_CATALOG, isErrorCode, type ErrorCode } from '../../shared/errors.ts';

/**
 * Typed API client. Authentication relies solely on the HttpOnly session
 * cookie set by the server (stage 04); this module never reads or stores
 * tokens. Every failure is a distinct state so a failed request can never be
 * rendered as an empty successful result.
 */
export type ApiFailureKind =
  | 'network'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'reauth_required'
  | 'validation'
  | 'rate_limited'
  | 'server'
  | 'invalid_response';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: ApiFailureKind; status: number; code: ErrorCode | null; message: string; requestId: string | null };

const NETWORK_MESSAGE = 'تعذّر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.';
const INVALID_RESPONSE_MESSAGE = 'استجابة غير متوقعة من الخادم.';

function kindForStatus(status: number): ApiFailureKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 428) return 'reauth_required';
  if (status === 400 || status === 413 || status === 415 || status === 422) return 'validation';
  if (status === 429) return 'rate_limited';
  return 'server';
}

export async function apiGet<T>(path: string, validate: (value: unknown) => value is T, signal?: AbortSignal): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
  } catch {
    return { ok: false, kind: 'network', status: 0, code: null, message: NETWORK_MESSAGE, requestId: null };
  }
  const requestId = response.headers.get('X-Request-Id');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, kind: 'invalid_response', status: response.status, code: null, message: INVALID_RESPONSE_MESSAGE, requestId };
  }
  if (response.ok) {
    if (validate(body)) return { ok: true, data: body };
    return { ok: false, kind: 'invalid_response', status: response.status, code: null, message: INVALID_RESPONSE_MESSAGE, requestId };
  }
  const err = (body as { error?: { code?: unknown } } | null)?.error;
  const code = isErrorCode(err?.code) ? err.code : null;
  return {
    ok: false,
    kind: kindForStatus(response.status),
    status: response.status,
    code,
    message: code ? ERROR_CATALOG[code].messageAr : INVALID_RESPONSE_MESSAGE,
    requestId,
  };
}
