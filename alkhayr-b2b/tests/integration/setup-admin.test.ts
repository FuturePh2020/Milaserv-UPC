import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { baseEnv, createTempApp, projectRoot, rawRequest, runCli, runUntilExit, startServer, type TempApp } from '../helpers/server.ts';

// Disposable fixture credentials (tests only).
const PASSWORD = 'Pty-Fixture-Admin-Passphrase-77';
const APP_SECRET = randomBytes(32).toString('base64url');
const BACKUP_KEY = randomBytes(32).toString('base64url');
const env = (extra: Record<string, string> = {}) => baseEnv({ APP_SECRET, BACKUP_KEY, ...extra });

interface PtyResult {
  exit: number | null;
  error: string | null;
  transcript: string;
}

/** Runs `cli.js setup-admin` inside a real pseudo-terminal and answers its prompts. */
function runInPty(app: TempApp, steps: Array<{ expect: string; send: string | null }>, extraEnv: Record<string, string> = {}): PtyResult {
  const cfg = {
    argv: [process.execPath, path.join(app.distDir, 'server', 'cli.js'), 'setup-admin'],
    env: { ...env(extraEnv), TERM: 'dumb' },
    cwd: app.root,
    timeout: 60,
    steps,
  };
  const out = execFileSync('python3', ['-I', path.join(projectRoot, 'tests', 'helpers', 'pty_driver.py'), JSON.stringify(cfg)], {
    encoding: 'utf8',
    timeout: 90_000,
  });
  return JSON.parse(out) as PtyResult;
}

const profileSteps: Array<{ expect: string; send: string | null }> = [
  { expect: 'Administrator username: ', send: 'pty.admin' },
  { expect: 'Business name: ', send: 'شركة الخير للاستيراد' },
  { expect: 'Contact person: ', send: 'أحمد محمود' },
  { expect: 'Phone \\(e\\.g\\. 01012345678\\): ', send: '01012345678' },
  { expect: 'Governorate: ', send: 'القاهرة' },
  { expect: 'Address: ', send: '12 شارع التحرير، وسط البلد' },
  { expect: 'Email \\(optional, Enter to skip\\): ', send: '' },
];

let app: TempApp;
before(async () => {
  app = await createTempApp();
});
after(async () => app?.cleanup());

describe('setup-admin refuses non-interactive use and arguments', () => {
  test('stdin that is not a terminal is refused; nothing is saved', async () => {
    const r = await runCli(app, ['setup-admin'], env());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /NOT_INTERACTIVE/);
    const db = new DatabaseSync(app.databasePath, { readOnly: true });
    assert.equal(Object.values(db.prepare('SELECT count(*) FROM auth_users').get() as object)[0], 0);
    db.close();
  });

  test('a password given as an argument is refused and never echoed', async () => {
    const r = await runCli(app, ['setup-admin', '--password', 'SecretGivenAsArgument123'], env());
    assert.equal(r.code, 2);
    assert.match(r.stderr, /never accepted as arguments/);
    assert.ok(!r.stderr.includes('SecretGivenAsArgument123') && !r.stdout.includes('SecretGivenAsArgument123'));
  });
});

describe('setup-admin in a real pseudo-terminal', () => {
  test('Ctrl-C at the hidden password prompt cancels; nothing saved', () => {
    const r = runInPty(app, [...profileSteps, { expect: 'New administrator password: ', send: '{CTRL_C}' }]);
    assert.equal(r.error, null, r.transcript);
    assert.equal(r.exit, 1, r.transcript);
    assert.match(r.transcript, /Cancelled\. Nothing was saved\./);
    const db = new DatabaseSync(app.databasePath, { readOnly: true });
    assert.equal(Object.values(db.prepare('SELECT count(*) FROM auth_users').get() as object)[0], 0);
    db.close();
  });

  test('full enrollment: hidden password is not echoed, TOTP proof required, then server runs with the admin', async () => {
    const r = runInPty(app, [
      ...profileSteps,
      { expect: 'New administrator password: ', send: PASSWORD },
      { expect: 'Confirm password: ', send: PASSWORD },
      { expect: 'Enter the current 6-digit code to confirm enrollment: ', send: '{TOTP}' },
      { expect: 'created with MFA enrollment confirmed', send: null },
    ]);
    assert.equal(r.exit, 0, `${r.error}\n${r.transcript}`);
    assert.ok(!r.transcript.includes(PASSWORD), 'the password must never be echoed to the terminal');
    assert.match(r.transcript, /Secret: ([A-Z2-7]{4} ){7}[A-Z2-7]{4}/);
    assert.match(r.transcript, /otpauth:\/\/totp\/ALKHAYR:pty\.admin\?secret=/);
    assert.match(r.transcript, /Do NOT paste it into online QR-code generators/);
    assert.match(r.transcript, /Web login is NOT available yet/);
    const secretB32 = /Secret: ([A-Z2-7 ]+)\r?\n/.exec(r.transcript)![1]!.replace(/ /g, '');

    // Database holds only the hash and the encrypted secret.
    const files = [app.databasePath, `${app.databasePath}-wal`].filter(existsSync).map((f) => readFileSync(f));
    for (const f of files) {
      assert.ok(!f.includes(Buffer.from(PASSWORD)), 'plaintext password in database file');
      assert.ok(!f.includes(Buffer.from(secretB32)), 'plaintext TOTP secret in database file');
    }

    const s = await startServer(app, env());
    try {
      assert.match(s.stdout(), /"administrators":1/);
      assert.ok(!/no_administrator/.test(s.stderr()));
      for (const p of ['/', '/healthz', '/readyz', '/api/v1/auth/login', '/api/v1/auth/me', '/api/v1/admin/setup']) {
        const res = await rawRequest(s.port, { path: p });
        assert.ok(!res.body.includes(PASSWORD) && !res.body.includes(secretB32), p);
      }
      const login = await rawRequest(s.port, { method: 'POST', path: '/api/v1/auth/login', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pty.admin', password: PASSWORD }) });
      assert.equal(login.status, 404, 'login is not implemented before stage 04 and must not pretend to work');
      assert.equal(login.headers['set-cookie'], undefined);
    } finally {
      await s.stop();
    }
    const logs = s.stdout() + s.stderr();
    assert.ok(!logs.includes(PASSWORD) && !logs.includes(secretB32) && !logs.includes(APP_SECRET), 'secrets in server logs');
  });

  test('a second run is refused (no promotion, no duplicate admin)', async () => {
    const pty = runInPty(app, []);
    assert.equal(pty.exit, 1, pty.transcript);
    assert.match(pty.transcript, /ADMIN_EXISTS/);
  });

  test('server refuses to start with a different APP_SECRET (MFA_KEY_MISMATCH) or none, and changes nothing', async () => {
    const before = readFileSync(app.databasePath);
    const wrong = await runUntilExit(app, env({ APP_SECRET: randomBytes(32).toString('base64url') }));
    assert.equal(wrong.code, 1);
    assert.match(wrong.stderr, /"code":"MFA_KEY_MISMATCH"/);
    assert.match(wrong.stderr, /Restore the original APP_SECRET/);
    const none = await runUntilExit(app, baseEnv());
    assert.equal(none.code, 1);
    assert.match(none.stderr, /"code":"APP_SECRET_REQUIRED"/);
    assert.deepEqual(readFileSync(app.databasePath), before, 'database unchanged by refused startups');
    const ok = await startServer(app, env());
    await ok.stop();
  });

  test('without an administrator the server warns but starts (setup is a local operator step)', async () => {
    const fresh = await createTempApp();
    try {
      const s = await startServer(fresh, env());
      try {
        for (let i = 0; i < 40 && !/"event":"no_administrator"/.test(s.stderr()); i++) await new Promise((r) => setTimeout(r, 50));
        assert.match(s.stderr(), /"event":"no_administrator"/);
        assert.equal((await rawRequest(s.port, { path: '/readyz' })).status, 200);
      } finally {
        await s.stop();
      }
    } finally {
      await fresh.cleanup();
    }
  });
});
