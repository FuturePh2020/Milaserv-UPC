import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) over HOTP (RFC 4226): HMAC-SHA1, 6 digits, 30-second steps.
 * Verification window: ±1 step (the code for the previous, current or next
 * period is accepted), i.e. up to ~30 s of clock skew in either direction.
 *
 * verifyTotp returns the ACCEPTED STEP, not just "valid": stage 04 stores it
 * atomically (UPDATE ... WHERE last_otp_step IS NULL OR last_otp_step < ?) to
 * reject replays across concurrent logins. No in-memory replay state exists here.
 */

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_WINDOW = 1;
export const TOTP_SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, upper case, no padding. */
export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Strict decode: case-insensitive, optional '=' padding; any other character is rejected. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '');
  if (!/^[A-Z2-7]*$/.test(clean)) throw new RangeError('invalid base32');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** HOTP value as a zero-padded decimal string (leading zeros preserved). */
export function hotp(secret: Buffer, counter: number | bigint, digits = TOTP_DIGITS): string {
  const c = BigInt(counter);
  if (c < 0n || c > 0xffff_ffff_ffff_ffffn) throw new RangeError('counter out of range');
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(c);
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = (mac[mac.length - 1] as number) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpStep(timeMs: number, period = TOTP_PERIOD_SECONDS): number {
  if (!Number.isFinite(timeMs) || timeMs < 0) throw new RangeError('invalid time');
  return Math.floor(timeMs / 1000 / period);
}

export function totpCode(secret: Buffer, timeMs: number, digits = TOTP_DIGITS): string {
  return hotp(secret, totpStep(timeMs), digits);
}

export type TotpVerification = { ok: true; step: number } | { ok: false };

export interface VerifyTotpOptions {
  window?: number;
  /** Steps <= this value are never accepted (last accepted step, for replay rejection). */
  lastAcceptedStep?: number | null;
}

/**
 * Checks a 6-digit code against steps (current-window … current+window).
 * Returns the accepted step. Codes must be exactly 6 ASCII digits.
 */
export function verifyTotp(secret: Buffer, code: unknown, nowMs: number, options: VerifyTotpOptions = {}): TotpVerification {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return { ok: false };
  const window = options.window ?? TOTP_WINDOW;
  const current = totpStep(nowMs);
  const candidate = Buffer.from(code, 'ascii');
  let accepted: number | null = null;
  // Check every step in the window (no early exit) so timing does not reveal which step matched.
  for (let step = current - window; step <= current + window; step++) {
    if (step < 0) continue;
    const expected = Buffer.from(hotp(secret, step), 'ascii');
    const match = timingSafeEqual(expected, candidate);
    const fresh = options.lastAcceptedStep === undefined || options.lastAcceptedStep === null || step > options.lastAcceptedStep;
    if (match && fresh) accepted = step; // latest matching fresh step wins
  }
  return accepted === null ? { ok: false } : { ok: true, step: accepted };
}

/** otpauth:// enrollment URI (shown only to the trusted operator; never sent to a third party). */
export function otpauthUri(secret: Buffer, accountName: string, issuer = 'ALKHAYR'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
