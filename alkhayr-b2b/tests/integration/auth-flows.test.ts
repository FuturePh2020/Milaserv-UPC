import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { hashSessionToken } from '../../src/server/auth/sessions.ts';
import { Client, count, createAdmin, createTrader, PROFILE, startTestApp, type TestApp } from '../helpers/app.ts';

// All accounts and passwords below are synthetic test fixtures.
const NEW_PASSWORD = 'New-Trader-Passphrase-2026';

let app: TestApp;
let ipSeq = 0;
const client = () => new Client(app, `198.51.100.${++ipSeq}`);

before(async () => {
  app = await startTestApp();
});
after(async () => app.close());

function assertEnvelope(r: { status: number; json: any; headers: Record<string, unknown> }, status: number, code: string) {
  assert.equal(r.status, status, JSON.stringify(r.json));
  assert.equal(r.json?.error?.code, code);
  assert.match(r.json.error.message, /[؀-ۿ]/);
  assert.equal(r.json.error.requestId, r.headers['x-request-id']);
}

const registration = (username: string, extra: Record<string, unknown> = {}) => ({ username, password: 'Trader-Registration-01', ...PROFILE, ...extra });

describe('registration', () => {
  test('creates only a pending trader with its company profile, atomically, with an audit event', async () => {
    const c = client();
    await c.preLogin();
    const r = await c.request('POST', '/api/v1/auth/register', { body: registration('New.Trader') });
    assert.equal(r.status, 202);
    assert.equal(r.json.status, 'received');
    assert.match(r.json.message, /لم تُرسل أي رسائل تأكيد/);
    assert.equal(r.setCookies.some((s) => s.startsWith('alkhayr_session=')), false, 'registration does not log in');
    const u = app.fixtureDb.prepare("SELECT u.role, u.username, u.totp_ciphertext, m.status FROM auth_users u JOIN merchants m ON m.user_id = u.id WHERE u.username = 'new.trader'").get() as any;
    assert.deepEqual({ ...u }, { role: 'trader', username: 'new.trader', totp_ciphertext: null, status: 'pending' });
    assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'auth.register'"), 1);
  });

  test('role/status/id/security fields are rejected (mass assignment)', async () => {
    for (const extra of [{ role: 'admin' }, { status: 'approved' }, { userId: '00000000-0000-4000-8000-000000000000' }, { merchantId: 'x' }, { totp: '123456' }, { passwordHash: 'x' }, { isAdmin: true }]) {
      const c = client();
      await c.preLogin();
      const r = await c.request('POST', '/api/v1/auth/register', { body: registration(`mass.${Object.keys(extra)[0]!.toLowerCase()}`, extra) });
      assertEnvelope(r, 400, 'VALIDATION_FAILED');
    }
    assert.equal(count(app, "SELECT count(*) FROM auth_users WHERE username LIKE 'mass.%'"), 0);
    assert.equal(count(app, "SELECT count(*) FROM auth_users WHERE role = 'admin'"), 0);
  });

  test('business details and password policy are validated consistently (Arabic field messages)', async () => {
    const c = client();
    await c.preLogin();
    const bad = await c.request('POST', '/api/v1/auth/register', { body: registration('valid.name', { phone: '123', address: 'x' }) });
    assertEnvelope(bad, 400, 'VALIDATION_FAILED');
    assert.deepEqual(bad.json.error.details.fields.map((f: any) => f.path).sort(), ['address', 'phone']);
    const weak = await c.request('POST', '/api/v1/auth/register', { body: registration('valid.name', { password: 'short' }) });
    assertEnvelope(weak, 400, 'VALIDATION_FAILED');
    assert.match(weak.json.error.details.fields[0].message, /12/);
    assert.ok(!weak.body.includes('short'), 'the submitted password is never echoed');
  });

  test('a duplicate username gets the identical generic response; the original account is untouched', async () => {
    const existing = await createTrader(app, { username: 'dup.trader' });
    const before = app.fixtureDb.prepare("SELECT password_hash FROM auth_users WHERE username = 'dup.trader'").get() as any;
    const c = client();
    await c.preLogin();
    const fresh = await c.request('POST', '/api/v1/auth/register', { body: registration('fresh.trader') });
    const dup = await c.request('POST', '/api/v1/auth/register', { body: registration('DUP.Trader') });
    assert.equal(dup.status, fresh.status);
    assert.deepEqual(dup.json, fresh.json);
    assert.equal((app.fixtureDb.prepare("SELECT password_hash FROM auth_users WHERE username = 'dup.trader'").get() as any).password_hash, before.password_hash);
    assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'auth.register_duplicate' AND target_id = ?", existing.id), 1);
  });
});

describe('login, me, logout', () => {
  test('trader login issues a hash-only session; /me returns the safe profile and approval state', async () => {
    const t = await createTrader(app, { status: 'approved' });
    const c = client();
    const r = await c.login(t.username, t.password);
    assert.equal(r.status, 200, r.body);
    assert.deepEqual(r.json.user, { id: t.id, username: t.username, role: 'trader' });
    assert.equal(r.json.merchant.status, 'approved');
    assert.match(r.json.csrfToken, /^s1\./);
    const token = c.sessionToken()!;
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(!r.body.includes(token), 'raw session token never appears in JSON');
    assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE token_hash = ?', hashSessionToken(token)), 1);
    assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE token_hash = ?', token), 0);
    const me = await c.request('GET', '/api/v1/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.merchant.status, 'approved');
    assert.equal(me.json.merchant.businessName, PROFILE.businessName);
    assert.equal(me.json.session.recentAuthUntil, null);
    for (const secret of ['password_hash', 'passwordHash', 'totp', 'token_hash', t.password]) assert.ok(!me.body.includes(secret), secret);
  });

  test('pending trader can log in and see their pending state', async () => {
    const t = await createTrader(app, { status: 'pending' });
    const c = client();
    assert.equal((await c.login(t.username, t.password)).status, 200);
    const me = await c.request('GET', '/api/v1/auth/me');
    assert.equal(me.json.merchant.status, 'pending');
  });

  test('administrator login requires password AND a valid TOTP code', async () => {
    const a = await createAdmin(app);
    const c = client();
    assertEnvelope(await c.login(a.username, a.password), 401, 'INVALID_CREDENTIALS');
    assertEnvelope(await c.login(a.username, a.password, '000000'), 401, 'INVALID_CREDENTIALS');
    const ok = await c.login(a.username, a.password, a.code());
    assert.equal(ok.status, 200, ok.body);
    assert.equal(ok.json.user.role, 'admin');
    const me = await c.request('GET', '/api/v1/auth/me');
    assert.equal(me.json.session.recentAuthUntil, app.clock.now() + 15 * 60_000);
  });

  test('every login failure looks identical (unknown, wrong password, suspended, missing MFA)', async () => {
    const t = await createTrader(app);
    const s = await createTrader(app, { status: 'suspended' });
    const a = await createAdmin(app);
    const cases: Array<[string, string, string?]> = [
      ['no.such.user', 'Whatever-Password-1'],
      ['x', 'Whatever-Password-1'],
      [t.username, 'Wrong-Password-12345'],
      [s.username, s.password],
      [a.username, a.password],
      [a.username, 'Wrong-Admin-Password-1', a.code()],
    ];
    const bodies = new Set<string>();
    for (const [u, p, code] of cases) {
      const r = await client().login(u, p, code);
      assertEnvelope(r, 401, 'INVALID_CREDENTIALS');
      bodies.add(JSON.stringify({ ...r.json, error: { ...r.json.error, requestId: '-' } }));
      assert.equal(r.setCookies.some((x) => x.startsWith('alkhayr_session=') && !/Max-Age=0/.test(x)), false);
    }
    assert.equal(bodies.size, 1, 'one generic body for all failure causes');
    assert.ok(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'auth.login_failed'") >= cases.length);
  });

  test('logout revokes the server session and expires the cookie; the old token is useless', async () => {
    const t = await createTrader(app);
    const c = client();
    await c.login(t.username, t.password);
    const token = c.sessionToken()!;
    const out = await c.request('POST', '/api/v1/auth/logout', { body: {} });
    assert.equal(out.status, 200);
    assert.ok(out.setCookies.some((x) => x.startsWith('alkhayr_session=;') && /Max-Age=0/.test(x)));
    assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE token_hash = ?', hashSessionToken(token)), 0);
    const replay = new Client(app, c.ip);
    replay.cookies.set('alkhayr_session', token);
    assertEnvelope(await replay.request('GET', '/api/v1/auth/me'), 401, 'UNAUTHENTICATED');
    assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'auth.logout' AND actor_user_id = ?", t.id), 1);
  });
});

describe('password change', () => {
  test('requires the current password; then revokes ALL sessions of the account', async () => {
    const t = await createTrader(app);
    const devices = [client(), client(), client()];
    for (const d of devices) assert.equal((await d.login(t.username, t.password)).status, 200);
    assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE user_id = ?', t.id), 3);
    const [a] = devices as [Client, Client, Client];
    assertEnvelope(await a.request('POST', '/api/v1/auth/password', { body: { currentPassword: 'Not-The-Password-1', newPassword: NEW_PASSWORD } }), 403, 'REAUTH_FAILED');
    assertEnvelope(await a.request('POST', '/api/v1/auth/password', { body: { currentPassword: t.password, newPassword: 'short' } }), 400, 'VALIDATION_FAILED');
    const ok = await a.request('POST', '/api/v1/auth/password', { body: { currentPassword: t.password, newPassword: NEW_PASSWORD } });
    assert.equal(ok.status, 200, ok.body);
    assert.deepEqual(ok.json, { passwordChanged: true, sessionsRevoked: 3, reloginRequired: true });
    assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE user_id = ?', t.id), 0);
    for (const d of devices) assertEnvelope(await d.request('GET', '/api/v1/auth/me'), 401, 'UNAUTHENTICATED');
    assertEnvelope(await client().login(t.username, t.password), 401, 'INVALID_CREDENTIALS');
    assert.equal((await client().login(t.username, NEW_PASSWORD)).status, 200);
    const audit = app.fixtureDb.prepare("SELECT metadata FROM audit_logs WHERE action = 'auth.password_changed' AND actor_user_id = ?").get(t.id) as any;
    assert.deepEqual(JSON.parse(audit.metadata), { sessions_revoked: 3 });
  });

  test('administrators need a fresh TOTP; a code already used for login is refused', async () => {
    const a = await createAdmin(app);
    const c = client();
    const loginCode = a.code();
    await c.login(a.username, a.password, loginCode);
    assertEnvelope(await c.request('POST', '/api/v1/auth/password', { body: { currentPassword: a.password, newPassword: 'Brand-New-Admin-Passphrase' } }), 403, 'REAUTH_FAILED');
    assertEnvelope(await c.request('POST', '/api/v1/auth/password', { body: { currentPassword: a.password, newPassword: 'Brand-New-Admin-Passphrase', totp: loginCode } }), 403, 'REAUTH_FAILED');
    assertEnvelope(await c.request('POST', '/api/v1/auth/password', { body: { currentPassword: a.password, newPassword: 'short-admin-pw', totp: a.code(1) } }), 400, 'VALIDATION_FAILED');
    app.clock.advance(30_000);
    const ok = await c.request('POST', '/api/v1/auth/password', { body: { currentPassword: a.password, newPassword: 'Brand-New-Admin-Passphrase', totp: a.code() } });
    assert.equal(ok.status, 200, ok.body);
  });
});

describe('secret-free responses and logs', () => {
  test('no password, hash, token, CSRF token, TOTP code or secret appears in logs; audit rows hold no credentials', async () => {
    const a = await createAdmin(app);
    const c = client();
    const code = a.code(1);
    app.clock.advance(30_000);
    const r = await c.login(a.username, a.password, code);
    assert.equal(r.status, 200);
    await c.request('GET', '/api/v1/auth/me');
    const logText = app.logs.join('\n');
    const auditText = JSON.stringify(app.fixtureDb.prepare('SELECT * FROM audit_logs').all());
    const hash = (app.fixtureDb.prepare('SELECT password_hash FROM auth_users WHERE id = ?').get(a.id) as any).password_hash;
    for (const secret of [a.password, hash, c.sessionToken()!, r.json.csrfToken, code, a.secret.toString('hex'), app.config.appSecret!.toString('base64url'), c.ip!]) {
      assert.ok(!logText.includes(secret), `log contains ${String(secret).slice(0, 8)}…`);
      assert.ok(!auditText.includes(secret), `audit contains ${String(secret).slice(0, 8)}…`);
    }
    assert.match(auditText, /"ip_hmac":"[0-9a-f]{64}"/);
  });
});

describe('production cookie attributes', () => {
  test('__Host- name, Secure, HttpOnly, SameSite=Strict, Path=/, no Domain; pre-session cookie likewise', async () => {
    const prod = await startTestApp({ production: true });
    try {
      const t = await createTrader(prod);
      const c = new Client(prod, '198.51.100.250');
      const csrf = await c.request('GET', '/api/v1/auth/csrf');
      const pre = csrf.setCookies.find((x) => x.startsWith('__Host-alkhayr_presession='))!;
      assert.ok(pre);
      c.csrf = csrf.json.preLoginToken;
      const r = await c.request('POST', '/api/v1/auth/login', { body: { username: t.username, password: t.password } });
      assert.equal(r.status, 200, r.body);
      const cookie = r.setCookies.find((x) => x.startsWith('__Host-alkhayr_session='))!;
      for (const v of [cookie, pre]) {
        assert.match(v, /; Path=\/;/);
        assert.match(v, /; HttpOnly/);
        assert.match(v, /; SameSite=Strict/);
        assert.match(v, /; Secure$/);
        assert.ok(!/Domain=/i.test(v));
      }
      assert.match(cookie, /Max-Age=28800/);
      assert.ok(r.setCookies.some((x) => x.startsWith('__Host-alkhayr_presession=;') && /Max-Age=0/.test(x)), 'pre-session cookie cleared at login');
      assert.match(String(r.headers['strict-transport-security']), /max-age/);
      assert.equal(r.headers['access-control-allow-origin'], undefined);
    } finally {
      await prod.close();
    }
  });
});
