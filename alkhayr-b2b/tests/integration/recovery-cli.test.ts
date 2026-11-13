import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { PasswordHasher } from '../../src/server/auth/passwords.ts';
import { totpCode } from '../../src/server/auth/totp.ts';
import { CancelledError } from '../../src/server/cli/prompt.ts';
import { runCli } from '../../src/server/cli/index.ts';
import { acquireInstanceLock } from '../../src/server/database/instance-lock.ts';
import { CHEAP_PARAMS, Client, count, createAdmin, createTrader, GatedHasher, startTestApp, type TestApp, type TestAppOptions } from '../helpers/app.ts';
import { MIGRATIONS_DIR } from '../helpers/database.ts';
import { codeFromOutput, scriptedPrompter, secretFromOutput, type Answer } from '../helpers/prompter.ts';

// Stage 15: operator account provisioning and recovery commands (in-process CLI, disposable databases).

let ipSeq = 0;
const ip = () => `100.94.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const NEW_ADMIN_PASSWORD = 'Operator-Set-Admin-Passphrase-9';
const NEW_TRADER_PASSWORD = 'Operator-Set-Trader-9';

async function withApp(fn: (app: TestApp) => Promise<void>, options: TestAppOptions = {}) {
  const app = await startTestApp(options);
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

async function cli(app: TestApp, args: string[], answers: Answer[]) {
  const out: string[] = [];
  const err: string[] = [];
  let prompter: ReturnType<typeof scriptedPrompter> | null = null;
  const code = await runCli(args, {
    config: app.config,
    migrationsDir: MIGRATIONS_DIR,
    io: { out: (l) => void out.push(l), err: (l) => void err.push(l) },
    createPrompter: () => (prompter = scriptedPrompter(answers)),
    hasher: new PasswordHasher({ params: CHEAP_PARAMS }),
    now: app.clock.now,
  });
  const transcript = [...out, ...err, ...((prompter as ReturnType<typeof scriptedPrompter> | null)?.output ?? [])].join('\n');
  return { code, out: out.join('\n'), err: err.join('\n'), transcript, prompter: prompter as ReturnType<typeof scriptedPrompter> | null };
}

const adminCreateAnswers = (username: string, code: Answer): Answer[] => [
  username,
  'شركة الخير — فرع الإدارة',
  'مدير ثان',
  '01012345678',
  'القاهرة',
  '2 شارع الإدارة',
  '',
  'second administrator for weekend shifts',
  NEW_ADMIN_PASSWORD,
  NEW_ADMIN_PASSWORD,
  code,
];

const users = (app: TestApp) => count(app, 'SELECT count(*) FROM auth_users');
const auditMeta = (app: TestApp, action: string) =>
  app.fixtureDb.prepare('SELECT actor_user_id, target_id, metadata FROM audit_logs WHERE action = ? ORDER BY id').all(action) as Array<{ actor_user_id: string | null; target_id: string; metadata: string }>;

function assertNoSecrets(texts: string[], secrets: string[]) {
  for (const t of texts) for (const s of secrets) assert.ok(!t.includes(s), `secret leaked: ${s.slice(0, 4)}…`);
}

describe('admin:create (additional administrator)', () => {
  test('creates an administrator only after TOTP proof; the new admin can sign in; audit carries no secret', () =>
    withApp(async (app) => {
      await createAdmin(app);
      const r = await cli(app, ['admin:create'], adminCreateAnswers('second.admin', codeFromOutput(app.clock.now)));
      assert.equal(r.code, 0, r.transcript);
      const row = app.fixtureDb.prepare("SELECT id, role, last_otp_step, credential_version FROM auth_users WHERE username = 'second.admin'").get() as { id: string; role: string; last_otp_step: number; credential_version: number };
      assert.equal(row.role, 'admin');
      assert.ok(row.last_otp_step > 0, 'enrollment step is the anti-replay baseline');
      const secret = secretFromOutput(r.prompter!.output);
      app.clock.advance(30_000);
      const c = new Client(app, ip());
      assert.equal((await c.login('second.admin', NEW_ADMIN_PASSWORD, totpCode(secret, app.clock.now()))).status, 200);
      const [a] = auditMeta(app, 'admin.created');
      assert.equal(a!.actor_user_id, null, 'operator action: no fabricated admin actor');
      assert.equal(a!.target_id, row.id);
      assert.match(a!.metadata, /weekend shifts/);
      assertNoSecrets([a!.metadata, r.out, r.err], [NEW_ADMIN_PASSWORD]);
      const allAudit = (app.fixtureDb.prepare('SELECT metadata FROM audit_logs').all() as Array<{ metadata: string }>).map((x) => x.metadata);
      assertNoSecrets(allAudit, [NEW_ADMIN_PASSWORD, secret.toString('hex')]);
    }));

  test('cancel at any step, a wrong code three times, or an existing username leave nothing behind', () =>
    withApp(async (app) => {
      const existing = await createTrader(app);
      const before = users(app);
      const cancelled = await cli(app, ['admin:create'], adminCreateAnswers('cancel.admin', new CancelledError()));
      assert.equal(cancelled.code, 1);
      assert.match(cancelled.err, /Cancelled\. Nothing was saved/);
      assert.equal(cancelled.prompter!.closed, true);
      const wrong = await cli(app, ['admin:create'], [...adminCreateAnswers('wrong.admin', '000000').slice(0, -1), '000000', '000000', '000000']);
      assert.equal(wrong.code, 1);
      assert.match(wrong.err, /Nothing was saved/);
      // An existing trader's username is refused (never promoted); three refusals end the command.
      const promote = await cli(app, ['admin:create'], [existing.username, existing.username, existing.username]);
      assert.equal(promote.code, 1);
      assert.equal(users(app), before);
      assert.equal((app.fixtureDb.prepare('SELECT role FROM auth_users WHERE id = ?').get(existing.id) as { role: string }).role, 'trader');
      assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'admin.created'"), 0);
      assert.equal(count(app, 'SELECT count(*) FROM merchants'), before);
    }));

  test('refused while the server (instance lock) is running, and secrets are never accepted as arguments', () =>
    withApp(async (app) => {
      const lock = acquireInstanceLock(app.config.dataDir, 'test server');
      try {
        const r = await cli(app, ['admin:create'], []);
        assert.equal(r.code, 1);
        assert.match(r.err, /INSTANCE_LOCKED|stop the server/i);
        assert.equal(r.prompter, null, 'no prompt before the lock is held');
      } finally {
        lock.release();
      }
      const arg = await cli(app, ['account:reset-password', '--password', 'x'], []);
      assert.equal(arg.code, 2);
      assert.match(arg.err, /Secrets are never accepted as arguments/);
      const eq = await cli(app, ['account:reset-password', '--username=bob'], []);
      assert.equal(eq.code, 2);
    }));
});

describe('account recovery', () => {
  test('reset-password: sessions revoked, old password refused, new one works; audit has reason but no password', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const c = new Client(app, ip());
      assert.equal((await c.login(t.username, t.password)).status, 200);
      assert.equal((await c.request('GET', '/api/v1/auth/me')).status, 200);
      const r = await cli(app, ['account:reset-password'], [t.username, t.username.toUpperCase(), 'merchant forgot password (phone call)', NEW_TRADER_PASSWORD, NEW_TRADER_PASSWORD]);
      assert.equal(r.code, 0, r.transcript);
      assert.match(r.transcript, /1 session\(s\) revoked/);
      assert.equal((await c.request('GET', '/api/v1/auth/me')).status, 401, 'existing session is gone');
      assert.equal((await new Client(app, ip()).login(t.username, t.password)).status, 401);
      assert.equal((await new Client(app, ip()).login(t.username, NEW_TRADER_PASSWORD)).status, 200);
      const [a] = auditMeta(app, 'account.password_reset');
      assert.equal(a!.actor_user_id, null);
      const meta = JSON.parse(a!.metadata) as Record<string, unknown>;
      assert.deepEqual({ method: meta.method, reason: meta.reason, sessions_revoked: meta.sessions_revoked, credential_version: meta.credential_version }, { method: 'cli', reason: 'merchant forgot password (phone call)', sessions_revoked: 1, credential_version: 2 });
      assertNoSecrets([a!.metadata, r.out, r.err], [NEW_TRADER_PASSWORD, t.password]);
      assert.equal((app.fixtureDb.prepare('SELECT role FROM auth_users WHERE id = ?').get(t.id) as { role: string }).role, 'trader', 'role unchanged');
    }));

  test('a mistyped confirmation, a weak password or a missing reason cancel without any change', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const hash = () => (app.fixtureDb.prepare('SELECT password_hash, credential_version FROM auth_users WHERE id = ?').get(t.id) as object);
      const before = JSON.stringify(hash());
      const mistyped = await cli(app, ['account:reset-password'], [t.username, 'someone.else']);
      assert.equal(mistyped.code, 1);
      assert.match(mistyped.err, /Cancelled/);
      const weak = await cli(app, ['account:reset-password'], [t.username, t.username, 'reset after lockout', 'short', 'short2', 'short3']);
      assert.equal(weak.code, 1);
      const noReason = await cli(app, ['account:reset-password'], [t.username, t.username, '', 'x', '\u0007bad']);
      assert.equal(noReason.code, 1);
      const unknown = await cli(app, ['account:reset-password'], ['nobody.here', 'nobody.here', 'nobody.here']);
      assert.equal(unknown.code, 1);
      assert.equal(JSON.stringify(hash()), before);
      assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action LIKE 'account.%'"), 0);
    }));

  test('reset-mfa: old authenticator stops working, new one works, anti-replay step never lowered; traders refused', () =>
    withApp(async (app) => {
      const a = await createAdmin(app);
      const c = new Client(app, ip());
      assert.equal((await c.login(a.username, a.password, a.code())).status, 200);
      const stepBefore = (app.fixtureDb.prepare('SELECT last_otp_step FROM auth_users WHERE id = ?').get(a.id) as { last_otp_step: number }).last_otp_step;
      // The enrollment proof uses the CURRENT step (already consumed by the login): the stored step must not go back.
      const r = await cli(app, ['account:reset-mfa'], [a.username, a.username, 'phone lost; identity verified in person', codeFromOutput(app.clock.now)]);
      assert.equal(r.code, 0, r.transcript);
      const after = app.fixtureDb.prepare('SELECT last_otp_step, credential_version FROM auth_users WHERE id = ?').get(a.id) as { last_otp_step: number; credential_version: number };
      assert.ok(after.last_otp_step >= stepBefore);
      assert.equal(after.credential_version, 2);
      assert.equal((await c.request('GET', '/api/v1/auth/me')).status, 401, 'sessions revoked');
      const fresh = secretFromOutput(r.prompter!.output);
      assert.equal((await new Client(app, ip()).login(a.username, a.password, totpCode(fresh, app.clock.now()))).status, 401, 'the enrollment proof step cannot be replayed');
      app.clock.advance(30_000);
      assert.equal((await new Client(app, ip()).login(a.username, a.password, a.code())).status, 401, 'old authenticator refused');
      assert.equal((await new Client(app, ip()).login(a.username, a.password, totpCode(fresh, app.clock.now()))).status, 200);
      const [row] = auditMeta(app, 'account.mfa_replaced');
      assertNoSecrets([row!.metadata, r.out, r.err], [fresh.toString('hex'), a.secret.toString('hex'), a.password]);
      const t = await createTrader(app);
      const trader = await cli(app, ['account:reset-mfa'], [t.username]);
      assert.equal(trader.code, 1);
      assert.match(trader.err, /NOT_ADMIN/);
    }));

  test('reset-mfa: a wrong proof code keeps the old enrollment valid', () =>
    withApp(async (app) => {
      const a = await createAdmin(app);
      const before = (app.fixtureDb.prepare('SELECT totp_ciphertext FROM auth_users WHERE id = ?').get(a.id) as { totp_ciphertext: string }).totp_ciphertext;
      const r = await cli(app, ['account:reset-mfa'], [a.username, a.username, 'replacing authenticator', '123456', '654321', '000000']);
      assert.equal(r.code, 1);
      assert.equal((app.fixtureDb.prepare('SELECT totp_ciphertext FROM auth_users WHERE id = ?').get(a.id) as { totp_ciphertext: string }).totp_ciphertext, before);
      assert.equal((await new Client(app, ip()).login(a.username, a.password, a.code())).status, 200);
    }));

  test('revoke-sessions ends every session of the account but keeps credentials', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const c1 = new Client(app, ip());
      const c2 = new Client(app, ip());
      await c1.login(t.username, t.password);
      await c2.login(t.username, t.password);
      const r = await cli(app, ['account:revoke-sessions'], [t.username, t.username, 'shared device was stolen']);
      assert.equal(r.code, 0, r.transcript);
      assert.match(r.transcript, /2 session\(s\) revoked/);
      assert.equal((await c1.request('GET', '/api/v1/auth/me')).status, 401);
      assert.equal((await c2.request('GET', '/api/v1/auth/me')).status, 401);
      assert.equal((await new Client(app, ip()).login(t.username, t.password)).status, 200, 'password unchanged');
    }));
});

describe('recovery racing an in-flight login (credential_version)', () => {
  const race = (label: string, run: (app: TestApp) => Promise<{ start: () => Promise<{ status: number }>; recover: () => Promise<number> }>) =>
    test(label, () =>
      withApp(
        async (app) => {
          const hasher = app.hasher as GatedHasher;
          const { start, recover } = await run(app);
          const arrived = hasher.pause();
          const pending = start();
          await arrived; // password verified with the OLD credentials; commit not yet made
          assert.equal(await recover(), 0);
          hasher.release();
          assert.equal((await pending).status, 401);
          assert.equal(count(app, 'SELECT count(*) FROM sessions'), 0);
          assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'auth.login_failed' AND metadata LIKE '%stale_credentials%'"), 1);
        },
        { hasher: new GatedHasher() },
      ),
    );

  race('session revocation during a trader login: no session is created', async (app) => {
    const t = await createTrader(app);
    const c = new Client(app, ip());
    await c.preLogin();
    return {
      start: () => c.request('POST', '/api/v1/auth/login', { body: { username: t.username, password: t.password } }),
      recover: async () => (await cli(app, ['account:revoke-sessions'], [t.username, t.username, 'suspected compromise'])).code,
    };
  });

  race('password reset during a trader login: no session is created', async (app) => {
    const t = await createTrader(app);
    const c = new Client(app, ip());
    await c.preLogin();
    return {
      start: () => c.request('POST', '/api/v1/auth/login', { body: { username: t.username, password: t.password } }),
      recover: async () => (await cli(app, ['account:reset-password'], [t.username, t.username, 'suspected compromise', NEW_TRADER_PASSWORD, NEW_TRADER_PASSWORD])).code,
    };
  });

  race('authenticator replacement during an admin login with the old code: no session is created', async (app) => {
    const a = await createAdmin(app);
    const c = new Client(app, ip());
    await c.preLogin();
    const oldCode = a.code();
    return {
      start: () => c.request('POST', '/api/v1/auth/login', { body: { username: a.username, password: a.password, totp: oldCode } }),
      // The new enrollment is proven with the NEXT step so it cannot collide with the in-flight code.
      recover: async () => (await cli(app, ['account:reset-mfa'], [a.username, a.username, 'authenticator compromised', codeFromOutput(app.clock.now, 1)])).code,
    };
  });
});

describe('migration 0007 triggers', () => {
  test('credential_version only increases, and a TOTP change without a bump is refused', () =>
    withApp(async (app) => {
      const a = await createAdmin(app);
      const db: DatabaseSync = app.fixtureDb;
      assert.throws(() => db.prepare('UPDATE auth_users SET credential_version = 0 WHERE id = ?').run(a.id), /CHECK|can only increase/);
      db.prepare('UPDATE auth_users SET credential_version = 3 WHERE id = ?').run(a.id);
      assert.throws(() => db.prepare('UPDATE auth_users SET credential_version = 2 WHERE id = ?').run(a.id), /can only increase/);
      assert.throws(() => db.prepare("UPDATE auth_users SET totp_ciphertext = 'x' || totp_ciphertext WHERE id = ?").run(a.id), /requires a new credential_version/);
      db.prepare("UPDATE auth_users SET totp_ciphertext = 'x' || totp_ciphertext, credential_version = credential_version + 1 WHERE id = ?").run(a.id);
      assert.equal(count(app, 'SELECT credential_version FROM auth_users WHERE id = ?', a.id), 4);
    }));
});
