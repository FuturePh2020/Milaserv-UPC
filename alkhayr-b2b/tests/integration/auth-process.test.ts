import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { PasswordHasher } from '../../src/server/auth/passwords.ts';
import { baseEnv, createTempApp, rawRequest, startServer, TEST_HOST } from '../helpers/server.ts';

// End-to-end against the REAL bundled server process (production mode, reference scrypt).
// Synthetic trader credentials only.
const PASSWORD = 'Process-Fixture-Trader-01';

function cookiesFrom(setCookie: string | string[] | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  for (const c of ([] as string[]).concat(setCookie ?? [])) {
    const [pair] = c.split(';');
    const i = pair!.indexOf('=');
    jar.set(pair!.slice(0, i), pair!.slice(i + 1));
  }
  return jar;
}

test('bundled server: csrf -> login -> me -> logout with __Host- secure cookies; logs stay secret-free', async () => {
  const app = await createTempApp();
  try {
    const db = new DatabaseSync(app.databasePath);
    const userId = randomUUID();
    const t = Date.now();
    db.prepare("INSERT INTO auth_users (id, username, password_hash, password_changed_at, role, created_at, updated_at) VALUES (?, 'process.trader', ?, ?, 'trader', ?, ?)").run(
      userId,
      await new PasswordHasher().hash(PASSWORD),
      t,
      t,
      t,
    );
    db.prepare("INSERT INTO merchants (id, user_id, business_name, contact_name, phone, governorate, address, status, version, created_at, updated_at) VALUES (?, ?, 'محل', 'أحمد', '01012345678', 'القاهرة', '12 شارع النيل', 'approved', 1, ?, ?)").run(randomUUID(), userId, t, t);
    db.close();

    const env = baseEnv({ NODE_ENV: 'production', APP_ORIGIN: `https://${TEST_HOST}`, APP_SECRET: randomBytes(32).toString('base64url'), BACKUP_KEY: randomBytes(32).toString('base64url') });
    const s = await startServer(app, env);
    try {
      const origin = `https://${TEST_HOST}`;
      const csrf = await rawRequest(s.port, { path: '/api/v1/auth/csrf' });
      assert.equal(csrf.status, 200);
      const pre = cookiesFrom(csrf.headers['set-cookie']).get('__Host-alkhayr_presession')!;
      const preToken = JSON.parse(csrf.body).preLoginToken as string;

      const login = await rawRequest(s.port, {
        method: 'POST',
        path: '/api/v1/auth/login',
        headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: `__Host-alkhayr_presession=${pre}`, 'X-CSRF-Token': preToken },
        body: JSON.stringify({ username: 'process.trader', password: PASSWORD }),
      });
      assert.equal(login.status, 200, login.body);
      const setCookie = ([] as string[]).concat(login.headers['set-cookie'] ?? []).find((c) => c.startsWith('__Host-alkhayr_session='))!;
      assert.match(setCookie, /Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
      const session = cookiesFrom(setCookie).get('__Host-alkhayr_session')!;
      const csrfToken = JSON.parse(login.body).csrfToken as string;

      const me = await rawRequest(s.port, { path: '/api/v1/auth/me', headers: { Cookie: `__Host-alkhayr_session=${session}` } });
      assert.equal(me.status, 200);
      assert.equal(JSON.parse(me.body).user.username, 'process.trader');

      const out = await rawRequest(s.port, {
        method: 'POST',
        path: '/api/v1/auth/logout',
        headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: `__Host-alkhayr_session=${session}`, 'X-CSRF-Token': csrfToken },
        body: '{}',
      });
      assert.equal(out.status, 200);
      const after = await rawRequest(s.port, { path: '/api/v1/auth/me', headers: { Cookie: `__Host-alkhayr_session=${session}` } });
      assert.equal(after.status, 401);

      const logs = s.stdout() + s.stderr();
      for (const secret of [PASSWORD, session, csrfToken, preToken, pre, env.APP_SECRET!]) assert.ok(!logs.includes(secret), 'secret in process logs');
      assert.ok(!/Warning:/.test(s.stderr()), s.stderr());
    } finally {
      assert.equal(await s.stop(), 0);
    }
  } finally {
    await app.cleanup();
  }
});
