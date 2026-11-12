import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUri, totpCode, totpStep, verifyTotp } from '../../src/server/auth/totp.ts';

// RFC 4226 / RFC 6238 SHA-1 reference secret: ASCII "12345678901234567890".
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('HOTP (RFC 4226 Appendix D)', () => {
  test('reference values for counters 0..9', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, counter) => assert.equal(hotp(RFC_SECRET, counter), code, `counter ${counter}`));
  });
});

describe('TOTP (RFC 6238 Appendix B, SHA-1)', () => {
  // The RFC lists 8-digit values; the 6-digit code is the last six digits of the same truncated value.
  const vectors: Array<[number, string, string]> = [
    [59, '94287082', '287082'],
    [1111111109, '07081804', '081804'],
    [1111111111, '14050471', '050471'],
    [1234567890, '89005924', '005924'],
    [2000000000, '69279037', '279037'],
    [20000000000, '65353130', '353130'],
  ];
  for (const [seconds, eight, six] of vectors) {
    test(`T=${seconds}s -> ${eight} (6 digits ${six}, leading zeros preserved)`, () => {
      assert.equal(totpCode(RFC_SECRET, seconds * 1000, 8), eight);
      assert.equal(totpCode(RFC_SECRET, seconds * 1000), six);
      assert.equal(six.length, 6);
    });
  }
});

describe('verification window and accepted step', () => {
  const T = 1111111111 * 1000; // step 37037037, code 050471
  const step = totpStep(T);

  test('returns the accepted step; accepts previous/current/next periods only (±1)', () => {
    assert.deepEqual(verifyTotp(RFC_SECRET, '050471', T), { ok: true, step });
    const prev = hotp(RFC_SECRET, step - 1);
    const next = hotp(RFC_SECRET, step + 1);
    assert.deepEqual(verifyTotp(RFC_SECRET, prev, T), { ok: true, step: step - 1 });
    assert.deepEqual(verifyTotp(RFC_SECRET, next, T), { ok: true, step: step + 1 });
    assert.deepEqual(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), T), { ok: false });
    assert.deepEqual(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 2), T), { ok: false });
  });

  test('clock boundaries: last millisecond of a period vs first of the next', () => {
    const periodStart = step * 30_000;
    const lastMs = periodStart + 29_999;
    const nextStart = periodStart + 30_000;
    assert.equal(totpStep(lastMs), step);
    assert.equal(totpStep(nextStart), step + 1);
    const code = hotp(RFC_SECRET, step);
    assert.deepEqual(verifyTotp(RFC_SECRET, code, lastMs), { ok: true, step });
    assert.deepEqual(verifyTotp(RFC_SECRET, code, nextStart), { ok: true, step }); // now "previous" step
    assert.deepEqual(verifyTotp(RFC_SECRET, code, nextStart + 30_000 - 1), { ok: true, step });
    assert.deepEqual(verifyTotp(RFC_SECRET, code, nextStart + 30_000), { ok: false }); // two periods later
    assert.deepEqual(verifyTotp(RFC_SECRET, code, periodStart - 30_000), { ok: true, step }); // "next" step from one period earlier
    assert.deepEqual(verifyTotp(RFC_SECRET, code, periodStart - 30_001), { ok: false });
  });

  test('replay boundary: steps at or before lastAcceptedStep are refused; later steps accepted', () => {
    const code = hotp(RFC_SECRET, step);
    assert.deepEqual(verifyTotp(RFC_SECRET, code, T, { lastAcceptedStep: step }), { ok: false });
    assert.deepEqual(verifyTotp(RFC_SECRET, code, T, { lastAcceptedStep: step + 1 }), { ok: false });
    assert.deepEqual(verifyTotp(RFC_SECRET, code, T, { lastAcceptedStep: step - 1 }), { ok: true, step });
    assert.deepEqual(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), T, { lastAcceptedStep: step }), { ok: true, step: step + 1 });
    assert.deepEqual(verifyTotp(RFC_SECRET, code, T, { lastAcceptedStep: null }), { ok: true, step });
  });

  test('only exactly six ASCII digits are considered', () => {
    for (const bad of ['50471', ' 050471', '050471 ', '٠٥٠٤٧١', '0504710', '05O471', '', null, 50471]) {
      assert.deepEqual(verifyTotp(RFC_SECRET, bad, T), { ok: false }, String(bad));
    }
  });

  test('a different secret does not verify', () => {
    assert.deepEqual(verifyTotp(generateTotpSecret(), '050471', T), { ok: false });
  });
});

describe('secrets, base32 and enrollment URI', () => {
  test('random 20-byte secrets; base32 round trip (RFC 4648 vectors)', () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    assert.equal(a.length, 20);
    assert.notDeepEqual(a, b);
    assert.deepEqual(base32Decode(base32Encode(a)), a);
    assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
    assert.equal(base32Encode(Buffer.from('f')), 'MY');
    assert.equal(base32Encode(RFC_SECRET), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    assert.deepEqual(base32Decode('mzxw6ytboi'), Buffer.from('foobar'));
    assert.deepEqual(base32Decode('MZXW6YTBOI======'), Buffer.from('foobar'));
    assert.throws(() => base32Decode('MZXW6YTB0I'), RangeError); // '0' is not base32
  });

  test('otpauth URI has the standard parameters and an encoded label', () => {
    const uri = new URL(otpauthUri(RFC_SECRET, 'admin.one'));
    assert.equal(uri.protocol, 'otpauth:');
    assert.equal(uri.host, 'totp');
    assert.equal(decodeURIComponent(uri.pathname), '/ALKHAYR:admin.one');
    assert.equal(uri.searchParams.get('secret'), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    assert.equal(uri.searchParams.get('issuer'), 'ALKHAYR');
    assert.equal(uri.searchParams.get('algorithm'), 'SHA1');
    assert.equal(uri.searchParams.get('digits'), '6');
    assert.equal(uri.searchParams.get('period'), '30');
  });
});
