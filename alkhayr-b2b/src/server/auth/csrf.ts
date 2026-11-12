import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hmacBase64Url } from './keys.ts';

/**
 * CSRF tokens (docs/SECURITY.md §6). Nothing is stored server-side.
 *
 * Session token:   "s1." + HMAC(csrfKey, "session\0" + raw session token)
 *   Bound to one session; different sessions never share a token; useless
 *   without that session's cookie.
 * Pre-login token: "p1.<expiresAtMs>." + HMAC(csrfKey, "prelogin\0" + nonce + "\0" + expiresAt)
 *   Bound to the random pre-session cookie, expires after 10 minutes, accepted
 *   ONLY by login and registration and never as a session token. It grants no
 *   authentication.
 */

export const PRELOGIN_TTL_MS = 10 * 60 * 1000;
export const PRESESSION_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_TOKEN = /^s1\.[A-Za-z0-9_-]{43}$/;
const PRELOGIN_TOKEN = /^p1\.(\d{13})\.([A-Za-z0-9_-]{43})$/;

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sessionCsrfToken(csrfKey: Buffer, rawSessionToken: string): string {
  return `s1.${hmacBase64Url(csrfKey, `session\0${rawSessionToken}`)}`;
}

export function verifySessionCsrf(csrfKey: Buffer, rawSessionToken: string, presented: unknown): boolean {
  if (typeof presented !== 'string' || !SESSION_TOKEN.test(presented)) return false;
  return equal(presented, sessionCsrfToken(csrfKey, rawSessionToken));
}

export function newPreSessionNonce(): string {
  return randomBytes(32).toString('base64url');
}

export function preLoginToken(csrfKey: Buffer, nonce: string, expiresAt: number): string {
  return `p1.${expiresAt}.${hmacBase64Url(csrfKey, `prelogin\0${nonce}\0${expiresAt}`)}`;
}

export function verifyPreLoginToken(csrfKey: Buffer, nonce: string | undefined, presented: unknown, now: number): boolean {
  if (!nonce || !PRESESSION_NONCE_PATTERN.test(nonce)) return false;
  if (typeof presented !== 'string') return false;
  const m = PRELOGIN_TOKEN.exec(presented);
  if (!m) return false;
  const expiresAt = Number(m[1]);
  if (!(expiresAt > now && expiresAt <= now + PRELOGIN_TTL_MS)) return false;
  return equal(presented, preLoginToken(csrfKey, nonce, expiresAt));
}
