import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import { cookieNames, parseCookies, serializeCookie } from '../../src/server/auth/cookies.ts';
import { newPreSessionNonce, PRELOGIN_TTL_MS, preLoginToken, sessionCsrfToken, verifyPreLoginToken, verifySessionCsrf } from '../../src/server/auth/csrf.ts';
import { RateLimiter } from '../../src/server/auth/rate-limit.ts';
import { hashSessionToken, newSessionToken } from '../../src/server/auth/sessions.ts';
import { normalizeIp, rateLimitIdentity, resolveClientIp, trustedProxySet } from '../../src/server/http/client-ip.ts';
import { createTestDatabase } from '../helpers/database.ts';
import { openDatabase } from '../../src/server/database/connection.ts';
import { deriveServerKeys } from '../../src/server/auth/keys.ts';

describe('client IP resolution (TRUST_PROXY)', () => {
  const trusted = trustedProxySet(['10.0.0.2', '::1']);

  test('without a trusted peer, X-Forwarded-For is ignored', () => {
    assert.equal(resolveClientIp('203.0.113.9', '198.51.100.1', trusted), '203.0.113.9');
    assert.equal(resolveClientIp('203.0.113.9', '198.51.100.1', trustedProxySet([])), '203.0.113.9');
  });

  test('a trusted proxy peer: rightmost untrusted address wins; spoofed left entries are ignored', () => {
    assert.equal(resolveClientIp('10.0.0.2', '198.51.100.1', trusted), '198.51.100.1');
    assert.equal(resolveClientIp('10.0.0.2', '6.6.6.6, 198.51.100.1', trusted), '198.51.100.1');
    assert.equal(resolveClientIp('10.0.0.2', '198.51.100.1, ::1', trusted), '198.51.100.1');
    assert.equal(resolveClientIp('::ffff:10.0.0.2', '198.51.100.1', trusted), '198.51.100.1');
  });

  test('malformed or missing forwarding data falls back to the peer', () => {
    assert.equal(resolveClientIp('10.0.0.2', 'not-an-ip', trusted), '10.0.0.2');
    assert.equal(resolveClientIp('10.0.0.2', '198.51.100.1, garbage', trusted), '10.0.0.2');
    assert.equal(resolveClientIp('10.0.0.2', undefined, trusted), '10.0.0.2');
    assert.equal(resolveClientIp('10.0.0.2', '::1', trusted), '10.0.0.2');
    assert.equal(resolveClientIp(undefined, undefined, trusted), '0.0.0.0');
  });

  test('normalization and IPv6 /64 rate-limit identity', () => {
    assert.equal(normalizeIp('::FFFF:192.0.2.1'), '192.0.2.1');
    assert.equal(normalizeIp('[2001:db8::1]'), '2001:db8::1');
    assert.equal(normalizeIp('x'), null);
    assert.equal(rateLimitIdentity('192.0.2.1'), 'v4:192.0.2.1');
    assert.equal(rateLimitIdentity('2001:db8:aa:bb:1:2:3:4'), rateLimitIdentity('2001:db8:aa:bb:ffff::9'));
    assert.notEqual(rateLimitIdentity('2001:db8:aa:bb::1'), rateLimitIdentity('2001:db8:aa:bc::1'));
    assert.equal(rateLimitIdentity('::1'), 'v6:0000:0000:0000:0000::/64');
  });
});

describe('cookies', () => {
  test('production names use __Host-; attributes are Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain', () => {
    assert.deepEqual(cookieNames(true), { session: '__Host-alkhayr_session', preSession: '__Host-alkhayr_presession' });
    const c = serializeCookie('__Host-alkhayr_session', 'abc', { secure: true, maxAge: 28800 });
    assert.match(c, /; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
    assert.ok(!/Domain=/i.test(c));
    assert.match(serializeCookie('x', '', { secure: false, maxAge: 0 }), /Max-Age=0; Expires=Thu, 01 Jan 1970/);
  });

  test('parsing is bounded and duplicate names are treated as absent (no cookie shadowing)', () => {
    assert.equal(parseCookies('a=1; b=2').get('b'), '2');
    assert.equal(parseCookies('alkhayr_session=one; alkhayr_session=two').get('alkhayr_session'), undefined);
    assert.equal(parseCookies('a=' + 'x'.repeat(9000)).size, 0);
    assert.equal(parseCookies(undefined).size, 0);
  });
});

describe('session tokens and CSRF tokens', () => {
  const key = randomBytes(32);

  test('session tokens are 256-bit random values; only their SHA-256 is stored', () => {
    const a = newSessionToken();
    const b = newSessionToken();
    assert.equal(Buffer.from(a.token, 'base64url').length, 32);
    assert.notEqual(a.token, b.token);
    assert.equal(a.tokenHash, hashSessionToken(a.token));
    assert.match(a.tokenHash, /^[0-9a-f]{64}$/);
  });

  test('session CSRF tokens are bound to one session and differ between sessions', () => {
    const s1 = newSessionToken().token;
    const s2 = newSessionToken().token;
    const t1 = sessionCsrfToken(key, s1);
    assert.equal(verifySessionCsrf(key, s1, t1), true);
    assert.equal(verifySessionCsrf(key, s2, t1), false);
    assert.equal(verifySessionCsrf(randomBytes(32), s1, t1), false);
    assert.equal(verifySessionCsrf(key, s1, undefined), false);
    assert.equal(verifySessionCsrf(key, s1, t1.slice(0, -1) + (t1.endsWith('A') ? 'B' : 'A')), false);
  });

  test('pre-login tokens: bound to the pre-session nonce, expire, and are never valid as session tokens', () => {
    const nonce = newPreSessionNonce();
    const now = 1_800_000_000_000;
    const token = preLoginToken(key, nonce, now + PRELOGIN_TTL_MS);
    assert.equal(verifyPreLoginToken(key, nonce, token, now), true);
    assert.equal(verifyPreLoginToken(key, newPreSessionNonce(), token, now), false);
    assert.equal(verifyPreLoginToken(key, nonce, token, now + PRELOGIN_TTL_MS), false, 'expired');
    assert.equal(verifyPreLoginToken(key, nonce, preLoginToken(key, nonce, now + PRELOGIN_TTL_MS * 10), now), false, 'lifetime cannot be inflated');
    assert.equal(verifyPreLoginToken(key, undefined, token, now), false);
    assert.equal(verifySessionCsrf(key, nonce, token), false);
    const sessionToken = newSessionToken().token;
    assert.equal(verifyPreLoginToken(key, sessionToken, sessionCsrfToken(key, sessionToken), now), false);
  });
});

describe('rate limiter', () => {
  test('fixed window: limit, Retry-After, reset after the window, keys are HMACs', () => {
    const t = createTestDatabase();
    let now = 1_000_000;
    try {
      const rl = new RateLimiter(t.db, randomBytes(32), () => now, { rules: { login_account: { limit: 3, windowMs: 60_000 } } });
      for (let i = 0; i < 3; i++) assert.equal(rl.consume('login_account', 'trader.one').allowed, true);
      const denied = rl.consume('login_account', 'trader.one');
      assert.deepEqual(denied, { allowed: false, retryAfterSeconds: 60 });
      now += 30_000;
      assert.equal(rl.consume('login_account', 'trader.one').retryAfterSeconds, 30, 'denials do not extend the window');
      assert.equal(rl.consume('login_account', 'other.user').allowed, true, 'other identifiers unaffected');
      now += 30_000;
      assert.equal(rl.consume('login_account', 'trader.one').allowed, true);
      const keys = (t.db.prepare('SELECT key FROM rate_limits').all() as Array<{ key: string }>).map((r) => r.key);
      for (const k of keys) {
        assert.match(k, /^[0-9a-f]{64}$/);
        assert.ok(!k.includes('trader'));
      }
    } finally {
      t.cleanup();
    }
  });

  test('bounded growth: beyond maxRows new identities share one restrictive overflow counter', () => {
    const t = createTestDatabase();
    const now = 5_000_000;
    try {
      const rl = new RateLimiter(t.db, randomBytes(32), () => now, { maxRows: 10, rules: { login_ip: { limit: 3, windowMs: 60_000 } } });
      const results = Array.from({ length: 50 }, (_, i) => rl.consume('login_ip', `v4:198.51.100.${i}`).allowed);
      const rows = Number((t.db.prepare('SELECT count(*) AS n FROM rate_limits').get() as { n: number }).n);
      assert.ok(rows <= 11, `rows=${rows}`);
      assert.equal(results.filter(Boolean).length, 10 + 3, '10 individual keys + 3 attempts on the shared overflow key');
    } finally {
      t.cleanup();
    }
  });

  test('expired rows are purged when the table is full, and by sweep()', () => {
    const t = createTestDatabase();
    let now = 7_000_000;
    try {
      const rl = new RateLimiter(t.db, randomBytes(32), () => now, { maxRows: 5, rules: { api_ip: { limit: 10, windowMs: 1000 } } });
      for (let i = 0; i < 5; i++) rl.consume('api_ip', `id-${i}`);
      now += 2000;
      assert.equal(rl.consume('api_ip', 'new-id').allowed, true);
      const rows = Number((t.db.prepare('SELECT count(*) AS n FROM rate_limits').get() as { n: number }).n);
      assert.equal(rows, 1, 'expired rows were purged to make room');
      now += 2000;
      assert.equal(rl.sweep(), 1);
    } finally {
      t.cleanup();
    }
  });
});

describe('rate-limit persistence', () => {
  test('counters live in the database: they survive closing and reopening (application restart)', () => {
    const t = createTestDatabase();
    const appSecret = randomBytes(32);
    const now = 9_000_000;
    try {
      const first = new RateLimiter(t.db, deriveServerKeys(appSecret).rateLimit, () => now);
      for (let i = 0; i < 5; i++) assert.equal(first.consume('login_account', 'persisted.user').allowed, true);
      assert.equal(first.consume('login_account', 'persisted.user').allowed, false);
      t.db.close();
      const reopened = openDatabase(t.file, { mustExist: true, runtime: true });
      try {
        const second = new RateLimiter(reopened, deriveServerKeys(appSecret).rateLimit, () => now + 1000);
        const r = second.consume('login_account', 'persisted.user');
        assert.equal(r.allowed, false, 'still limited after restart');
        assert.equal(r.retryAfterSeconds, 15 * 60 - 1);
        // Keys are keyed HMACs: with a different APP_SECRET the same identifier maps to a different key.
        const otherSecret = new RateLimiter(reopened, deriveServerKeys(randomBytes(32)).rateLimit, () => now + 1000);
        assert.notEqual(otherSecret.keyFor('login_account', 'persisted.user'), second.keyFor('login_account', 'persisted.user'));
      } finally {
        reopened.close();
      }
    } finally {
      t.cleanup();
    }
  });
});
