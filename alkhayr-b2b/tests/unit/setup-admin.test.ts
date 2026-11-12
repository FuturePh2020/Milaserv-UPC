import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { decryptSecret, deriveKey, totpAad } from '../../src/server/auth/encryption.ts';
import { PasswordHasher } from '../../src/server/auth/passwords.ts';
import { base32Decode, totpCode, totpStep } from '../../src/server/auth/totp.ts';
import { CancelledError, type Prompter } from '../../src/server/cli/prompt.ts';
import { setupAdmin } from '../../src/server/cli/setup-admin.ts';
import { loadConfig, type AppConfig } from '../../src/server/config.ts';
import { openDatabase } from '../../src/server/database/connection.ts';
import { acquireInstanceLock } from '../../src/server/database/instance-lock.ts';
import { applyMigrations, loadMigrations } from '../../src/server/database/migrations.ts';
import { BootstrapError, createAdministrator } from '../../src/server/services/admin-bootstrap.ts';
import { insertMerchant, insertUser, LATEST_VERSION, MIGRATIONS_DIR, nextMigrationFile, tempDir } from '../helpers/database.ts';

// Disposable fixture credentials (tests only; never seeded anywhere).
const PASSWORD = 'Fixture-Admin-Passphrase-2026!';
const NOW = 1_794_500_000_000;

type Answer = string | Error | ((output: string[]) => string);

function scriptedPrompter(answers: Answer[]): Prompter & { output: string[]; asked: string[]; closed: boolean } {
  const output: string[] = [];
  const asked: string[] = [];
  const next = (question: string): Promise<string> => {
    asked.push(question);
    output.push(question);
    const a = answers.shift();
    if (a === undefined) return Promise.reject(new Error(`unexpected prompt: ${question}`));
    if (a instanceof Error) return Promise.reject(a);
    return Promise.resolve(typeof a === 'function' ? a(output) : a);
  };
  const p = {
    output,
    asked,
    closed: false,
    ask: next,
    askHidden: next,
    say: (line: string) => void output.push(line),
    close: () => {
      p.closed = true;
    },
  };
  return p;
}

/** Computes the current code from the secret the CLI displayed to the operator. */
const totpFromOutput = (offsetSteps = 0) => (output: string[]) => {
  const line = output.find((l) => l.trim().startsWith('Secret:'));
  assert.ok(line, 'secret was displayed');
  const secret = base32Decode(line.replace(/^\s*Secret:\s*/, '').replace(/\s+/g, ''));
  return totpCode(secret, NOW + offsetSteps * 30_000);
};

const PROFILE_ANSWERS = ['شركة الخير للاستيراد', 'أحمد محمود', '٠١٠١٢٣٤٥٦٧٨', 'القاهرة', '12 شارع التحرير، وسط البلد', 'ops@example.com'];
const happyAnswers = (username = 'Admin.One'): Answer[] => [username, ...PROFILE_ANSWERS, PASSWORD, PASSWORD, totpFromOutput()];

interface Env {
  root: string;
  config: AppConfig;
  appSecret: string;
}

function env(options: { init?: boolean; appSecret?: string | null } = {}): Env {
  const root = tempDir('alkhayr-setup-');
  const appSecret = options.appSecret === undefined ? randomBytes(32).toString('base64url') : options.appSecret;
  const config = loadConfig(
    { DATA_DIR: './data', ...(appSecret ? { APP_SECRET: appSecret, BACKUP_KEY: randomBytes(32).toString('base64url') } : {}) },
    { baseDir: root },
  );
  if (options.init !== false) {
    const db = openDatabase(config.databasePath, { mustExist: false });
    applyMigrations(db, loadMigrations(MIGRATIONS_DIR));
    db.close();
  }
  return { root, config, appSecret: appSecret ?? '' };
}

async function run(e: Env, answers: Answer[], extra: { migrationsDir?: string } = {}) {
  const prompter = scriptedPrompter(answers);
  const errors: string[] = [];
  const code = await setupAdmin({
    config: e.config,
    migrationsDir: extra.migrationsDir ?? MIGRATIONS_DIR,
    prompter,
    err: (l) => void errors.push(l),
    now: () => NOW,
  });
  return { code, prompter, errors: errors.join('\n'), remainingAnswers: answers.length };
}

function rows(e: Env, sql: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(e.config.databasePath, { readOnly: true });
  try {
    return db.prepare(sql).all().map((r) => ({ ...r }));
  } finally {
    db.close();
  }
}

const count = (e: Env, table: string) => Number(rows(e, `SELECT count(*) AS n FROM ${table}`)[0]!.n);

function assertNothingSaved(e: Env) {
  assert.equal(count(e, 'auth_users'), 0);
  assert.equal(count(e, 'merchants'), 0);
  assert.equal(count(e, 'audit_logs'), 0);
}

describe('setup-admin: successful enrollment', () => {
  test('creates exactly one admin, an approved profile and a secret-free audit event, atomically', async () => {
    const e = env();
    const r = await run(e, happyAnswers());
    assert.equal(r.code, 0, r.errors);
    assert.equal(r.prompter.closed, true);

    const users = rows(e, 'SELECT * FROM auth_users');
    assert.equal(users.length, 1);
    const u = users[0]!;
    assert.equal(u.role, 'admin');
    assert.equal(u.username, 'admin.one', 'username normalized');
    assert.equal(u.password_changed_at, NOW);
    assert.equal(u.last_otp_step, totpStep(NOW), 'anti-replay baseline = proven enrollment step');

    assert.equal(await new PasswordHasher().verify(PASSWORD, u.password_hash as string), true);
    const shown = base32Decode(r.prompter.output.find((l) => l.trim().startsWith('Secret:'))!.replace(/^\s*Secret:\s*/, '').replace(/\s+/g, ''));
    const stored = decryptSecret(deriveKey(e.config.appSecret, 'totp'), u.totp_ciphertext, totpAad(u.id as string));
    assert.deepEqual(stored, shown);

    const merchants = rows(e, 'SELECT * FROM merchants');
    assert.equal(merchants.length, 1);
    assert.equal(merchants[0]!.user_id, u.id);
    assert.equal(merchants[0]!.status, 'approved');
    assert.equal(merchants[0]!.phone, '01012345678');
    assert.equal(merchants[0]!.email, 'ops@example.com');

    const audit = rows(e, 'SELECT * FROM audit_logs');
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.action, 'admin.bootstrap');
    assert.equal(audit[0]!.actor_user_id, u.id);
    assert.deepEqual(JSON.parse(audit[0]!.metadata as string), { method: 'cli', mfa: 'totp' });

    // No plaintext password or TOTP secret anywhere in the database files.
    const files = [e.config.databasePath, `${e.config.databasePath}-wal`].filter(existsSync).map((f) => readFileSync(f));
    for (const needle of [PASSWORD, shown.toString('hex'), shown.toString('base64url'), r.prompter.output.find((l) => l.includes('Secret:'))!.replace(/\s+/g, '').slice(7)]) {
      for (const f of files) assert.ok(!f.includes(Buffer.from(needle)), `database file contains ${needle.slice(0, 6)}…`);
    }
    // The password is never written to operator output.
    assert.ok(!r.prompter.output.join('\n').includes(PASSWORD));
    assert.ok(r.prompter.output.some((l) => /wait for the NEXT 30-second code/.test(l)), 'explains the replay baseline');
  });

  test('re-prompts for weak or mismatched passwords; a code from the next period is accepted (±1 window)', async () => {
    const e = env();
    const r = await run(e, ['admin.two', ...PROFILE_ANSWERS, 'short-pass', PASSWORD, 'different-confirmation!!', PASSWORD, PASSWORD, totpFromOutput(1)]);
    assert.equal(r.code, 0, r.errors);
    const text = r.prompter.output.join('\n');
    assert.match(text, /at least 15 characters/);
    assert.match(text, /do not match/);
    assert.equal(rows(e, 'SELECT last_otp_step AS s FROM auth_users')[0]!.s, totpStep(NOW) + 1);
  });
});

describe('setup-admin: preconditions (nothing created or migrated as a side effect)', () => {
  test('requires APP_SECRET', async () => {
    const e = env({ appSecret: null });
    const r = await run(e, happyAnswers());
    assert.equal(r.code, 1);
    assert.match(r.errors, /APP_SECRET_REQUIRED/);
    assert.equal(r.prompter.asked.length, 0);
    assertNothingSaved(e);
  });

  test('missing database: refused, no file created', async () => {
    const e = env({ init: false });
    const r = await run(e, happyAnswers());
    assert.equal(r.code, 1);
    assert.match(r.errors, /DATABASE_MISSING.*db:init/);
    assert.equal(existsSync(e.config.databasePath), false);
  });

  test('uninitialized (empty) database: refused and not migrated', async () => {
    const e = env({ init: false });
    mkdirSync(path.dirname(e.config.databasePath), { recursive: true, mode: 0o700 });
    new DatabaseSync(e.config.databasePath).close();
    const r = await run(e, happyAnswers());
    assert.equal(r.code, 1);
    assert.match(r.errors, /DATABASE_UNINITIALIZED/);
    assert.equal(rows(e, "SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table'")[0]!.n, 0);
  });

  test('foreign SQLite database: refused, untouched', async () => {
    const e = env({ init: false });
    mkdirSync(path.dirname(e.config.databasePath), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(e.config.databasePath);
    db.exec("CREATE TABLE customers (name TEXT); INSERT INTO customers VALUES ('keep');");
    db.close();
    const r = await run(e, happyAnswers());
    assert.equal(r.code, 1);
    assert.match(r.errors, /NO_MIGRATION_HISTORY/);
    assert.equal(rows(e, 'SELECT name FROM customers')[0]!.name, 'keep');
  });

  test('pending migrations: refused, not migrated', async () => {
    const e = env();
    const dir = path.join(tempDir(), 'migrations');
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    writeFileSync(path.join(dir, nextMigrationFile('next')), 'CREATE INDEX merchants_contact_idx ON merchants (contact_name);\n');
    const r = await run(e, happyAnswers(), { migrationsDir: dir });
    assert.equal(r.code, 1);
    assert.match(r.errors, /MIGRATIONS_PENDING/);
    assert.equal(rows(e, 'PRAGMA user_version')[0]!.user_version, LATEST_VERSION);
  });

  test('refused while the server (or another operator command) holds the instance lock', async () => {
    const e = env();
    const lock = acquireInstanceLock(e.config.dataDir, 'test server');
    try {
      const r = await run(e, happyAnswers());
      assert.equal(r.code, 1);
      assert.match(r.errors, /INSTANCE_LOCKED/);
      assert.equal(r.prompter.closed, true);
    } finally {
      lock.release();
    }
    assertNothingSaved(e);
  });
});

describe('setup-admin: conflicts', () => {
  test('a second bootstrap is refused before any prompt', async () => {
    const e = env();
    assert.equal((await run(e, happyAnswers())).code, 0);
    const again = await run(e, happyAnswers('admin.three'));
    assert.equal(again.code, 1);
    assert.match(again.errors, /ADMIN_EXISTS/);
    assert.equal(again.prompter.asked.length, 0);
    assert.equal(count(e, 'auth_users'), 1);
  });

  test('an existing trader username (any casing) is refused and never promoted', async () => {
    const e = env();
    const db = new DatabaseSync(e.config.databasePath);
    const traderId = insertUser(db, { username: 'trader.ahmed' });
    insertMerchant(db, traderId, { status: 'approved' });
    db.close();
    const r = await run(e, ['trader.ahmed', 'TRADER.AHMED', ' Trader.Ahmed ']);
    assert.equal(r.code, 1);
    assert.match(r.errors, /Too many invalid attempts\. Nothing was saved\./);
    assert.match(r.prompter.output.join('\n'), /never promoted/);
    assert.deepEqual(rows(e, 'SELECT role, username FROM auth_users'), [{ role: 'trader', username: 'trader.ahmed' }]);
    assert.equal(count(e, 'audit_logs'), 0);
  });
});

describe('setup-admin: cancellation and failed enrollment leave nothing behind', () => {
  test('cancel at the password prompt', async () => {
    const e = env();
    const r = await run(e, ['admin.one', ...PROFILE_ANSWERS, new CancelledError()]);
    assert.equal(r.code, 1);
    assert.match(r.errors, /Cancelled\. Nothing was saved\./);
    assertNothingSaved(e);
  });

  test('cancel at the TOTP prompt (after hashing)', async () => {
    const e = env();
    const r = await run(e, ['admin.one', ...PROFILE_ANSWERS, PASSWORD, PASSWORD, new CancelledError()]);
    assert.equal(r.code, 1);
    assertNothingSaved(e);
  });

  test('three wrong or stale TOTP codes', async () => {
    const e = env();
    const r = await run(e, ['admin.one', ...PROFILE_ANSWERS, PASSWORD, PASSWORD, '000000', totpFromOutput(-2), totpFromOutput(2)]);
    assert.equal(r.code, 1);
    assert.match(r.errors, /Nothing was saved/);
    assertNothingSaved(e);
  });

  test('invalid profile input is re-prompted, and exhaustion saves nothing', async () => {
    const e = env();
    const r = await run(e, ['admin.one', 'x', 'y', 'z']);
    assert.equal(r.code, 1);
    assertNothingSaved(e);
  });
});

describe('createAdministrator atomicity', () => {
  const prepared = (overrides: Partial<Parameters<typeof createAdministrator>[1]> = {}) => ({
    userId: randomUUID(),
    merchantId: randomUUID(),
    username: 'admin.atomic',
    passwordHash: '$scrypt$v=1$ln=17,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    totpCiphertext: 'v1.fixture-ciphertext-not-real-xxxxxxxx',
    acceptedStep: 59_816_666,
    profile: { businessName: 'شركة', contactName: 'أحمد', email: null, phone: '01012345678', governorate: 'القاهرة', address: '12 شارع النصر' },
    ...overrides,
  });

  test('a failing profile insert rolls back the user', () => {
    const e = env();
    const db = openDatabase(e.config.databasePath, { mustExist: true });
    try {
      assert.throws(() => createAdministrator(db, prepared({ profile: { ...prepared().profile, phone: 'bad phone!' } }), NOW, randomUUID()));
      assert.equal(db.isTransaction, false);
    } finally {
      db.close();
    }
    assertNothingSaved(e);
  });

  test('a failing audit insert (last statement) rolls back the user and the profile', () => {
    const e = env();
    const db = openDatabase(e.config.databasePath, { mustExist: true });
    try {
      assert.throws(() => createAdministrator(db, prepared(), NOW, 'not-a-request-id'), /CHECK constraint failed/);
    } finally {
      db.close();
    }
    assertNothingSaved(e);
  });

  test('preconditions are re-checked inside the transaction', () => {
    const e = env();
    const db = openDatabase(e.config.databasePath, { mustExist: true });
    try {
      createAdministrator(db, prepared(), NOW, randomUUID());
      assert.throws(() => createAdministrator(db, prepared({ username: 'admin.second' }), NOW, randomUUID()), (err: unknown) => err instanceof BootstrapError && err.code === 'ADMIN_EXISTS');
    } finally {
      db.close();
    }
    assert.equal(count(e, 'auth_users'), 1);
  });
});
