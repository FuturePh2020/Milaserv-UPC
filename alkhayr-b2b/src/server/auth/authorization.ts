import type { ServerResponse } from 'node:http';
import { AppError } from '../http/errors.ts';
import type { RequestContext } from '../http/router.ts';
import { cookieNames, parseCookies, serializeCookie } from './cookies.ts';
import { verifySessionCsrf } from './csrf.ts';
import { deleteSession, lookupSession, SESSION_POLICY, touchSession, type Identity } from './sessions.ts';
import { writeTransaction } from '../database/transaction.ts';

/**
 * Reusable server-side guards. Identity comes ONLY from the session cookie and
 * the current database rows; request headers or bodies claiming a role, user,
 * merchant or ChatGPT identity are never consulted.
 */

export interface AuthenticatedRequest {
  identity: Identity;
  /** Raw session token from the cookie (needed for the session-bound CSRF token). */
  token: string;
}

export function sessionCookieValue(ctx: RequestContext): string | undefined {
  return parseCookies(ctx.req.headers.cookie).get(cookieNames(ctx.config.isProduction).session);
}

export function clearSessionCookie(ctx: RequestContext, res: ServerResponse = ctx.res): void {
  appendSetCookie(res, serializeCookie(cookieNames(ctx.config.isProduction).session, '', { secure: ctx.config.isProduction, maxAge: 0 }));
}

export function appendSetCookie(res: ServerResponse, cookie: string): void {
  const existing = res.getHeader('Set-Cookie');
  const list = existing === undefined ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

/** Resolves the current identity, or null. Invalid/expired sessions are deleted (never revived). */
export function authenticate(ctx: RequestContext): AuthenticatedRequest | null {
  const { db, now } = ctx.services;
  const token = sessionCookieValue(ctx);
  const t = now();
  const found = lookupSession(db, token, t);
  if (found.kind === 'invalid') {
    try {
      writeTransaction(db, () => deleteSession(db, found.tokenHash));
    } catch (err) {
      ctx.log.warn('session_cleanup_failed', { requestId: ctx.requestId, error: err instanceof Error ? err : String(err) });
    }
    clearSessionCookie(ctx);
    return null;
  }
  if (found.kind === 'none') {
    if (token !== undefined) clearSessionCookie(ctx);
    return null;
  }
  try {
    writeTransaction(db, () => touchSession(db, found.identity, t));
  } catch (err) {
    // A failed touch never extends or revives a session; the request proceeds on the still-valid session.
    ctx.log.warn('session_touch_failed', { requestId: ctx.requestId, error: err instanceof Error ? err : String(err) });
  }
  return { identity: found.identity, token: token as string };
}

export function requireSession(ctx: RequestContext): AuthenticatedRequest {
  const auth = authenticate(ctx);
  if (!auth) throw new AppError('UNAUTHENTICATED');
  return auth;
}

/** Session-bound CSRF check for authenticated mutations. Pre-login tokens never pass. */
export function requireSessionCsrf(ctx: RequestContext, auth: AuthenticatedRequest): void {
  const presented = ctx.req.headers['x-csrf-token'];
  if (!verifySessionCsrf(ctx.services.keys.csrf, auth.token, Array.isArray(presented) ? undefined : presented)) {
    throw new AppError('CSRF_FAILED');
  }
}

/** Approved traders and administrators (catalog/order access in later stages). */
export function requireApproved(auth: AuthenticatedRequest): void {
  if (auth.identity.merchantStatus !== 'approved') throw new AppError('ACCOUNT_PENDING');
}

export function requireAdmin(auth: AuthenticatedRequest): void {
  if (auth.identity.role !== 'admin') throw new AppError('FORBIDDEN');
}

/** Privileged administrator operations: credentials (password + TOTP) verified within 15 minutes. */
export function requireRecentAdminAuth(ctx: RequestContext, auth: AuthenticatedRequest): void {
  requireAdmin(auth);
  if (ctx.services.now() - auth.identity.authAt >= SESSION_POLICY.recentAuthMs) throw new AppError('RECENT_AUTH_REQUIRED');
}

/**
 * Ownership: a trader may act only on records of their own merchant. Mismatch
 * is reported as NOT_FOUND (no existence disclosure). Administrators pass only
 * when `allowAdmin` is set by the caller.
 */
export function requireOwnMerchant(auth: AuthenticatedRequest, merchantId: string, options: { allowAdmin?: boolean } = {}): void {
  if (options.allowAdmin && auth.identity.role === 'admin') return;
  if (auth.identity.merchantId !== merchantId) throw new AppError('NOT_FOUND');
}

/**
 * Commit-time re-validation: call INSIDE the write transaction. The identity
 * resolved at the start of the request may be stale (the body is read
 * asynchronously); this re-reads the session and account so a suspension,
 * logout, password change or expiry in the meantime prevents the write.
 * Returns the current identity.
 */
export function revalidateAtCommit(ctx: RequestContext, auth: AuthenticatedRequest, options: { admin?: 'any' | 'recent' } = {}): Identity {
  const found = lookupSession(ctx.services.db, auth.token, ctx.services.now());
  if (found.kind !== 'valid' || found.identity.userId !== auth.identity.userId) throw new AppError('UNAUTHENTICATED');
  const current = found.identity;
  if (options.admin) {
    if (current.role !== 'admin') throw new AppError('FORBIDDEN');
    if (options.admin === 'recent' && ctx.services.now() - current.authAt >= SESSION_POLICY.recentAuthMs) throw new AppError('RECENT_AUTH_REQUIRED');
  }
  return current;
}
