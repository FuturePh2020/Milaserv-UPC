import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { Client, count, createAdmin, createTrader, GatedHasher, startTestApp, type TestApp } from '../helpers/app.ts';

// Disposable synthetic identities only.
const MIN = 60_000;
let ipSeq = 0;
const ip = () => `100.64.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

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

async function signedIn(app: TestApp, account: { username: string; password: string; code?: (o?: number) => string }) {
  const c = new Client(app, ip());
  const r = await c.login(account.username, account.password, account.code?.());
  assert.equal(r.status, 200, r.body);
  return c;
}

const merchantRow = (app: TestApp, id: string) => app.fixtureDb.prepare('SELECT * FROM merchants WHERE id = ?').get(id) as any;
const SECRET_MARKERS = /password_hash|passwordHash|totp|last_otp_step|token_hash|csrf_secret|access_version|accessVersion|\$scrypt\$/i;

describe('self-service profile', () => {
  test('anonymous access is denied', () =>
    withApp(async (app) => {
      const c = new Client(app, ip());
      expectCode(await c.request('GET', '/api/v1/merchant/profile'), 401, 'UNAUTHENTICATED');
      expectCode(await c.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, phone: '01012345678' } }), 401, 'UNAUTHENTICATED');
    }));

  test('each trader reads and edits only their own profile; ids in path/query/body/headers cannot redirect it', () =>
    withApp(async (app) => {
      const a = await createTrader(app, { status: 'approved' });
      const b = await createTrader(app, { status: 'pending' });
      const ca = await signedIn(app, a);
      const cb = await signedIn(app, b);
      const own = await ca.request('GET', '/api/v1/merchant/profile', { headers: { 'X-Merchant-Id': b.merchantId, 'X-User-Id': b.id } });
      assert.equal(own.json.profile.id, a.merchantId);
      assert.ok(!SECRET_MARKERS.test(own.body), own.body);
      expectCode(await ca.request('GET', `/api/v1/merchant/profile?merchantId=${b.merchantId}`), 400, 'VALIDATION_FAILED');
      expectCode(await ca.request('GET', `/api/v1/merchant/profile/${b.merchantId}`), 404, 'NOT_FOUND');
      for (const extra of [{ merchantId: b.merchantId }, { id: b.merchantId }, { userId: b.id }]) {
        expectCode(await ca.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, address: '99 شارع الاختراق', ...extra } }), 400, 'VALIDATION_FAILED');
      }
      const ok = await ca.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, businessName: 'محل أ الجديد', phone: '٠١١ ٢٢٢٣ ٣٣٤٤', email: ' Owner@Example.COM ' }, headers: { 'X-Merchant-Id': b.merchantId } });
      assert.equal(ok.status, 200, ok.body);
      assert.deepEqual(
        { name: ok.json.profile.businessName, phone: ok.json.profile.phone, email: ok.json.profile.email, version: ok.json.profile.version },
        { name: 'محل أ الجديد', phone: '01122233344', email: 'owner@example.com', version: 2 },
      );
      assert.equal(merchantRow(app, b.merchantId).business_name, 'محل الاختبار', 'other merchant untouched');
      assert.equal(merchantRow(app, b.merchantId).version, 1);
      const bOwn = await cb.request('GET', '/api/v1/merchant/profile');
      assert.equal(bOwn.json.profile.id, b.merchantId);
      assert.ok(!bOwn.body.includes('owner@example.com'));
    }));

  test('role/status/security fields are rejected; a pending edit stays pending and never changes access', () =>
    withApp(async (app) => {
      const t = await createTrader(app, { status: 'pending' });
      const c = await signedIn(app, t);
      for (const extra of [{ status: 'approved' }, { role: 'admin' }, { version: 5 }, { accessVersion: 9 }, { passwordHash: 'x' }, { totp: '123456' }, { password: 'New-Password-123' }, { username: 'renamed.user' }]) {
        expectCode(await c.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, address: '10 شارع جديد', ...extra } }), 400, 'VALIDATION_FAILED');
      }
      assert.equal(merchantRow(app, t.merchantId).version, 1, 'rejected requests changed nothing');
      const ok = await c.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, address: '10 شارع جديد، المعادي', governorate: 'القاهرة' } });
      assert.equal(ok.status, 200);
      const row = merchantRow(app, t.merchantId);
      assert.equal(row.status, 'pending');
      assert.equal(row.access_version, 1);
      assert.equal((app.fixtureDb.prepare('SELECT role FROM auth_users WHERE id = ?').get(t.id) as any).role, 'trader');
      const audit = app.fixtureDb.prepare("SELECT metadata FROM audit_logs WHERE action = 'merchant.profile_updated'").get() as any;
      assert.deepEqual(JSON.parse(audit.metadata), { fields: 'governorate,address', version: 2 }, 'field names only, no values');
    }));

  test('validation, empty patch, stale version conflict, CSRF/origin/content type', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const c = await signedIn(app, t);
      expectCode(await c.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1 } }), 400, 'VALIDATION_FAILED');
      expectCode(await c.request('PATCH', '/api/v1/merchant/profile', { body: { phone: '01012345678' } }), 400, 'VALIDATION_FAILED');
      const bad = await c.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, phone: '123', email: 'not-an-email', address: 'x' } });
      expectCode(bad, 400, 'VALIDATION_FAILED');
      assert.deepEqual(bad.json.error.details.fields.map((f: any) => f.path).sort(), ['address', 'email', 'phone']);
      expectCode(await c.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, phone: '01012345678' }, csrf: null }), 403, 'CSRF_FAILED');
      expectCode(await c.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, phone: '01012345678' }, noOrigin: true }), 403, 'ORIGIN_REJECTED');
      expectCode(await c.request('PATCH', '/api/v1/merchant/profile', { rawBody: 'phone=01012345678', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), 415, 'UNSUPPORTED_MEDIA_TYPE');
      assert.equal((await c.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, contactName: 'محمود حسن' } })).status, 200);
      const stale = await c.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, contactName: 'اسم قديم' } });
      expectCode(stale, 409, 'VERSION_CONFLICT');
      assert.equal(stale.json.error.details.current.profile.contactName, 'محمود حسن', 'conflict returns the newer data instead of overwriting it');
      assert.equal(merchantRow(app, t.merchantId).contact_name, 'محمود حسن');
      const cleared = await c.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 2, email: '' } });
      assert.equal(cleared.json.profile.email, null);
    }));

  test('a suspended trader has no session and no alternative way to the profile', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const c = await signedIn(app, t);
      app.fixtureDb.prepare("UPDATE merchants SET status = 'suspended', access_version = access_version + 1, version = version + 1 WHERE id = ?").run(t.merchantId);
      expectCode(await c.request('GET', '/api/v1/merchant/profile'), 401, 'UNAUTHENTICATED');
      expectCode(await new Client(app, ip()).login(t.username, t.password), 401, 'INVALID_CREDENTIALS');
    }));
});

describe('administrator review', () => {
  test('traders and anonymous users cannot use administrative endpoints', () =>
    withApp(async (app) => {
      const t = await createTrader(app);
      const other = await createTrader(app, { status: 'pending' });
      const c = await signedIn(app, t);
      expectCode(await new Client(app, ip()).request('GET', '/api/v1/admin/merchants'), 401, 'UNAUTHENTICATED');
      expectCode(await c.request('GET', '/api/v1/admin/merchants'), 403, 'FORBIDDEN');
      expectCode(await c.request('GET', `/api/v1/admin/merchants?status=pending&q=${encodeURIComponent('محل')}`), 403, 'FORBIDDEN');
      expectCode(await c.request('GET', `/api/v1/admin/merchants/${other.merchantId}`), 403, 'FORBIDDEN');
      expectCode(await c.request('PATCH', `/api/v1/admin/merchants/${other.merchantId}`, { body: { status: 'approved', expectedVersion: 1 }, headers: { 'X-User-Role': 'admin' } }), 403, 'FORBIDDEN');
      expectCode(await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'approved', expectedVersion: 1 } }), 403, 'FORBIDDEN');
      assert.equal(merchantRow(app, other.merchantId).status, 'pending');
    }));

  test('list: status filter, escaped search, allow-listed sort, strict params and stable signed pagination', () =>
    withApp(async (app) => {
      const admin = await createAdmin(app);
      const names = ['حلويات النور', 'Sweet 100% Shop', 'شيكولاتة الأمل', 'كاندي ستار', 'مكسرات الخير', 'ويفر البركة', 'سناكس الشروق'];
      const created = [];
      for (const [i, n] of names.entries()) {
        const t = await createTrader(app, { status: i % 2 ? 'approved' : 'pending', username: `list.trader${i}` });
        app.fixtureDb.prepare('UPDATE merchants SET business_name = ?, version = version + 1 WHERE id = ?').run(n, t.merchantId);
        created.push(t);
        app.clock.advance(1000);
      }
      const c = await signedIn(app, admin);
      const pending = await c.request('GET', '/api/v1/admin/merchants?status=pending');
      assert.equal(pending.status, 200);
      assert.ok(pending.json.items.every((m: any) => m.status === 'pending'));
      assert.equal(pending.json.items.length, 4);
      assert.ok(!SECRET_MARKERS.test(pending.body));
      const pct = await c.request('GET', `/api/v1/admin/merchants?q=${encodeURIComponent('100%')}`);
      assert.deepEqual(pct.json.items.map((m: any) => m.businessName), ['Sweet 100% Shop']);
      const percentOnly = await c.request('GET', `/api/v1/admin/merchants?q=${encodeURIComponent('%')}`);
      assert.equal(percentOnly.json.items.length, 1, '% is a literal, not a wildcard');
      const arabic = await c.request('GET', `/api/v1/admin/merchants?q=${encodeURIComponent('الخير')}`);
      assert.deepEqual(arabic.json.items.map((m: any) => m.businessName).sort(), ['مكسرات الخير', 'شركة الخير'].sort());
      const byUser = await c.request('GET', '/api/v1/admin/merchants?q=list.trader3');
      assert.equal(byUser.json.items[0].username, 'list.trader3');
      const sqlish = await c.request('GET', `/api/v1/admin/merchants?q=${encodeURIComponent("' OR 1=1 --")}`);
      assert.equal(sqlish.status, 200);
      assert.equal(sqlish.json.items.length, 0);
      for (const bad of ['sort=password_hash', 'sort=name;DROP TABLE merchants', 'status=active', 'limit=101', 'limit=0', 'limit=abc', 'merchantId=x', 'status=pending&status=approved', `q=${'x'.repeat(81)}`, 'q=']) {
        expectCode(await c.request('GET', `/api/v1/admin/merchants?${encodeURI(bad)}`), 400, 'VALIDATION_FAILED');
      }
      // Stable pagination by name (8 merchants incl. the admin's own profile).
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const r = await c.request('GET', `/api/v1/admin/merchants?sort=name&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        assert.equal(r.status, 200, r.body);
        seen.push(...r.json.items.map((m: any) => m.id));
        cursor = r.json.nextCursor;
        pages++;
      } while (cursor && pages < 10);
      assert.equal(new Set(seen).size, seen.length, 'no duplicates across pages');
      assert.equal(seen.length, count(app, 'SELECT count(*) FROM merchants'));
      const all = await c.request('GET', '/api/v1/admin/merchants?sort=name&limit=100');
      assert.deepEqual(seen, all.json.items.map((m: any) => m.id), 'pages concatenate to the full ordering');
      // Cursors are bound to sort/filter and to the administrator; tampering is rejected.
      const first = await c.request('GET', '/api/v1/admin/merchants?sort=newest&limit=2');
      const cur = first.json.nextCursor as string;
      expectCode(await c.request('GET', `/api/v1/admin/merchants?sort=name&limit=2&cursor=${encodeURIComponent(cur)}`), 400, 'VALIDATION_FAILED');
      expectCode(await c.request('GET', `/api/v1/admin/merchants?sort=newest&status=pending&limit=2&cursor=${encodeURIComponent(cur)}`), 400, 'VALIDATION_FAILED');
      const [payload, mac] = cur.split('.') as [string, string];
      const forged = Buffer.from(JSON.stringify({ v: 1, p: [0, randomUUID()] })).toString('base64url');
      expectCode(await c.request('GET', `/api/v1/admin/merchants?sort=newest&limit=2&cursor=${forged}.${mac}`), 400, 'VALIDATION_FAILED');
      assert.ok(payload);
      const admin2 = await createAdmin(app);
      const c2 = await signedIn(app, admin2);
      expectCode(await c2.request('GET', `/api/v1/admin/merchants?sort=newest&limit=2&cursor=${encodeURIComponent(cur)}`), 400, 'VALIDATION_FAILED');
      assert.equal(created.length, 7);
    }));

  test('detail is safe; unknown and malformed ids are 404', () =>
    withApp(async (app) => {
      const admin = await createAdmin(app);
      const t = await createTrader(app, { status: 'pending' });
      const c = await signedIn(app, admin);
      const d = await c.request('GET', `/api/v1/admin/merchants/${t.merchantId}`);
      assert.equal(d.status, 200);
      assert.equal(d.json.merchant.username, t.username);
      assert.deepEqual(d.json.statusHistory, []);
      assert.ok(!SECRET_MARKERS.test(d.body), d.body);
      expectCode(await c.request('GET', `/api/v1/admin/merchants/${randomUUID()}`), 404, 'NOT_FOUND');
      expectCode(await c.request('GET', '/api/v1/admin/merchants/not-a-uuid'), 404, 'NOT_FOUND');
      expectCode(await c.request('GET', `/api/v1/admin/merchants/${t.id}`), 404, 'NOT_FOUND');
    }));
});

describe('administrator state changes', () => {
  test('approval: no session created, no notification claimed, audited; pending trader gains approval live', () =>
    withApp(async (app) => {
      const admin = await createAdmin(app);
      const t = await createTrader(app, { status: 'pending' });
      const tc = await signedIn(app, t);
      const c = await signedIn(app, admin);
      const sessionsBefore = count(app, 'SELECT count(*) FROM sessions WHERE user_id = ?', t.id);
      const r = await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'approved', expectedVersion: 1 } });
      assert.equal(r.status, 200, r.body);
      assert.equal(r.json.merchant.status, 'approved');
      assert.equal(r.json.sessionsRevoked, 0);
      assert.deepEqual(Object.keys(r.json).sort(), ['merchant', 'sessionsRevoked'], 'no notification/delivery field is claimed');
      assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE user_id = ?', t.id), sessionsBefore, 'approval creates no session');
      assert.equal(merchantRow(app, t.merchantId).access_version, 2);
      const me = await tc.request('GET', '/api/v1/auth/me');
      assert.equal(me.json.merchant.status, 'approved');
      const audit = app.fixtureDb.prepare("SELECT actor_user_id, target_id, metadata, request_id, created_at FROM audit_logs WHERE action = 'merchant.status_changed'").get() as any;
      assert.equal(audit.actor_user_id, admin.id);
      assert.equal(audit.target_id, t.merchantId);
      assert.deepEqual(JSON.parse(audit.metadata), { from: 'pending', to: 'approved', sessions_revoked: 0, version: 2 });
      assert.match(audit.request_id, /^[0-9a-f-]{36}$/);
      const detail = await c.request('GET', `/api/v1/admin/merchants/${t.merchantId}`);
      assert.deepEqual(detail.json.statusHistory.map((h: any) => [h.from, h.to, h.actor]), [['pending', 'approved', admin.username]]);
    }));

  test('suspension revokes every session immediately and requires a reason', () =>
    withApp(async (app) => {
      const admin = await createAdmin(app);
      const t = await createTrader(app, { status: 'approved' });
      const devices = [await signedIn(app, t), await signedIn(app, t), await signedIn(app, t)];
      const c = await signedIn(app, admin);
      expectCode(await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'suspended', expectedVersion: 1 } }), 400, 'VALIDATION_FAILED');
      assert.equal(merchantRow(app, t.merchantId).status, 'approved');
      const r = await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'suspended', expectedVersion: 1, reason: 'مخالفة شروط التعامل' } });
      assert.equal(r.status, 200, r.body);
      assert.equal(r.json.sessionsRevoked, 3);
      assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE user_id = ?', t.id), 0);
      for (const d of devices) expectCode(await d.request('GET', '/api/v1/auth/me'), 401, 'UNAUTHENTICATED');
      expectCode(await new Client(app, ip()).login(t.username, t.password), 401, 'INVALID_CREDENTIALS');
      const audit = app.fixtureDb.prepare("SELECT metadata FROM audit_logs WHERE action = 'merchant.status_changed'").get() as any;
      assert.deepEqual(JSON.parse(audit.metadata), { from: 'approved', to: 'suspended', reason: 'مخالفة شروط التعامل', sessions_revoked: 3, version: 2 });
    }));

  test('returning an approved trader to pending removes existing access; same-state changes are refused', () =>
    withApp(async (app) => {
      const admin = await createAdmin(app);
      const t = await createTrader(app, { status: 'approved' });
      const tc = await signedIn(app, t);
      const c = await signedIn(app, admin);
      expectCode(await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'approved', expectedVersion: 1, reason: 'لا شيء' } }), 409, 'INVALID_STATE_TRANSITION');
      expectCode(await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'pending', expectedVersion: 1 } }), 400, 'VALIDATION_FAILED');
      const r = await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'pending', expectedVersion: 1, reason: 'إعادة مراجعة المستندات' } });
      assert.equal(r.status, 200, r.body);
      expectCode(await tc.request('GET', '/api/v1/auth/me'), 401, 'UNAUTHENTICATED');
      const again = await signedIn(app, t);
      assert.equal((await again.request('GET', '/api/v1/auth/me')).json.merchant.status, 'pending');
      for (const bad of [{ status: 'banned', expectedVersion: 2 }, { status: 'approved', expectedVersion: 2, role: 'admin' }, { status: 'approved' }, { status: 'approved', expectedVersion: 2, reason: 'x' }]) {
        expectCode(await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: bad }), 400, 'VALIDATION_FAILED');
      }
    }));

  test('stale administrator authentication: reads allowed with a live session, changes need recent authentication (428)', () =>
    withApp(async (app) => {
      const admin = await createAdmin(app);
      const t = await createTrader(app, { status: 'pending' });
      const c = await signedIn(app, admin);
      app.clock.advance(10 * MIN);
      await c.request('GET', '/api/v1/auth/me');
      app.clock.advance(6 * MIN);
      assert.equal((await c.request('GET', '/api/v1/admin/merchants')).status, 200);
      expectCode(await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'approved', expectedVersion: 1 } }), 428, 'RECENT_AUTH_REQUIRED');
      assert.equal(merchantRow(app, t.merchantId).status, 'pending');
      app.clock.advance(30_000);
      await c.login(admin.username, admin.password, admin.code());
      assert.equal((await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'approved', expectedVersion: 1 } })).status, 200);
    }));

  test('concurrent state changes with the same expected version: one succeeds, the other gets a conflict', () =>
    withApp(async (app) => {
      const admin = await createAdmin(app);
      const t = await createTrader(app, { status: 'approved' });
      const c1 = await signedIn(app, admin);
      app.clock.advance(30_000);
      const c2 = await signedIn(app, { ...admin, code: () => admin.code() });
      const [r1, r2] = await Promise.all([
        c1.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'suspended', expectedVersion: 1, reason: 'سبب أول' } }),
        c2.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'pending', expectedVersion: 1, reason: 'سبب ثان' } }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      assert.deepEqual(statuses, [200, 409]);
      const loser = r1.status === 409 ? r1 : r2;
      expectCode(loser, 409, 'VERSION_CONFLICT');
      assert.equal(loser.json.error.details.current.version, 2);
      assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'merchant.status_changed'"), 1);
    }));

  test('a failure in session revocation or audit rolls back the whole state change', () =>
    withApp(async (app) => {
      const admin = await createAdmin(app);
      const t = await createTrader(app, { status: 'approved' });
      const tc = await signedIn(app, t);
      const c = await signedIn(app, admin);
      const before = merchantRow(app, t.merchantId);
      const body = { status: 'suspended', expectedVersion: 1, reason: 'اختبار فشل' };
      app.fixtureDb.exec("CREATE TRIGGER test_block_revoke BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'simulated revocation failure'); END");
      const r1 = await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body });
      assert.equal(r1.status, 500);
      assert.deepEqual(merchantRow(app, t.merchantId), before, 'state unchanged when revocation fails');
      assert.equal((await tc.request('GET', '/api/v1/auth/me')).status, 200, 'not reported as suspended; sessions intact');
      app.fixtureDb.exec('DROP TRIGGER test_block_revoke');
      app.fixtureDb.exec("CREATE TRIGGER test_block_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'merchant.status_changed' BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END");
      const r2 = await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body });
      assert.equal(r2.status, 500);
      assert.deepEqual(merchantRow(app, t.merchantId), before, 'state unchanged when audit fails');
      assert.ok(count(app, 'SELECT count(*) FROM sessions WHERE user_id = ?', t.id) >= 1, 'revocation rolled back too');
      app.fixtureDb.exec('DROP TRIGGER test_block_audit');
      assert.equal((await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body })).status, 200);
      assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE user_id = ?', t.id), 0);
    }));

  test('administrator accounts cannot be suspended, demoted or promoted through merchant controls', () =>
    withApp(async (app) => {
      const admin = await createAdmin(app);
      const other = await createAdmin(app);
      const t = await createTrader(app, { status: 'approved' });
      const c = await signedIn(app, admin);
      for (const target of [admin.merchantId, other.merchantId]) {
        for (const status of ['suspended', 'pending']) {
          expectCode(await c.request('PATCH', `/api/v1/admin/merchants/${target}`, { body: { status, expectedVersion: 1, reason: 'محاولة غير مسموحة' } }), 403, 'ADMIN_ACCOUNT_PROTECTED');
        }
      }
      expectCode(await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'approved', expectedVersion: 1, role: 'admin' } }), 400, 'VALIDATION_FAILED');
      assert.equal(count(app, "SELECT count(*) FROM auth_users WHERE role = 'admin'"), 2);
      assert.equal((app.fixtureDb.prepare('SELECT role FROM auth_users WHERE id = ?').get(t.id) as any).role, 'trader');
      assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE user_id IN (?, ?)', admin.id, other.id), 1);
    }));
});

describe('races with in-flight operations', () => {
  test('ABA: approved -> suspended -> approved during an in-flight login invalidates the verification', () =>
    withApp(
      async (app) => {
        const hasher = app.hasher as GatedHasher;
        const admin = await createAdmin(app);
        const t = await createTrader(app, { status: 'approved' });
        const ac = await signedIn(app, admin);
        const c = new Client(app, ip());
        await c.preLogin();
        const arrived = hasher.pause();
        const pending = c.request('POST', '/api/v1/auth/login', { body: { username: t.username, password: t.password } });
        await arrived;
        // The trader's login is paused after password verification; administrator PATCHes do not verify passwords.
        assert.equal((await ac.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'suspended', expectedVersion: 1, reason: 'تعليق مؤقت' } })).status, 200);
        assert.equal((await ac.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'approved', expectedVersion: 2, reason: 'إعادة التفعيل' } })).status, 200);
        assert.equal(merchantRow(app, t.merchantId).status, 'approved', 'final status equals the initial one (ABA)');
        hasher.release();
        expectCode(await pending, 401, 'INVALID_CREDENTIALS');
        assert.equal(count(app, 'SELECT count(*) FROM sessions WHERE user_id = ?', t.id), 0);
        assert.equal(count(app, "SELECT count(*) FROM audit_logs WHERE action = 'auth.login_failed' AND metadata LIKE '%access_changed%'"), 1);
        assert.equal((await new Client(app, ip()).login(t.username, t.password)).status, 200, 'a fresh login works');
      },
      { hasher: new GatedHasher() },
    ));

  test('an in-flight password change cannot outlive a suspension', () =>
    withApp(
      async (app) => {
        const hasher = app.hasher as GatedHasher;
        const admin = await createAdmin(app);
        const t = await createTrader(app, { status: 'approved' });
        const ac = await signedIn(app, admin);
        const tc = await signedIn(app, t);
        const arrived = hasher.pause();
        const pending = tc.request('POST', '/api/v1/auth/password', { body: { currentPassword: t.password, newPassword: 'Should-Not-Apply-777' } });
        await arrived;
        assert.equal((await ac.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'suspended', expectedVersion: 1, reason: 'تعليق' } })).status, 200);
        hasher.release();
        expectCode(await pending, 401, 'UNAUTHENTICATED');
        app.fixtureDb.prepare("UPDATE merchants SET status = 'approved', access_version = access_version + 1, version = version + 1 WHERE id = ?").run(t.merchantId);
        assert.equal((await new Client(app, ip()).login(t.username, t.password)).status, 200, 'old password still valid: the stale change was not applied');
      },
      { hasher: new GatedHasher() },
    ));

  test('a profile edit in flight when the account is suspended is refused at commit', () =>
    withApp(async (app) => {
      const admin = await createAdmin(app);
      const t = await createTrader(app, { status: 'approved' });
      const ac = await signedIn(app, admin);
      const tc = await signedIn(app, t);
      const r = await tc.requestSlow('PATCH', '/api/v1/merchant/profile', { expectedVersion: 1, address: '7 شارع بعد التعليق' }, async () => {
        assert.equal((await ac.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'suspended', expectedVersion: 1, reason: 'تعليق' } })).status, 200);
      });
      expectCode(r, 401, 'UNAUTHENTICATED');
      assert.equal(merchantRow(app, t.merchantId).address, '12 شارع التجربة');
    }));

  test('administrator recency that lapses while the request is in flight is re-checked at commit (428)', () =>
    withApp(async (app) => {
      const admin = await createAdmin(app);
      const t = await createTrader(app, { status: 'pending' });
      const ac = await signedIn(app, admin);
      app.clock.advance(14 * MIN + 50_000); // still recent when the request starts
      await ac.request('GET', '/api/v1/auth/me');
      const r = await ac.requestSlow('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { status: 'approved', expectedVersion: 1 }, () => app.clock.advance(20_000));
      expectCode(r, 428, 'RECENT_AUTH_REQUIRED');
      assert.equal(merchantRow(app, t.merchantId).status, 'pending');
    }));

  test('an administrator whose session is revoked mid-request cannot complete a state change', () =>
    withApp(async (app) => {
      const admin = await createAdmin(app);
      const t = await createTrader(app, { status: 'pending' });
      const ac = await signedIn(app, admin);
      const r = await ac.requestSlow('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { status: 'approved', expectedVersion: 1 }, () => {
        app.fixtureDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(admin.id);
      });
      expectCode(r, 401, 'UNAUTHENTICATED');
      assert.equal(merchantRow(app, t.merchantId).status, 'pending');
    }));
});

describe('secret-free audit records', () => {
  test('merchant audit metadata holds no credentials, tokens or full profiles', () =>
    withApp(async (app) => {
      const admin = await createAdmin(app);
      const t = await createTrader(app, { status: 'pending' });
      const tc = await signedIn(app, t);
      await tc.request('PATCH', '/api/v1/merchant/profile', { body: { expectedVersion: 1, email: 'private.person@example.com', phone: '01099988877' } });
      const c = await signedIn(app, admin);
      await c.request('PATCH', `/api/v1/admin/merchants/${t.merchantId}`, { body: { status: 'approved', expectedVersion: 2 } });
      const audit = JSON.stringify(app.fixtureDb.prepare("SELECT * FROM audit_logs WHERE action LIKE 'merchant.%'").all());
      for (const s of [t.password, admin.password, tc.sessionToken()!, c.sessionToken()!, tc.csrf!, 'private.person@example.com', '01099988877', 'password_hash', 'totp']) {
        assert.ok(!audit.includes(s), `audit contains ${s.slice(0, 10)}`);
      }
    }));
});
