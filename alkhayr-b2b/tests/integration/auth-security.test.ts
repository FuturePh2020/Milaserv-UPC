import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, test } from 'node:test';
import { PasswordHasher } from '../../src/server/auth/passwords.ts';
import { hashSessionToken } from '../../src/server/auth/sessions.ts';
import { requireApproved, requireOwnMerchant, requireRecentAdminAuth, requireSession, requireSessionCsrf } from '../../src/server/auth/authorization.ts';
import { sendJson } from '../../src/server/http/response.ts';
import { readJsonBody } from '../../src/server/http/request-body.ts';
import { CHEAP_PARAMS, Client, count, createAdmin, createTrader, GatedHasher, startTestApp, type TestApp } from '../helpers/app.ts';

// Synthetic credentials only.
const MIN = 60_000;

function expectCode(r: { status: number; json: any }, status: number, code: string) {
  assert.equal(r.status, status, JSON.stringify(r.json));
  assert.equal(r.json?.error?.code, code);
}

async function withApp(fn: (app: TestApp) => Promise<void>, options: Parameters<typeof startTestApp>[0] = {}) {
  const app = await startTestApp(options);
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

let ipSeq = 0;
const ip = () => `203.0.113.${(++ipSeq % 250) + 1}`;

describe('CSRF and request boundaries', () => {
  test('login/register require a valid pre-login token bound to the pre-session cookie', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const c = new Client(app, ip());
      expectCode(await c.request('POST', '/api/v1/auth/login', { body: { username: t.username, password: t.password } }), 403, 'CSRF_FAILED');
      await c.preLogin();
      const other = new Client(app, ip());
      await other.preLogin();
      // A token bound to another browser's pre-session cookie is useless.
      expectCode(await c.request('POST', '/api/v1/auth/login', { body: { username: t.username, password: t.password }, csrf: other.csrf }), 403, 'CSRF_FAILED');
      // Expired pre-login token.
      app.clock.advance(11 * MIN);
      expectCode(await c.request('POST', '/api/v1/auth/login', { body: { username: t.username, password: t.password } }), 403, 'CSRF_FAILED');
      expectCode(await c.request('POST', '/api/v1/auth/register', { body: { username: 'abc.def', password: 'x' } }), 400, 'VALIDATION_FAILED');
      assert.equal((await c.login(t.username, t.password)).status, 200);
    }));

  test('authenticated mutations need the session-bound token: missing, pre-login, and other-session tokens fail', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const a = new Client(app, ip());
      const preLoginToken = await a.preLogin();
      await a.login(t.username, t.password);
      const b = new Client(app, ip());
      await b.login(t.username, t.password);
      const body = { currentPassword: t.password, newPassword: 'Another-Fixture-Pass-1' };
      expectCode(await a.request('POST', '/api/v1/auth/password', { body, csrf: null }), 403, 'CSRF_FAILED');
      expectCode(await a.request('POST', '/api/v1/auth/password', { body, csrf: preLoginToken }), 403, 'CSRF_FAILED');
      expectCode(await a.request('POST', '/api/v1/auth/password', { body, csrf: b.csrf }), 403, 'CSRF_FAILED');
      expectCode(await a.request('POST', '/api/v1/auth/logout', { body: {}, csrf: b.csrf }), 403, 'CSRF_FAILED');
      assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE user_id = ?', t.id), 2, 'nothing was revoked');
      assert.notEqual(a.csrf, b.csrf);
      // /auth/csrf returns the session-bound token once logged in.
      const csrf = await a.request('GET', '/api/v1/auth/csrf');
      assert.equal(csrf.json.authenticated, true);
      assert.equal(csrf.json.csrfToken, a.csrf);
      assert.match(csrf.json.preLoginToken, /^p1\./);
      assert.notEqual(csrf.json.preLoginToken, a.csrf);
      // The pre-login token never authorizes an authenticated mutation.
      expectCode(await a.request('POST', '/api/v1/auth/logout', { body: {}, csrf: csrf.json.preLoginToken }), 403, 'CSRF_FAILED');
      const anon = await new Client(app, ip()).request('GET', '/api/v1/auth/csrf');
      assert.equal(anon.json.authenticated, false);
      assert.equal(anon.json.csrfToken, null);
    }));

  test('cross-origin, missing Origin, cross-site fetch metadata, wrong Host and unsupported content types are refused', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const c = new Client(app, ip());
      await c.preLogin();
      const body = { username: t.username, password: t.password };
      expectCode(await c.request('POST', '/api/v1/auth/login', { body, noOrigin: true }), 403, 'ORIGIN_REJECTED');
      expectCode(await c.request('POST', '/api/v1/auth/login', { body, headers: { Origin: 'https://evil.example' } }), 403, 'ORIGIN_REJECTED');
      expectCode(await c.request('POST', '/api/v1/auth/login', { body, headers: { Origin: 'http://alkhayr.test.evil.example' } }), 403, 'ORIGIN_REJECTED');
      expectCode(await c.request('POST', '/api/v1/auth/login', { body, headers: { Origin: 'null' } }), 403, 'ORIGIN_REJECTED');
      expectCode(await c.request('POST', '/api/v1/auth/login', { body, headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403, 'ORIGIN_REJECTED');
      expectCode(await c.request('POST', '/api/v1/auth/login', { body, headers: { 'Sec-Fetch-Site': 'same-site' } }), 403, 'ORIGIN_REJECTED');
      expectCode(await c.request('GET', '/api/v1/auth/me', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403, 'ORIGIN_REJECTED');
      expectCode(await c.request('POST', '/api/v1/auth/login', { body, headers: { Host: 'evil.example' } }), 400, 'HOST_REJECTED');
      expectCode(await c.request('POST', '/api/v1/auth/login', { rawBody: 'username=a&password=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), 415, 'UNSUPPORTED_MEDIA_TYPE');
      expectCode(await c.request('POST', '/api/v1/auth/login', { rawBody: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' } }), 415, 'UNSUPPORTED_MEDIA_TYPE');
      expectCode(await c.request('POST', '/api/v1/auth/login', { rawBody: JSON.stringify({ ...body, pad: 'x'.repeat(9000) }) }), 413, 'PAYLOAD_TOO_LARGE');
      // A same-origin GET without Origin is fine.
      assert.equal((await c.request('GET', '/api/v1/auth/csrf', { headers: { 'Sec-Fetch-Site': undefined } })).status, 200);
      const ok = await c.login(t.username, t.password);
      assert.equal(ok.status, 200);
      assert.equal(ok.headers['access-control-allow-origin'], undefined);
      assert.equal(ok.headers['access-control-allow-credentials'], undefined);
    }));

  test('forged identity and role headers are ignored', () =>
    withApp(async (app) => {
      const pending = await createTrader(app, { status: 'pending' });
      const c = new Client(app, ip());
      const forged = { 'X-User-Role': 'admin', 'X-Merchant-Id': 'x', 'X-OpenAI-User-Id': 'u', 'OpenAI-Ephemeral-User-Id': 'u', 'X-Authenticated-User': 'admin', Authorization: 'Bearer admin' };
      expectCode(await c.request('GET', '/api/v1/auth/me', { headers: forged }), 401, 'UNAUTHENTICATED');
      await c.login(pending.username, pending.password);
      const me = await c.request('GET', '/api/v1/auth/me', { headers: forged });
      assert.equal(me.json.user.role, 'trader');
      assert.equal(me.json.merchant.status, 'pending');
    }));
});

describe('abuse limits before expensive work', () => {
  test('per-account login limit: attempts beyond the limit are refused with Retry-After and cause NO hashing', () =>
    withApp(
      async (app) => {
        const hasher = app.hasher as GatedHasher;
        const t = await createTrader(app);
        for (let i = 0; i < 5; i++) expectCode(await new Client(app, ip()).login(t.username, 'Wrong-Password-000'), 401, 'INVALID_CREDENTIALS');
        const before = hasher.verifyCalls + hasher.dummyCalls;
        const limited = await new Client(app, ip()).login(t.username, t.password);
        expectCode(limited, 429, 'RATE_LIMITED');
        assert.equal(limited.headers['retry-after'], String(15 * 60));
        assert.equal(hasher.verifyCalls + hasher.dummyCalls, before, 'no scrypt work for rate-limited attempts');
        // Unknown usernames are limited the same way (no existence oracle).
        for (let i = 0; i < 5; i++) await new Client(app, ip()).login('ghost.user', 'Wrong-Password-000');
        expectCode(await new Client(app, ip()).login('ghost.user', 'Wrong-Password-000'), 429, 'RATE_LIMITED');
        app.clock.advance(15 * MIN);
        assert.equal((await new Client(app, ip()).login(t.username, t.password)).status, 200);
      },
      { hasher: new GatedHasher() },
    ));

  test('per-IP login and registration limits; successful login resets the account counter', () =>
    withApp(async (app) => {
      const c = new Client(app, '198.18.0.1');
      for (let i = 0; i < 20; i++) await c.login(`user.${i}`, 'Wrong-Password-000');
      expectCode(await c.login('user.99', 'Wrong-Password-000'), 429, 'RATE_LIMITED');
      expectCode(await new Client(app, '198.18.0.1').login('user.100', 'x'), 429, 'RATE_LIMITED');
      assert.notEqual((await new Client(app, '198.18.0.2').login('user.100', 'Wrong-Password-000')).status, 429);
      const r = new Client(app, '198.18.0.3');
      await r.preLogin();
      for (let i = 0; i < 5; i++) {
        const res = await r.request('POST', '/api/v1/auth/register', { body: { username: `reg.${i}`, password: 'Registration-Pass-1', businessName: 'محل', contactName: 'أحمد', phone: '01012345678', governorate: 'القاهرة', address: '12 شارع النيل' } });
        assert.equal(res.status, 202);
      }
      expectCode(await r.request('POST', '/api/v1/auth/register', { body: { username: 'reg.x', password: 'Registration-Pass-1', businessName: 'محل', contactName: 'أحمد', phone: '01012345678', governorate: 'القاهرة', address: '12 شارع النيل' } }), 429, 'RATE_LIMITED');
      const t = await createTrader(app);
      for (let i = 0; i < 4; i++) await new Client(app, ip()).login(t.username, 'Wrong-Password-000');
      assert.equal((await new Client(app, ip()).login(t.username, t.password)).status, 200);
      for (let i = 0; i < 4; i++) expectCode(await new Client(app, ip()).login(t.username, 'Wrong-Password-000'), 401, 'INVALID_CREDENTIALS');
    }));

  test('general API limit per IP', () =>
    withApp(
      async (app) => {
        const c = new Client(app, '198.18.1.1');
        for (let i = 0; i < 10; i++) assert.equal((await c.request('GET', '/api/v1/auth/csrf')).status, 200);
        const r = await c.request('GET', '/api/v1/auth/csrf');
        expectCode(r, 429, 'RATE_LIMITED');
        assert.ok(Number(r.headers['retry-after']) > 0);
        assert.equal((await new Client(app, '198.18.1.2').request('GET', '/api/v1/auth/csrf')).status, 200);
      },
      { rules: { api_ip: { limit: 10, windowMs: MIN } } },
    ));

  test('hashing overload is refused with 503 + Retry-After instead of queueing without bound', () =>
    withApp(
      async (app) => {
        const t = await createTrader(app);
        const results = await Promise.all(Array.from({ length: 6 }, () => new Client(app, ip()).login(t.username, t.password)));
        const statuses = results.map((r) => r.status).sort();
        assert.ok(statuses.includes(503), statuses.join(','));
        const busy = results.find((r) => r.status === 503)!;
        expectCode(busy, 503, 'UNAVAILABLE');
        assert.equal(busy.headers['retry-after'], '5');
        assert.ok(statuses.includes(200));
      },
      // Reference work factor (≈350 ms per hash) so the concurrent requests really overlap.
      { hasher: new PasswordHasher({ maxConcurrent: 1, maxQueue: 1 }) },
    ));

  test('unknown users run a full dummy verification at the configured work factor', () =>
    withApp(
      async (app) => {
        const hasher = app.hasher as GatedHasher;
        await new Client(app, ip()).login('nobody.here', 'Some-Password-123');
        assert.equal(hasher.dummyCalls, 1);
        assert.equal(hasher.verifyCalls, 0);
      },
      { hasher: new GatedHasher() },
    ));
});

describe('proxy trust', () => {
  const ipHmacOf = (app: TestApp, addr: string) => createHmac('sha256', app.keys.ip).update(addr).digest('hex');

  test('X-Forwarded-For is used only from a trusted proxy', async () => {
    await withApp(async (app) => {
      const t = await createTrader(app);
      await new Client(app, '192.0.2.77').login(t.username, t.password);
      const row = app.fixtureDb.prepare("SELECT ip_hmac FROM audit_logs WHERE action = 'auth.login' ORDER BY id DESC").get() as any;
      assert.equal(row.ip_hmac, ipHmacOf(app, '192.0.2.77'));
    }, { trustProxy: '127.0.0.1' });
    await withApp(async (app) => {
      const t = await createTrader(app);
      await new Client(app, '192.0.2.77').login(t.username, t.password);
      const row = app.fixtureDb.prepare("SELECT ip_hmac FROM audit_logs WHERE action = 'auth.login' ORDER BY id DESC").get() as any;
      assert.equal(row.ip_hmac, ipHmacOf(app, '127.0.0.1'), 'spoofed header ignored without a trusted proxy');
      // ...so rotating spoofed addresses does not escape the per-IP limit.
      for (let i = 0; i < 20; i++) await new Client(app, `192.0.2.${i}`).login(`x.${i}`, 'Wrong-Password-000');
      expectCode(await new Client(app, '192.0.2.200').login('x.200', 'Wrong-Password-000'), 429, 'RATE_LIMITED');
    }, { trustProxy: '' });
  });
});

describe('administrator TOTP replay', () => {
  test('the same code cannot be used twice; the enrollment step is a replay baseline', () =>
    withApp(async (app) => {
      const step = Math.floor(app.clock.now() / 30_000);
      const a = await createAdmin(app, { lastOtpStep: step });
      expectCode(await new Client(app, ip()).login(a.username, a.password, a.code()), 401, 'INVALID_CREDENTIALS');
      const ok = await new Client(app, ip()).login(a.username, a.password, a.code(1));
      assert.equal(ok.status, 200, 'the next period’s code (±1 window) is accepted');
      expectCode(await new Client(app, ip()).login(a.username, a.password, a.code(1)), 401, 'INVALID_CREDENTIALS');
      app.clock.advance(60_000);
      assert.equal((await new Client(app, ip()).login(a.username, a.password, a.code())).status, 200);
      assert.ok(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'auth.login_failed' AND metadata LIKE '%mfa_failed%'") >= 2);
    }));

  test('two concurrent logins with the same code: exactly one succeeds', () =>
    withApp(
      async (app) => {
        const hasher = app.hasher as GatedHasher;
        const a = await createAdmin(app);
        const code = a.code();
        const arrived = hasher.pause();
        const c1 = new Client(app, ip());
        const c2 = new Client(app, ip());
        await Promise.all([c1.preLogin(), c2.preLogin()]);
        const p1 = c1.request('POST', '/api/v1/auth/login', { body: { username: a.username, password: a.password, totp: code } });
        const p2 = c2.request('POST', '/api/v1/auth/login', { body: { username: a.username, password: a.password, totp: code } });
        await arrived;
        await new Promise((r) => setTimeout(r, 50)); // let the second request reach the gate too
        hasher.release();
        const statuses = [(await p1).status, (await p2).status].sort();
        assert.deepEqual(statuses, [200, 401]);
        assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE user_id = ?', a.id), 1);
        assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'auth.login_failed' AND metadata LIKE '%otp_replay%'"), 1);
      },
      { hasher: new GatedHasher() },
    ));
});

describe('races between verification and commit', () => {
  test('a password reset during login invalidates the verification (no session)', () =>
    withApp(
      async (app) => {
        const hasher = app.hasher as GatedHasher;
        const t = await createTrader(app);
        const c = new Client(app, ip());
        await c.preLogin();
        const arrived = hasher.pause();
        const pending = c.request('POST', '/api/v1/auth/login', { body: { username: t.username, password: t.password } });
        await arrived;
        // Operator reset (stage 15 will provide this) — simulated directly.
        app.fixtureDb.prepare('UPDATE auth_users SET password_hash = ?, password_changed_at = password_changed_at + 1 WHERE id = ?').run(await new PasswordHasher({ params: CHEAP_PARAMS }).hash('Operator-Reset-Pass-1'), t.id);
        hasher.release();
        expectCode(await pending, 401, 'INVALID_CREDENTIALS');
        assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE user_id = ?', t.id), 0);
        assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE metadata LIKE '%stale_credentials%'"), 1);
      },
      { hasher: new GatedHasher() },
    ));

  test('a suspension during login prevents the session', () =>
    withApp(
      async (app) => {
        const hasher = app.hasher as GatedHasher;
        const t = await createTrader(app);
        const c = new Client(app, ip());
        await c.preLogin();
        const arrived = hasher.pause();
        const pending = c.request('POST', '/api/v1/auth/login', { body: { username: t.username, password: t.password } });
        await arrived;
        app.fixtureDb.prepare("UPDATE merchants SET status = 'suspended', version = version + 1 WHERE id = ?").run(t.merchantId);
        hasher.release();
        expectCode(await pending, 401, 'INVALID_CREDENTIALS');
        assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE user_id = ?', t.id), 0);
      },
      { hasher: new GatedHasher() },
    ));

  test('two concurrent password changes: one wins, the stale one cannot overwrite it', () =>
    withApp(
      async (app) => {
        const hasher = app.hasher as GatedHasher;
        const t = await createTrader(app);
        const a = new Client(app, ip());
        const b = new Client(app, ip());
        await a.login(t.username, t.password);
        await b.login(t.username, t.password);
        const arrived = hasher.pause();
        const pa = a.request('POST', '/api/v1/auth/password', { body: { currentPassword: t.password, newPassword: 'Winner-New-Passphrase-1' } });
        const pb = b.request('POST', '/api/v1/auth/password', { body: { currentPassword: t.password, newPassword: 'Loser-New-Passphrase-22' } });
        await arrived;
        await new Promise((r) => setTimeout(r, 50));
        hasher.release();
        const [ra, rb] = [await pa, await pb];
        const statuses = [ra.status, rb.status].sort();
        assert.equal(statuses[0], 200, `${ra.body} ${rb.body}`);
        assert.ok([401, 409].includes(statuses[1]!), `loser got ${statuses[1]}`);
        const winner = ra.status === 200 ? 'Winner-New-Passphrase-1' : 'Loser-New-Passphrase-22';
        const loser = ra.status === 200 ? 'Loser-New-Passphrase-22' : 'Winner-New-Passphrase-1';
        assert.equal((await new Client(app, ip()).login(t.username, winner)).status, 200);
        expectCode(await new Client(app, ip()).login(t.username, loser), 401, 'INVALID_CREDENTIALS');
      },
      { hasher: new GatedHasher() },
    ));

  test('a logout during password change: the stale verification does not change the password', () =>
    withApp(
      async (app) => {
        const hasher = app.hasher as GatedHasher;
        const t = await createTrader(app);
        const c = new Client(app, ip());
        await c.login(t.username, t.password);
        const arrived = hasher.pause();
        const pending = c.request('POST', '/api/v1/auth/password', { body: { currentPassword: t.password, newPassword: 'Should-Not-Apply-123' } });
        await arrived;
        app.fixtureDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id);
        hasher.release();
        expectCode(await pending, 401, 'UNAUTHENTICATED');
        assert.equal((await new Client(app, ip()).login(t.username, t.password)).status, 200, 'old password still valid');
      },
      { hasher: new GatedHasher() },
    ));
});

describe('sessions', () => {
  test('idle timeouts: trader 30 min, admin 15 min; activity extends; absolute 8 h; never revived', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const a = await createAdmin(app);
      const tc = new Client(app, ip());
      const ac = new Client(app, ip());
      await tc.login(t.username, t.password);
      await ac.login(a.username, a.password, a.code());
      app.clock.advance(14 * MIN);
      assert.equal((await ac.request('GET', '/api/v1/auth/me')).status, 200);
      app.clock.advance(15 * MIN);
      expectCode(await ac.request('GET', '/api/v1/auth/me'), 401, 'UNAUTHENTICATED');
      assert.equal((await tc.request('GET', '/api/v1/auth/me')).status, 200, 'trader still within 30 min of last activity (29 min)');
      // Keep the trader active every 20 minutes up to the absolute limit.
      for (let elapsed = 29; elapsed + 20 < 8 * 60; elapsed += 20) {
        app.clock.advance(20 * MIN);
        assert.equal((await tc.request('GET', '/api/v1/auth/me')).status, 200, `at ${elapsed + 20} min`);
      }
      app.clock.set(app.clock.now() + 30 * MIN);
      expectCode(await tc.request('GET', '/api/v1/auth/me'), 401, 'UNAUTHENTICATED');
      assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE user_id IN (?, ?)', t.id, a.id), 0, 'expired sessions are deleted');
    }));

  test('an idle-expired session is not revived by a later request or touch', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const c = new Client(app, ip());
      await c.login(t.username, t.password);
      const token = c.sessionToken()!;
      app.clock.advance(31 * MIN);
      app.fixtureDb.prepare('UPDATE sessions SET expires_at = expires_at').run(); // no-op write; row still present
      expectCode(await c.request('GET', '/api/v1/auth/me'), 401, 'UNAUTHENTICATED');
      app.clock.advance(-30 * MIN); // even if the clock went back, the row is gone
      const replay = new Client(app, ip());
      replay.cookies.set('alkhayr_session', token);
      expectCode(await replay.request('GET', '/api/v1/auth/me'), 401, 'UNAUTHENTICATED');
    }));

  test('at most 5 sessions per account, also under concurrent logins; oldest are evicted', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const first = new Client(app, ip());
      await first.login(t.username, t.password);
      app.clock.advance(1000);
      const clients = Array.from({ length: 7 }, () => new Client(app, ip()));
      await Promise.all(clients.map((c) => c.preLogin()));
      const results = await Promise.all(clients.map((c) => c.request('POST', '/api/v1/auth/login', { body: { username: t.username, password: t.password } })));
      assert.ok(results.every((r) => r.status === 200));
      assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE user_id = ?', t.id), 5);
      expectCode(await first.request('GET', '/api/v1/auth/me'), 401, 'UNAUTHENTICATED');
    }));

  test('fixation: a planted or previous session id is destroyed at login and replaced by a new one', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const attacker = await createTrader(app);
      const atk = new Client(app, ip());
      await atk.login(attacker.username, attacker.password);
      const planted = atk.sessionToken()!;
      const victim = new Client(app, ip());
      victim.cookies.set('alkhayr_session', planted);
      await victim.login(t.username, t.password);
      assert.notEqual(victim.sessionToken(), planted);
      assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE token_hash = ?', hashSessionToken(planted)), 0, 'presented session destroyed');
      const me = await victim.request('GET', '/api/v1/auth/me');
      assert.equal(me.json.user.id, t.id);
      // Arbitrary attacker-chosen token values are never accepted.
      const forged = new Client(app, ip());
      forged.cookies.set('alkhayr_session', 'A'.repeat(43));
      expectCode(await forged.request('GET', '/api/v1/auth/me'), 401, 'UNAUTHENTICATED');
      // Duplicate session cookies (cookie tossing) are treated as no session.
      const tossed = await victim.request('GET', '/api/v1/auth/me', { headers: { Cookie: `alkhayr_session=${victim.sessionToken()}; alkhayr_session=${planted}` } });
      expectCode(tossed, 401, 'UNAUTHENTICATED');
    }));

  test('logout reports failure (and keeps the cookie) when revocation cannot be committed', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const c = new Client(app, ip());
      await c.login(t.username, t.password);
      app.fixtureDb.exec("CREATE TRIGGER test_block_session_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END");
      const failed = await c.request('POST', '/api/v1/auth/logout', { body: {} });
      assert.equal(failed.status, 500);
      assert.equal(failed.json.loggedOut, undefined);
      assert.equal(failed.setCookies.some((x) => x.startsWith('alkhayr_session=;')), false, 'cookie not cleared on failure');
      assert.equal((await c.request('GET', '/api/v1/auth/me')).status, 200, 'session still valid: failure was reported honestly');
      app.fixtureDb.exec('DROP TRIGGER test_block_session_delete');
      assert.equal((await c.request('POST', '/api/v1/auth/logout', { body: {} })).status, 200);
      expectCode(await c.request('GET', '/api/v1/auth/me'), 401, 'UNAUTHENTICATED');
    }));
});

describe('authorization guards (exercised through TEST-ONLY routes)', () => {
  test('approval, suspension, admin recency and ownership are checked against current database state', () =>
    withApp(async (app) => {
      app.router.get('/api/v1/__test/approved', (ctx) => {
        const auth = requireSession(ctx);
        requireApproved(auth);
        sendJson(ctx.res, 200, { ok: true });
      });
      app.router.add('POST', '/api/v1/__test/admin-action', async (ctx) => {
        await readJsonBody(ctx.req);
        const auth = requireSession(ctx);
        requireSessionCsrf(ctx, auth);
        requireRecentAdminAuth(ctx, auth);
        sendJson(ctx.res, 200, { ok: true });
      });
      app.router.get('/api/v1/__test/merchant/:id', (ctx) => {
        const auth = requireSession(ctx);
        requireOwnMerchant(auth, ctx.params.id!);
        sendJson(ctx.res, 200, { ok: true });
      });

      const pending = await createTrader(app, { status: 'pending' });
      const approved = await createTrader(app, { status: 'approved' });
      const other = await createTrader(app, { status: 'approved' });
      const admin = await createAdmin(app);
      const p = new Client(app, ip());
      const t = new Client(app, ip());
      const ad = new Client(app, ip());
      await p.login(pending.username, pending.password);
      await t.login(approved.username, approved.password);
      await ad.login(admin.username, admin.password, admin.code());

      expectCode(await new Client(app, ip()).request('GET', '/api/v1/__test/approved'), 401, 'UNAUTHENTICATED');
      expectCode(await p.request('GET', '/api/v1/__test/approved'), 403, 'ACCOUNT_PENDING');
      assert.equal((await t.request('GET', '/api/v1/__test/approved')).status, 200);

      // Approval is read live: approving the pending merchant takes effect on the next request.
      app.fixtureDb.prepare("UPDATE merchants SET status = 'approved', version = version + 1 WHERE id = ?").run(pending.merchantId);
      assert.equal((await p.request('GET', '/api/v1/__test/approved')).status, 200);
      // Suspension removes effective access immediately, even with an unexpired session.
      app.fixtureDb.prepare("UPDATE merchants SET status = 'suspended', version = version + 1 WHERE id = ?").run(approved.merchantId);
      expectCode(await t.request('GET', '/api/v1/__test/approved'), 401, 'UNAUTHENTICATED');
      expectCode(await t.request('GET', '/api/v1/auth/me'), 401, 'UNAUTHENTICATED');
      assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE user_id = ?', approved.id), 0);

      expectCode(await p.request('POST', '/api/v1/__test/admin-action', { body: {} }), 403, 'FORBIDDEN');
      expectCode(await p.request('POST', '/api/v1/__test/admin-action', { body: {}, headers: { 'X-User-Role': 'admin' } }), 403, 'FORBIDDEN');
      assert.equal((await ad.request('POST', '/api/v1/__test/admin-action', { body: {} })).status, 200);
      app.clock.advance(14 * MIN);
      await ad.request('GET', '/api/v1/auth/me'); // stays active, but credentials are now 14+ min old
      app.clock.advance(2 * MIN);
      const stale = await ad.request('POST', '/api/v1/__test/admin-action', { body: {} });
      expectCode(stale, 428, 'RECENT_AUTH_REQUIRED');
      app.clock.advance(30_000);
      await ad.login(admin.username, admin.password, admin.code());
      assert.equal((await ad.request('POST', '/api/v1/__test/admin-action', { body: {} })).status, 200, 're-login restores recency');

      assert.equal((await p.request('GET', `/api/v1/__test/merchant/${pending.merchantId}`)).status, 200);
      expectCode(await p.request('GET', `/api/v1/__test/merchant/${other.merchantId}`), 404, 'NOT_FOUND');
    }));
});

describe('stage boundary', () => {
  test('no catalog, order or admin business endpoints exist yet', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const c = new Client(app, ip());
      await c.login(t.username, t.password);
      for (const p of ['/api/v1/products', '/api/v1/orders', '/api/v1/admin/merchants', '/api/v1/merchant/profile']) {
        expectCode(await c.request('GET', p), 404, 'NOT_FOUND');
      }
    }));
});
