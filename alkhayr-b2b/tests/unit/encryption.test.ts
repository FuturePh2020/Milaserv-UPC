import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { decryptSecret, deriveKey, encryptSecret, EnvelopeError, KEY_PURPOSES, MissingSecretError, totpAad } from '../../src/server/auth/encryption.ts';
import { assertAdministratorMfaReadable, SecurityConfigError } from '../../src/server/auth/mfa-key-check.ts';
import { generateTotpSecret } from '../../src/server/auth/totp.ts';
import { createTestDatabase, insertUser } from '../helpers/database.ts';

// Disposable fixture key material.
const APP_SECRET = randomBytes(32);
const OTHER_SECRET = randomBytes(32);

function envelopeCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof EnvelopeError, String(err));
    return err.code;
  }
  assert.fail('expected EnvelopeError');
}

describe('key derivation', () => {
  test('purpose-separated, deterministic, 32-byte keys; different secrets give different keys', () => {
    const keys = KEY_PURPOSES.map((p) => deriveKey(APP_SECRET, p).toString('hex'));
    assert.equal(new Set(keys).size, KEY_PURPOSES.length);
    for (const k of keys) assert.equal(k.length, 64);
    assert.equal(deriveKey(APP_SECRET, 'totp').toString('hex'), keys[0]);
    assert.notEqual(deriveKey(OTHER_SECRET, 'totp').toString('hex'), keys[0]);
    assert.ok(!keys.includes(APP_SECRET.toString('hex')), 'derived key is not the raw secret');
  });

  test('missing or short APP_SECRET fails closed; no fallback key', () => {
    assert.throws(() => deriveKey(null, 'totp'), MissingSecretError);
    assert.throws(() => deriveKey(randomBytes(16), 'totp'), MissingSecretError);
    assert.throws(() => deriveKey(APP_SECRET, 'backup' as never), RangeError);
  });
});

describe('AES-256-GCM envelope', () => {
  const key = deriveKey(APP_SECRET, 'totp');
  const userId = randomUUID();
  const secret = generateTotpSecret();

  test('round trip; unique nonce per encryption; versioned format', () => {
    const a = encryptSecret(key, secret, totpAad(userId));
    const b = encryptSecret(key, secret, totpAad(userId));
    assert.match(a, /^v1\.[A-Za-z0-9_-]+$/);
    assert.notEqual(a, b);
    assert.notEqual(Buffer.from(a.slice(3), 'base64url').subarray(0, 12).toString('hex'), Buffer.from(b.slice(3), 'base64url').subarray(0, 12).toString('hex'));
    assert.deepEqual(decryptSecret(key, a, totpAad(userId)), secret);
    assert.deepEqual(decryptSecret(key, b, totpAad(userId)), secret);
    assert.ok(!a.includes(secret.toString('base64url')) && !a.includes(secret.toString('hex')));
  });

  test('wrong key, wrong AAD (other user) and any tampering fail authentication', () => {
    const env = encryptSecret(key, secret, totpAad(userId));
    assert.equal(envelopeCode(() => decryptSecret(deriveKey(OTHER_SECRET, 'totp'), env, totpAad(userId))), 'AUTH_FAILED');
    assert.equal(envelopeCode(() => decryptSecret(deriveKey(APP_SECRET, 'csrf'), env, totpAad(userId))), 'AUTH_FAILED');
    assert.equal(envelopeCode(() => decryptSecret(key, env, totpAad(randomUUID()))), 'AUTH_FAILED');
    const raw = Buffer.from(env.slice(3), 'base64url');
    for (const index of [0, 12, raw.length - 17, raw.length - 1]) {
      const copy = Buffer.from(raw);
      copy[index] = (copy[index] as number) ^ 0x01;
      assert.equal(envelopeCode(() => decryptSecret(key, `v1.${copy.toString('base64url')}`, totpAad(userId))), 'AUTH_FAILED', `byte ${index}`);
    }
  });

  test('truncated, malformed and unsupported-version envelopes are rejected explicitly', () => {
    const env = encryptSecret(key, secret, totpAad(userId));
    const raw = Buffer.from(env.slice(3), 'base64url');
    assert.equal(envelopeCode(() => decryptSecret(key, `v1.${raw.subarray(0, 28).toString('base64url')}`, totpAad(userId))), 'TRUNCATED');
    assert.equal(envelopeCode(() => decryptSecret(key, 'v1.', totpAad(userId))), 'TRUNCATED');
    assert.equal(envelopeCode(() => decryptSecret(key, `v1.${raw.subarray(0, raw.length - 1).toString('base64url')}`, totpAad(userId))), 'AUTH_FAILED');
    assert.equal(envelopeCode(() => decryptSecret(key, env.replace(/^v1\./, 'v2.'), totpAad(userId))), 'UNSUPPORTED_VERSION');
    for (const bad of ['', 'v1', '1.abc', `V1.${env.slice(3)}`, `v1.${env.slice(3)}=`, `v1.${env.slice(3)}!`, env + '\n', null, 7, 'v1.' + 'A'.repeat(5000)]) {
      assert.equal(envelopeCode(() => decryptSecret(key, bad, totpAad(userId))), 'MALFORMED', String(bad).slice(0, 20));
    }
  });
});

describe('startup MFA key check', () => {
  function withAdmin(appSecret: Buffer) {
    const t = createTestDatabase();
    const id = randomUUID();
    insertUser(t.db, { id, role: 'admin', totp: encryptSecret(deriveKey(appSecret, 'totp'), generateTotpSecret(), totpAad(id)) });
    return t;
  }

  test('no administrators: passes even without APP_SECRET', () => {
    const t = createTestDatabase();
    try {
      assert.deepEqual(assertAdministratorMfaReadable(t.db, null), { administrators: 0 });
    } finally {
      t.cleanup();
    }
  });

  test('matching key passes; wrong key or missing key refuses with an actionable code and changes nothing', () => {
    const t = withAdmin(APP_SECRET);
    try {
      const before = JSON.stringify(t.db.prepare('SELECT * FROM auth_users').all());
      assert.deepEqual(assertAdministratorMfaReadable(t.db, APP_SECRET), { administrators: 1 });
      assert.throws(() => assertAdministratorMfaReadable(t.db, OTHER_SECRET), (e: unknown) => e instanceof SecurityConfigError && e.code === 'MFA_KEY_MISMATCH' && /Restore the original APP_SECRET/.test(e.message));
      assert.throws(() => assertAdministratorMfaReadable(t.db, null), (e: unknown) => e instanceof SecurityConfigError && e.code === 'APP_SECRET_REQUIRED');
      assert.equal(JSON.stringify(t.db.prepare('SELECT * FROM auth_users').all()), before, 'nothing replaced or reset');
    } finally {
      t.cleanup();
    }
  });

  test('a ciphertext moved to another administrator row fails (AAD binds it to the user id)', () => {
    const t = withAdmin(APP_SECRET);
    try {
      const other = randomUUID();
      const stolen = (t.db.prepare("SELECT totp_ciphertext AS c FROM auth_users WHERE role = 'admin'").get() as { c: string }).c;
      insertUser(t.db, { id: other, role: 'admin', totp: stolen });
      assert.throws(() => assertAdministratorMfaReadable(t.db, APP_SECRET), (e: unknown) => e instanceof SecurityConfigError && /1 of 2/.test(e.message));
    } finally {
      t.cleanup();
    }
  });
});
