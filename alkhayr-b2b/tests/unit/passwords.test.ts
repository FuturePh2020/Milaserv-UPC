import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  checkPasswordPolicy,
  countCharacters,
  encodePasswordHash,
  parsePasswordHash,
  PasswordHasher,
  PasswordHasherBusyError,
  REFERENCE_PARAMS,
  scryptMaxmem,
  UnsupportedPasswordHashError,
} from '../../src/server/auth/passwords.ts';

// Disposable fixture passwords (never used outside tests).
const PW = 'correct horse battery staple';
const CHEAP = { ln: 10, r: 8, p: 1 } as const;

describe('password policy (no trimming, lowercasing or truncation)', () => {
  test('minimum length: traders 12, administrators 15 characters', () => {
    assert.deepEqual(checkPasswordPolicy('a'.repeat(11), 'trader'), ['too_short']);
    assert.deepEqual(checkPasswordPolicy('a'.repeat(12), 'trader'), []);
    assert.deepEqual(checkPasswordPolicy('a'.repeat(14), 'admin'), ['too_short']);
    assert.deepEqual(checkPasswordPolicy('a'.repeat(15), 'admin'), []);
  });

  test('surrounding spaces count and are not trimmed', () => {
    assert.deepEqual(checkPasswordPolicy('  ' + 'a'.repeat(10), 'trader'), []);
    assert.deepEqual(checkPasswordPolicy(' '.repeat(12), 'trader'), []); // spaces are characters
  });

  test('maximum 128 characters (grapheme clusters) and 512 UTF-8 bytes; over-limit is rejected, not cut', () => {
    assert.deepEqual(checkPasswordPolicy('a'.repeat(128), 'admin'), []);
    assert.deepEqual(checkPasswordPolicy('a'.repeat(129), 'admin'), ['too_long_chars']);
    const arabic = 'ش'.repeat(128); // 256 bytes
    assert.deepEqual(checkPasswordPolicy(arabic, 'admin'), []);
    // 20 graphemes, each "e" + 30 combining accents = 61 bytes -> 1220 bytes
    const heavy = ('e' + '́'.repeat(30)).repeat(20);
    assert.equal(countCharacters(heavy), 20);
    assert.deepEqual(checkPasswordPolicy(heavy, 'admin'), ['too_long_bytes']);
    assert.deepEqual(checkPasswordPolicy(42, 'admin'), ['not_string']);
  });

  test('emoji and Arabic are counted as user-perceived characters', () => {
    assert.equal(countCharacters('👨‍👩‍👧'), 1);
    assert.equal(countCharacters('كلمة سر'), 7);
  });
});

describe('hash format and verification (reference parameters)', () => {
  const hasher = new PasswordHasher();

  test('correct password verifies, incorrect does not; salts make hashes unique', async () => {
    const [h1, h2] = await Promise.all([hasher.hash(PW), hasher.hash(PW)]);
    assert.match(h1, /^\$scrypt\$v=1\$ln=17,r=8,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    assert.notEqual(h1, h2, 'independent random salts must produce different hashes');
    assert.notEqual(parsePasswordHash(h1).salt.toString('hex'), parsePasswordHash(h2).salt.toString('hex'));
    assert.ok(!h1.includes(PW));
    assert.equal(await hasher.verify(PW, h1), true);
    assert.equal(await hasher.verify(PW + ' ', h1), false, 'trailing space is significant');
    assert.equal(await hasher.verify(PW.toUpperCase(), h1), false, 'case is significant');
    assert.equal(await hasher.verify(PW.slice(0, -1), h1), false);
  });

  test('NFC normalization: the same visible password in NFD form verifies', async () => {
    const nfc = 'Café-مرحبا-كلمة-سر'.normalize('NFC');
    const h = await hasher.hash(nfc);
    assert.equal(await hasher.verify(nfc.normalize('NFD'), h), true);
  });

  test('over-limit candidates are rejected without truncation', async () => {
    const h = await new PasswordHasher({ params: CHEAP }).hash('a'.repeat(128));
    const cheap = new PasswordHasher({ params: CHEAP });
    assert.equal(await cheap.verify('a'.repeat(128), h), true);
    assert.equal(await cheap.verify('a'.repeat(129), h), false);
    await assert.rejects(cheap.hash('a'.repeat(129)), RangeError);
  });

  test('maxmem is explicit and just above the scrypt requirement', () => {
    assert.equal(scryptMaxmem(REFERENCE_PARAMS), 128 * 131072 * 8 + 1024 * 1024);
  });
});

describe('defensive parsing of stored hashes', () => {
  const salt = Buffer.alloc(16, 1);
  const key = Buffer.alloc(32, 2);
  const good = encodePasswordHash(REFERENCE_PARAMS, salt, key);

  test('malformed values are rejected', () => {
    for (const bad of [
      '',
      'plaintext-password',
      good.replace('$scrypt$', '$argon2id$'),
      good.replace('v=1', 'v=2'),
      good + '$extra',
      good.slice(0, -1),
      good.replace(/\$([A-Za-z0-9_-]{22})\$/, '$$$1=$$'),
      good.replace('ln=17', 'ln=017'),
      'x'.repeat(10_000),
      null,
      42,
    ]) {
      assert.throws(() => parsePasswordHash(bad as string), UnsupportedPasswordHashError, String(bad).slice(0, 40));
    }
  });

  test('inflated or unsupported cost parameters are rejected before any work is done', async () => {
    const hasher = new PasswordHasher();
    for (const params of [
      { ln: 30, r: 8, p: 1 },
      { ln: 17, r: 64, p: 1 },
      { ln: 17, r: 8, p: 16 },
      { ln: 10, r: 8, p: 1 }, // weaker than the reference: also refused
    ]) {
      const stored = encodePasswordHash(params, salt, key);
      const started = Date.now();
      await assert.rejects(hasher.verify(PW, stored), UnsupportedPasswordHashError);
      assert.ok(Date.now() - started < 50, 'no scrypt work for rejected parameters');
    }
    assert.equal(hasher.stats().maxActiveObserved, 0);
  });
});

describe('bounded hashing work', () => {
  test('never more than maxConcurrent jobs; overflow beyond the queue is rejected immediately', async () => {
    const hasher = new PasswordHasher({ params: CHEAP, maxConcurrent: 2, maxQueue: 3 });
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => hasher.hash(`password-number-${i}`)));
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled, 5);
    assert.equal(rejected.length, 3);
    for (const r of rejected) assert.ok((r as PromiseRejectedResult).reason instanceof PasswordHasherBusyError);
    const stats = hasher.stats();
    assert.equal(stats.maxActiveObserved, 2);
    assert.equal(stats.active, 0);
    assert.equal(stats.queued, 0);
    assert.equal(stats.rejected, 3);
  });

  test('capacity frees up after jobs finish (sustained load is processed in waves)', async () => {
    const hasher = new PasswordHasher({ params: CHEAP, maxConcurrent: 1, maxQueue: 1 });
    for (let wave = 0; wave < 3; wave++) {
      const settled = await Promise.allSettled([hasher.hash('wave-password-a'), hasher.hash('wave-password-b'), hasher.hash('wave-password-c')]);
      assert.deepEqual(settled.map((s) => s.status), ['fulfilled', 'fulfilled', 'rejected']);
    }
    assert.equal(hasher.stats().maxActiveObserved, 1);
  });

  test('verification shares the same limiter', async () => {
    const hasher = new PasswordHasher({ params: CHEAP, maxConcurrent: 1, maxQueue: 0 });
    const h = await hasher.hash(PW);
    const settled = await Promise.allSettled([hasher.verify(PW, h), hasher.verify(PW, h)]);
    assert.equal(settled[0]!.status, 'fulfilled');
    assert.equal(settled[1]!.status, 'rejected');
  });

  test('invalid limiter configuration is refused', () => {
    assert.throws(() => new PasswordHasher({ maxConcurrent: 0 }), RangeError);
    assert.throws(() => new PasswordHasher({ maxQueue: -1 }), RangeError);
  });
});

describe('dummy verification for unknown users', () => {
  test('performs a full verification at the supported work factor and always returns false', async () => {
    const hasher = new PasswordHasher();
    const dummy = await hasher.dummyHashForTesting();
    assert.deepEqual(parsePasswordHash(dummy).params, REFERENCE_PARAMS);
    const before = hasher.stats().maxActiveObserved;
    const started = Date.now();
    assert.equal(await hasher.verifyDummy(PW), false);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 50, `dummy verification took ${elapsed} ms; expected real scrypt work`);
    assert.ok(hasher.stats().maxActiveObserved >= Math.max(before, 1), 'dummy work goes through the limiter');
    assert.equal(await hasher.verifyDummy(''), false);
  });
});
