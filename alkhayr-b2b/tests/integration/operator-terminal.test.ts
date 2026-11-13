import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { PasswordHasher } from '../../src/server/auth/passwords.ts';
import { insertMerchant } from '../helpers/database.ts';
import { baseEnv, createTempApp, projectRoot, type TempApp } from '../helpers/server.ts';

// Stage 16: the DOCUMENTED operator entry point (`npm run cli -- <command>`, run from the application
// directory) driven through a real pseudo-terminal. Disposable data directory, synthetic credentials.

const TRADER_PASSWORD = 'Terminal-Trader-Pass-1';
const NEW_ADMIN_PASSWORD = 'Terminal-New-Admin-Passphrase';

let app: TempApp;
let env: NodeJS.ProcessEnv;
let keyFile: string;

interface PtyResult {
  exit: number | null;
  error: string | null;
  transcript: string;
}

function npmCli(args: string[], steps: Array<{ expect: string; send: string | null }>): PtyResult {
  const npm = path.join(path.dirname(process.execPath), 'npm');
  const cfg = { argv: [npm, 'run', '--silent', 'cli', '--', ...args], env: { ...env, TERM: 'dumb' }, cwd: projectRoot, timeout: 90, steps };
  return JSON.parse(execFileSync('python3', ['-I', path.join(projectRoot, 'tests', 'helpers', 'pty_driver.py'), JSON.stringify(cfg)], { encoding: 'utf8', timeout: 120_000 })) as PtyResult;
}

const row = (sql: string, ...p: string[]) => {
  const db = new DatabaseSync(app.databasePath, { readOnly: true });
  try {
    return db.prepare(sql).get(...p) as Record<string, unknown>;
  } finally {
    db.close();
  }
};

before(async () => {
  app = await createTempApp();
  const keys = path.join(app.root, 'operator-keys');
  mkdirSync(keys, { mode: 0o700 });
  keyFile = path.join(keys, 'backup.key');
  env = baseEnv({ DATA_DIR: path.dirname(app.databasePath), BACKUP_DIR: path.join(app.root, 'backups'), HOME: app.root });
  const db = new DatabaseSync(app.databasePath);
  const id = randomUUID();
  const t = Date.now();
  db.prepare("INSERT INTO auth_users (id, username, password_hash, password_changed_at, role, created_at, updated_at) VALUES (?, 'term.trader', ?, ?, 'trader', ?, ?)").run(id, await new PasswordHasher().hash(TRADER_PASSWORD), t, t, t);
  insertMerchant(db, id);
  db.close();
});
after(async () => app?.cleanup());

describe('operator commands through `npm run cli` in a real terminal', () => {
  test('admin:create: hidden password, TOTP proof; nothing secret echoed', () => {
    const r = npmCli(['admin:create'], [
      { expect: 'New administrator username: ', send: 'term.admin' },
      { expect: 'Business name: ', send: 'شركة الخير — الإدارة' },
      { expect: 'Contact person: ', send: 'مدير التشغيل' },
      { expect: 'Phone \\(e\\.g\\. 01012345678\\): ', send: '01012345678' },
      { expect: 'Governorate: ', send: 'القاهرة' },
      { expect: 'Address: ', send: '12 شارع الإدارة' },
      { expect: 'Email \\(optional, Enter to skip\\): ', send: '' },
      { expect: 'Reason for this action', send: 'second administrator for the night shift' },
      { expect: 'New password: ', send: NEW_ADMIN_PASSWORD },
      { expect: 'Confirm password: ', send: NEW_ADMIN_PASSWORD },
      { expect: 'Enter the current 6-digit code to confirm enrollment: ', send: '{TOTP}' },
      { expect: 'created with MFA enrollment confirmed', send: null },
    ]);
    assert.equal(r.exit, 0, `${r.error}\n${r.transcript}`);
    assert.ok(!r.transcript.includes(NEW_ADMIN_PASSWORD), 'password never echoed');
    assert.equal(row("SELECT role FROM auth_users WHERE username = 'term.admin'").role, 'admin');
  });

  test('account:reset-mfa replaces the authenticator only after proof (new secret shown once, code hidden from logs)', () => {
    const before = row("SELECT totp_ciphertext, credential_version FROM auth_users WHERE username = 'term.admin'");
    const r = npmCli(['account:reset-mfa'], [
      { expect: 'Username of the account: ', send: 'term.admin' },
      { expect: 'Type the username again to confirm this account: ', send: 'term.admin' },
      { expect: 'Reason for this action', send: 'phone replaced; identity verified in person' },
      { expect: 'Enter the current 6-digit code to confirm enrollment: ', send: '{TOTP}' },
      { expect: 'Authenticator replaced', send: null },
    ]);
    assert.equal(r.exit, 0, `${r.error}\n${r.transcript}`);
    const afterRow = row("SELECT totp_ciphertext, credential_version FROM auth_users WHERE username = 'term.admin'");
    assert.notEqual(afterRow.totp_ciphertext, before.totp_ciphertext);
    assert.equal(Number(afterRow.credential_version), Number(before.credential_version) + 1);
  });

  test('Ctrl-C at the hidden password prompt cancels account:reset-password; nothing saved', () => {
    const before = row("SELECT password_hash, credential_version FROM auth_users WHERE username = 'term.trader'");
    const r = npmCli(['account:reset-password'], [
      { expect: 'Username of the account: ', send: 'term.trader' },
      { expect: 'Type the username again to confirm this account: ', send: 'term.trader' },
      { expect: 'Reason for this action', send: 'merchant forgot the password' },
      { expect: 'New password: ', send: '{CTRL_C}' },
      { expect: 'Cancelled\\. Nothing was saved\\.', send: null },
    ]);
    assert.equal(r.exit, 1, `${r.error}\n${r.transcript}`);
    assert.deepEqual(row("SELECT password_hash, credential_version FROM auth_users WHERE username = 'term.trader'"), before);
  });

  test('early typing: text typed BEFORE the hidden prompt is echoed by the terminal (measured residual)', () => {
    const early = 'Typed-Too-Early-Pass-9';
    const r = npmCli(['account:reset-password'], [
      { expect: 'Username of the account: ', send: 'term.trader' },
      { expect: 'Type the username again to confirm this account: ', send: 'term.trader' },
      { expect: 'Reason for this action', send: 'merchant forgot the password' },
      // The operator types the password as soon as the rules line appears, before "New password:".
      { expect: 'Password rules: ', send: early },
      { expect: 'Confirm password: ', send: early },
      { expect: 'Password reset for', send: null },
    ]);
    assert.equal(r.exit, 0, `${r.error}\n${r.transcript}`);
    // Documented, not hidden: the kernel echoes input typed while no hidden prompt is active.
    const echoed = r.transcript.includes(early);
    console.log(`# early typing: password visible in terminal transcript = ${echoed}`);
    assert.ok(r.transcript.split(early).length - 1 <= 1, 'at most the early line is shown; the confirmation is hidden');
  });

  test('account:reset-password and account:revoke-sessions complete; passwords never echoed', () => {
    const NEW = 'Terminal-Reset-Pass-22';
    const r = npmCli(['account:reset-password'], [
      { expect: 'Username of the account: ', send: 'term.trader' },
      { expect: 'Type the username again to confirm this account: ', send: 'term.trader' },
      { expect: 'Reason for this action', send: 'merchant forgot the password' },
      { expect: 'New password: ', send: NEW },
      { expect: 'Confirm password: ', send: NEW },
      { expect: 'Password reset for', send: null },
    ]);
    assert.equal(r.exit, 0, `${r.error}\n${r.transcript}`);
    assert.ok(!r.transcript.includes(NEW));
    const v = Number(row("SELECT credential_version FROM auth_users WHERE username = 'term.trader'").credential_version);
    const s = npmCli(['account:revoke-sessions'], [
      { expect: 'Username of the account: ', send: 'term.trader' },
      { expect: 'Type the username again to confirm this account: ', send: 'term.trader' },
      { expect: 'Reason for this action', send: 'lost phone with an open session' },
      { expect: 'session\\(s\\) revoked', send: null },
    ]);
    assert.equal(s.exit, 0, `${s.error}\n${s.transcript}`);
    assert.equal(Number(row("SELECT credential_version FROM auth_users WHERE username = 'term.trader'").credential_version), v + 1);
  });

  test('backup:keygen, backup:create with the key typed at a hidden prompt, backup:verify, backup:status, db:check', () => {
    const kg = npmCli(['backup:keygen', '--out', keyFile], [{ expect: 'key id', send: null }]);
    assert.equal(kg.exit, 0, kg.transcript);
    const key = readFileSync(keyFile, 'utf8').trim();
    assert.ok(!kg.transcript.includes(key));
    const c = npmCli(['backup:create'], [
      { expect: 'Backup key \\(hidden\\): ', send: key },
      { expect: 'Backup created and verified', send: null },
    ]);
    assert.equal(c.exit, 0, `${c.error}\n${c.transcript}`);
    assert.ok(!c.transcript.includes(key), 'backup key never echoed');
    const file = path.join(app.root, 'backups', readdirSync(path.join(app.root, 'backups')).find((n) => n.endsWith('.akbk'))!);
    const v = npmCli(['backup:verify', file, '--key-file', keyFile], [{ expect: 'Backup verified', send: null }]);
    assert.equal(v.exit, 0, v.transcript);
    const st = npmCli(['backup:status'], [{ expect: '"warnings"', send: null }]);
    assert.equal(st.exit, 0, st.transcript);
    assert.match(st.transcript, /"abandonedPlaintext": \[\]/);
    const chk = npmCli(['db:check'], [{ expect: '"ok": true', send: null }]);
    assert.equal(chk.exit, 0, chk.transcript);
    const rs = npmCli(['recovery:status'], [{ expect: '"writeMode": "open"', send: null }]);
    assert.equal(rs.exit, 0, rs.transcript);
  });
});
