/**
 * Cookie handling. Production uses __Host- names (Secure, Path=/, no Domain).
 * Development/test over http://localhost cannot set Secure cookies, so plain
 * names without Secure are used there (D-007); production config requires https.
 */

export interface CookieNames {
  readonly session: string;
  readonly preSession: string;
  /** Long-lived proof that this browser signed in successfully before (never a session; see auth/device.ts). */
  readonly device: string;
}

export function cookieNames(isProduction: boolean): CookieNames {
  return isProduction
    ? { session: '__Host-alkhayr_session', preSession: '__Host-alkhayr_presession', device: '__Host-alkhayr_device' }
    : { session: 'alkhayr_session', preSession: 'alkhayr_presession', device: 'alkhayr_device' };
}

const MAX_COOKIE_HEADER = 8192;
const MAX_PAIRS = 64;
const NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Parses a Cookie header. Bounded in size and count. A name that appears more
 * than once is treated as absent (defends against cookie tossing/shadowing).
 */
export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header || header.length > MAX_COOKIE_HEADER) return out;
  const duplicated = new Set<string>();
  const pairs = header.split(';');
  for (const pair of pairs.slice(0, MAX_PAIRS)) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!NAME.test(name)) continue;
    if (out.has(name)) duplicated.add(name);
    else out.set(name, value);
  }
  for (const name of duplicated) out.delete(name);
  return out;
}

export interface CookieOptions {
  secure: boolean;
  /** Seconds; 0 expires the cookie immediately. */
  maxAge: number;
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.max(0, Math.floor(options.maxAge))}`];
  if (options.maxAge === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}
