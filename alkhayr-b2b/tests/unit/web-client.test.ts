import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { apiGet, apiMutate, apiPreLogin, csrfTokens, kindForStatus, sessionCsrf, type PreLoginCsrfToken, type SessionCsrfToken } from '../../src/web/api/client.ts';
import { isCatalogProduct, isMeResponse, isPage } from '../../src/web/api/contracts.ts';

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const realFetch = globalThis.fetch;

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-123', ...headers } });
  }) as typeof fetch;
}
const always = (_v: unknown): _v is unknown => true;
const errorBody = (code: string) => ({ error: { code, message: 'x', requestId: 'req-123' } });

beforeEach(() => {
  calls = [];
  // Any use of browser storage by the client is a failure.
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(globalThis, name, { configurable: true, get: () => assert.fail(`${name} must not be used`) });
  }
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const name of ['localStorage', 'sessionStorage']) delete (globalThis as Record<string, unknown>)[name];
});

describe('web API client', () => {
  test('status codes map to distinct failure kinds', () => {
    assert.deepEqual(
      [401, 403, 404, 409, 413, 428, 400, 415, 422, 429, 503, 500, 502].map(kindForStatus),
      ['unauthenticated', 'forbidden', 'not_found', 'conflict', 'payload_too_large', 'reauth_required', 'validation', 'validation', 'validation', 'rate_limited', 'unavailable', 'server', 'server'],
    );
  });

  test('GET: same-origin credentials, no-store, no CSRF header; success keeps the request id', async () => {
    respond(200, { status: 'ok' });
    const r = await apiGet('/healthz', (v): v is { status: 'ok' } => (v as { status?: string }).status === 'ok');
    assert.deepEqual(r, { ok: true, status: 200, data: { status: 'ok' }, requestId: 'req-123' });
    const init = calls[0]!.init;
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.equal((init.headers as Record<string, string>)['X-CSRF-Token'], undefined);
  });

  test('errors carry code, Arabic catalog message, request id, fields, current state and Retry-After', async () => {
    respond(409, { error: { code: 'VERSION_CONFLICT', message: 'x', requestId: 'req-123', details: { current: { order: { state: 'confirmed', version: 2 } } } } });
    const conflict = await apiGet('/api/v1/orders', always);
    assert.equal(conflict.ok, false);
    if (conflict.ok) return;
    assert.equal(conflict.kind, 'conflict');
    assert.equal(conflict.code, 'VERSION_CONFLICT');
    assert.match(conflict.message, /تم تعديل/);
    assert.equal(conflict.requestId, 'req-123');
    assert.deepEqual(conflict.current, { order: { state: 'confirmed', version: 2 } });

    respond(400, { error: { code: 'VALIDATION_FAILED', message: 'x', requestId: 'r', details: { fields: [{ path: 'items.0.cartons', message: 'عدد غير صالح' }, { bogus: 1 }] } } });
    const invalid = await apiGet('/api/v1/orders', always);
    assert.ok(!invalid.ok && invalid.kind === 'validation');
    assert.ok(!invalid.ok && invalid.fields.length === 1 && invalid.fields[0]!.path === 'items.0.cartons');

    respond(429, errorBody('RATE_LIMITED'), { 'Retry-After': '120' });
    const limited = await apiGet('/api/v1/orders', always);
    assert.ok(!limited.ok && limited.kind === 'rate_limited' && limited.retryAfterSeconds === 120);

    respond(428, errorBody('RECENT_AUTH_REQUIRED'));
    const reauth = await apiGet('/api/v1/admin/orders', always);
    assert.ok(!reauth.ok && reauth.kind === 'reauth_required');

    for (const [status, kind] of [[401, 'unauthenticated'], [403, 'forbidden'], [503, 'unavailable'], [500, 'server']] as const) {
      respond(status, errorBody(status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 503 ? 'UNAVAILABLE' : 'INTERNAL'));
      const r = await apiGet('/api/v1/orders', always);
      assert.ok(!r.ok && r.kind === kind, `${status}`);
    }
  });

  test('a failed or malformed response is never an empty successful list', async () => {
    const pageGuard = isPage(isCatalogProduct);
    respond(500, 'not json');
    const broken = await apiGet('/api/v1/products', pageGuard);
    assert.equal(broken.ok, false);
    respond(200, { items: 'nope', nextCursor: null });
    const shape = await apiGet('/api/v1/products', pageGuard);
    assert.ok(!shape.ok && shape.kind === 'invalid_response');
    // A trader catalog response that carried stock counts would violate the contract and is rejected.
    respond(200, { items: [{ id: 'p', name: 'n', cartonPriceCents: 1, packSize: 1, minimumCartons: 1, availability: { status: 'normal' }, onHand: 5 }], nextCursor: null });
    const leaked = await apiGet('/api/v1/products', pageGuard);
    assert.ok(!leaked.ok && leaked.kind === 'invalid_response');
    respond(200, { items: [], nextCursor: null });
    const empty = await apiGet('/api/v1/products', pageGuard);
    assert.ok(empty.ok && empty.data.items.length === 0);
  });

  test('network failure: one attempt, never retried; mutation message says the outcome is unknown', async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts++;
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const get = await apiGet('/api/v1/orders', always);
    assert.ok(!get.ok && get.kind === 'network' && get.status === 0);
    const post = await apiMutate({ method: 'POST', path: '/api/v1/orders', body: { requestKey: 'k' }, csrf: sessionCsrf('s1.token'), validate: always });
    assert.ok(!post.ok && post.kind === 'network' && /قد تكون العملية نُفذت/.test(post.message));
    assert.equal(attempts, 2, 'exactly one fetch per call');
  });

  test('mutations send the session CSRF token and JSON; pre-login calls use the pre-login token', async () => {
    respond(201, { ok: true });
    await apiMutate({ method: 'POST', path: '/api/v1/orders', body: { a: 1 }, csrf: sessionCsrf('s1.session'), validate: always });
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers['X-CSRF-Token'], 's1.session');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(calls[0]!.init.body, '{"a":1}');
    assert.equal(calls[0]!.init.method, 'POST');

    const tokens = csrfTokens({ csrfToken: null, preLoginToken: 'p1.prelogin', preLoginExpiresAt: 1 });
    assert.equal(tokens.session, null);
    await apiPreLogin({ path: '/api/v1/auth/login', body: { username: 'u', password: 'p' }, csrf: tokens.preLogin, validate: always });
    assert.equal((calls[1]!.init.headers as Record<string, string>)['X-CSRF-Token'], 'p1.prelogin');

    // Compile-time separation of the two CSRF contracts (checked by `npm run typecheck`).
    const pre = tokens.preLogin;
    // @ts-expect-error a pre-login token cannot authorize an authenticated mutation
    const wrong: SessionCsrfToken = pre;
    // @ts-expect-error a session token cannot be used for login/registration
    const wrong2: PreLoginCsrfToken = sessionCsrf('s1.x');
    void wrong;
    void wrong2;
  });

  test('only same-origin API paths can be called', async () => {
    respond(200, {});
    await assert.rejects(() => apiGet('https://evil.example/api/v1/orders', always), /non-API path/);
    await assert.rejects(() => apiGet('//evil.example/api/v1/x', always), /non-API path/);
    await assert.rejects(() => apiGet('/assets/main.js', always), /non-API path/);
    assert.equal(calls.length, 0);
  });

  test('identity contract guard matches the real /auth/me shape', () => {
    const me = {
      user: { id: 'u', username: 'trader.one', role: 'trader' },
      merchant: { id: 'm', status: 'approved', businessName: 'متجر', contactName: 'أ', email: null, phone: '010', governorate: 'القاهرة', address: 'عنوان', version: 1 },
      session: { absoluteExpiresAt: 2, idleExpiresAt: 1, recentAuthUntil: null },
      csrfToken: 's1.x',
    };
    assert.equal(isMeResponse(me), true);
    assert.equal(isMeResponse({ ...me, user: { ...me.user, role: 'root' } }), false);
    assert.equal(isMeResponse({ ...me, csrfToken: undefined }), false);
  });
});

describe('request keys', () => {
  test('UUID v4 from the CSPRNG, unique, valid for the server schema, without crypto.randomUUID', async () => {
    const { newRequestKey } = await import('../../src/web/api/client.ts');
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined }); // insecure context
    try {
      const keys = new Set(Array.from({ length: 1000 }, () => newRequestKey()));
      assert.equal(keys.size, 1000);
      for (const k of keys) assert.match(k, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: original });
    }
  });
});

describe('sign-in and registration requests', () => {
  test('a fresh pre-login token is fetched first; username and password are sent exactly as typed', async () => {
    const { login } = await import('../../src/web/api/endpoints.ts');
    const seen: Call[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      if (url === '/api/v1/auth/csrf') return new Response(JSON.stringify({ authenticated: true, csrfToken: 's1.old', preLoginToken: 'p1.fresh', preLoginExpiresAt: 1 }), { status: 200 });
      return new Response(JSON.stringify({ user: { id: 'u', username: 'x', role: 'trader' }, merchant: { status: 'approved' }, session: {}, csrfToken: 's1.new' }), { status: 200 });
    }) as typeof fetch;
    const r = await login({ username: ' Mixed.Case ', password: '  pass word with spaces  ', totp: '012345' });
    assert.equal(r.ok, true);
    assert.deepEqual(seen.map((c) => c.url), ['/api/v1/auth/csrf', '/api/v1/auth/login']);
    const headers = seen[1]!.init.headers as Record<string, string>;
    assert.equal(headers['X-CSRF-Token'], 'p1.fresh', 'the pre-login token, even though a session exists');
    assert.deepEqual(JSON.parse(String(seen[1]!.init.body)), { username: ' Mixed.Case ', password: '  pass word with spaces  ', totp: '012345' });
  });
});

describe('secure request keys without weak fallback', () => {
  test('if crypto.getRandomValues is unavailable, key generation throws instead of falling back', async () => {
    const { newRequestKey, SecureRandomUnavailableError } = await import('../../src/web/api/client.ts');
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
    try {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => 'not-used' } });
      assert.throws(() => newRequestKey(), SecureRandomUnavailableError);
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
      assert.throws(() => newRequestKey(), SecureRandomUnavailableError);
    } finally {
      Object.defineProperty(globalThis, 'crypto', original);
    }
    assert.match(newRequestKey(), /^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  });
});
