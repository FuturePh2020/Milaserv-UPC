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

describe('dummy hash initialization survives a full queue (prompt A regression)', () => {
  // A deterministic way to occupy the limiter: hash()/verify() take their slot synchronously, before their
  // first await, so a call made right afterwards sees the limiter exactly as these calls left it.
  const fill = (hasher: PasswordHasher, n: number) => Array.from({ length: n }, (_, i) => hasher.hash(`filler-password-${i}`));

  test('A: cold initialization refused under the DEFAULT 2 active / 32 waiting limits recovers once capacity returns', async () => {
    const hasher = new PasswordHasher({ params: CHEAP }); // default maxConcurrent 2, maxQueue 32
    const fillers = fill(hasher, 34);
    assert.deepEqual({ active: hasher.stats().active, queued: hasher.stats().queued }, { active: 2, queued: 32 });
    await assert.rejects(hasher.verifyDummy('unknown-user-password'), PasswordHasherBusyError);
    await Promise.all(fillers); // drain
    assert.equal(hasher.stats().active, 0);
    assert.equal(await hasher.verifyDummy('unknown-user-password'), false, 'unknown-user checking recovers');
    for (let i = 0; i < 3; i++) assert.equal(await hasher.verifyDummy(`again-${i}`), false, 'repeated calls are not stuck');
  });

  test('C: overlapping callers share ONE initialization; a refused one is shared too, then retried once', async () => {
    class Counting extends PasswordHasher {
      hashCalls = 0;
      override hash(password: string) {
        this.hashCalls++;
        return super.hash(password);
      }
    }
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      // Overloaded: one slot, no queue, slot taken.
      const busy = new Counting({ params: CHEAP, maxConcurrent: 1, maxQueue: 0 });
      const blocker = busy.hash('blocker-password');
      const refused = await Promise.allSettled([busy.verifyDummy('a'), busy.verifyDummy('b'), busy.verifyDummy('c')]);
      assert.ok(refused.every((r) => r.status === 'rejected' && r.reason instanceof PasswordHasherBusyError));
      assert.equal(busy.hashCalls, 2, 'blocker + ONE shared initialization attempt (no retry storm while overloaded)');
      await blocker;
      assert.equal(await busy.verifyDummy('after'), false, 'the next call after capacity returns initializes again');
      assert.equal(busy.hashCalls, 3, 'exactly one new attempt');
      assert.equal(await busy.verifyDummy('again'), false);
      assert.equal(busy.hashCalls, 3, 'the successful initialization is reused');

      // Room for one active job plus a queue: three overlapping cold callers.
      const roomy = new Counting({ params: CHEAP, maxConcurrent: 1, maxQueue: 8 });
      assert.deepEqual(await Promise.all([roomy.verifyDummy('a'), roomy.verifyDummy('b'), roomy.verifyDummy('c')]), [false, false, false]);
      assert.equal(roomy.hashCalls, 1, 'one shared successful initialization');
      assert.equal(roomy.stats().maxActiveObserved, 1, 'work stays bounded by the limiter');
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(unhandled, [], 'no unhandled promise rejections');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('C: a failed EARLIER initialization never clears a NEWER cached value', async () => {
    // hash() is replaced by controllable promises to order the calls exactly. Note: with direct awaits, every caller
    // already waiting on attempt 1 observes its failure in the same microtask burst, before a new attempt can be
    // created, so a naive "any failing caller clears the cache" variant also passes this test. The identity check in
    // #dummy() (clear only if the cached value IS the failed attempt) is therefore defensive; this test pins the
    // observable contract: the newer attempt stays cached and is reused.
    const pending: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];
    class Controlled extends PasswordHasher {
      override hash(_password: string) {
        return new Promise<string>((resolve, reject) => pending.push({ resolve, reject }));
      }
    }
    const hasher = new Controlled({ params: CHEAP });
    const real = await new PasswordHasher({ params: CHEAP }).hash('dummy-source');
    const a = hasher.verifyDummy('a');
    const b = hasher.verifyDummy('b');
    assert.equal(pending.length, 1, 'A and B share attempt 1');
    pending[0]!.reject(new PasswordHasherBusyError());
    await assert.rejects(a, PasswordHasherBusyError);
    const c = hasher.verifyDummy('c'); // attempt 2 starts while B has not yet observed attempt 1's failure
    assert.equal(pending.length, 2);
    await assert.rejects(b, PasswordHasherBusyError); // B's continuation runs now
    pending[1]!.resolve(real);
    assert.equal(await c, false);
    assert.equal(await hasher.verifyDummy('d'), false);
    assert.equal(pending.length, 2, 'attempt 2 is still cached: no third initialization');
  });
});
