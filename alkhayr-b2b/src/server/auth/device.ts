import { timingSafeEqual } from 'node:crypto';
import { hmacBase64Url } from './keys.ts';

/**
 * Device cookie (fix B; OWASP "device cookies" pattern against distributed account lockout).
 *
 * After a SUCCESSFUL sign-in the browser receives `v1.<expiryMs>.<mac>` where
 * mac = HMAC(device key, "device.v1" NUL username NUL expiryMs). It proves only that this browser completed a full
 * sign-in (password, and TOTP for administrators) as that username before. It is NOT a session and grants no access.
 *
 * Effect: a sign-in attempt presenting a valid device cookie for the SAME username is not counted against, and not
 * blocked by, the account-wide limit (`login_account`, 30 / 15 min across all sources). That limit is the one
 * attackers with many addresses can exhaust to lock a known username. The attempt still passes the per-source and
 * per-(source, username) limits, the bounded hashing queue and its own per-cookie limit (`login_device`).
 *
 * No account discovery: a cookie is only ever issued after valid credentials; without one, behaviour is unchanged.
 * The value contains no username or user id. It survives logout and password changes (it is not a credential);
 * a stolen cookie yields at most `login_device` extra guesses per window, still under the per-source limits.
 */
export const DEVICE_COOKIE_TTL_MS = 90 * 24 * 60 * 60_000;
const PATTERN = /^v1\.(\d{13,14})\.([A-Za-z0-9_-]{43})$/;

function mac(key: Buffer, username: string, expiryMs: number): string {
  return hmacBase64Url(key, `device.v1\u0000${username}\u0000${expiryMs}`);
}

export function issueDeviceCookie(key: Buffer, username: string, now: number): string {
  const expiry = now + DEVICE_COOKIE_TTL_MS;
  return `v1.${expiry}.${mac(key, username, expiry)}`;
}

/** Returns a stable identifier of the cookie (its MAC) when it is valid for `username` and unexpired; else null. */
export function verifyDeviceCookie(key: Buffer, value: string | undefined, username: string, now: number): string | null {
  const m = typeof value === 'string' ? PATTERN.exec(value) : null;
  if (!m) return null;
  const expiry = Number(m[1]);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + DEVICE_COOKIE_TTL_MS) return null;
  const expected = Buffer.from(mac(key, username, expiry));
  const presented = Buffer.from(m[2]!);
  return presented.length === expected.length && timingSafeEqual(presented, expected) ? m[2]! : null;
}
