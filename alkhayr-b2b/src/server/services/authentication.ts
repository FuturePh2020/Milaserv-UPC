import { randomUUID } from 'node:crypto';
import { assertNewWrite, writeStatus } from '../http/write-gate.ts';
import { z } from 'zod';
import { appendSetCookie, clearSessionCookie, requireSession, requireSessionCsrf, type AuthenticatedRequest } from '../auth/authorization.ts';
import { cookieNames, parseCookies, serializeCookie } from '../auth/cookies.ts';
import { newPreSessionNonce, PRELOGIN_TTL_MS, PRESESSION_NONCE_PATTERN, preLoginToken, sessionCsrfToken, verifyPreLoginToken } from '../auth/csrf.ts';
import { decryptSecret, totpAad } from '../auth/encryption.ts';
import { hmacHex } from '../auth/keys.ts';
import { checkPasswordPolicy, PASSWORD_POLICY, PasswordHasherBusyError, UnsupportedPasswordHashError, type PasswordPolicyIssue } from '../auth/passwords.ts';
import type { RateLimitBucket } from '../auth/rate-limit.ts';
import { deleteSession, deleteUserSessions, hashSessionToken, insertSession, lookupSession, SESSION_POLICY, SESSION_TOKEN_PATTERN, type Role } from '../auth/sessions.ts';
import { verifyTotp } from '../auth/totp.ts';
import { admissionFor } from '../auth/admission.ts';
import { writeTransaction } from '../database/transaction.ts';
import { rateLimitIdentity } from '../http/client-ip.ts';
import { AppError } from '../http/errors.ts';
import { readJsonBody } from '../http/request-body.ts';
import { sendJson } from '../http/response.ts';
import type { RequestContext } from '../http/router.ts';
import { merchantProfileSchema, normalizeUsername, USERNAME_PATTERN, usernameSchema } from '../../shared/schemas.ts';
import { writeAudit } from './audit.ts';

/**
 * Authentication endpoints (docs/API_CONTRACT.md, docs/SECURITY.md §2–7).
 * Rule of thumb: cheap checks (boundary, body size, schema, CSRF, rate limits)
 * → expensive async work (scrypt) OUTSIDE any transaction → one synchronous
 * write transaction that re-reads current state and commits or rejects.
 */

const AUTH_BODY_LIMIT = 8 * 1024;
const ARABIC = /[؀-ۿ]/;

// ---------------------------------------------------------------- helpers

function ipHmac(ctx: RequestContext): string {
  return hmacHex(ctx.services.keys.ip, ctx.clientIp);
}

function enforce(ctx: RequestContext, bucket: RateLimitBucket, identifier: string): void {
  const r = ctx.services.rateLimiter.consume(bucket, identifier);
  if (!r.allowed) {
    ctx.log.info('rate_limited', { requestId: ctx.requestId, bucket });
    throw new AppError('RATE_LIMITED', { headers: { 'Retry-After': String(r.retryAfterSeconds) } });
  }
}

function validationError(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): AppError {
  return new AppError('VALIDATION_FAILED', {
    fields: issues.slice(0, 20).map((i) => ({
      path: i.path.map(String).join('.') || '(body)',
      message: ARABIC.test(i.message) ? i.message : 'قيمة غير صالحة أو حقل غير مسموح به.',
    })),
  });
}

async function parseBody<T>(ctx: RequestContext, schema: z.ZodType<T>): Promise<T> {
  const raw = await readJsonBody(ctx.req, AUTH_BODY_LIMIT);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw validationError(parsed.error.issues);
  return parsed.data;
}

const POLICY_MESSAGES = (role: Role): Record<PasswordPolicyIssue, string> => ({
  not_string: 'كلمة المرور مطلوبة.',
  too_short: `كلمة المرور يجب ألا تقل عن ${PASSWORD_POLICY.minChars[role]} حرفًا.`,
  too_long_chars: `كلمة المرور يجب ألا تزيد على ${PASSWORD_POLICY.maxChars} حرفًا.`,
  too_long_bytes: `كلمة المرور أطول من الحد المسموح (${PASSWORD_POLICY.maxBytes} بايت).`,
});

function assertPasswordPolicy(password: string, role: Role, field: string): void {
  const issues = checkPasswordPolicy(password, role);
  if (issues.length > 0) {
    const messages = POLICY_MESSAGES(role);
    throw new AppError('VALIDATION_FAILED', { fields: issues.map((i) => ({ path: field, message: messages[i] })) });
  }
}

function requirePreLoginCsrf(ctx: RequestContext): void {
  const nonce = parseCookies(ctx.req.headers.cookie).get(cookieNames(ctx.config.isProduction).preSession);
  const presented = ctx.req.headers['x-csrf-token'];
  if (!verifyPreLoginToken(ctx.services.keys.csrf, nonce, Array.isArray(presented) ? undefined : presented, ctx.services.now())) {
    throw new AppError('CSRF_FAILED');
  }
}

function sessionCookie(ctx: RequestContext, token: string): string {
  return serializeCookie(cookieNames(ctx.config.isProduction).session, token, { secure: ctx.config.isProduction, maxAge: SESSION_POLICY.absoluteMs / 1000 });
}

function clearPreSessionCookie(ctx: RequestContext): void {
  appendSetCookie(ctx.res, serializeCookie(cookieNames(ctx.config.isProduction).preSession, '', { secure: ctx.config.isProduction, maxAge: 0 }));
}

// ---------------------------------------------------------------- GET /auth/csrf

export function getCsrf(ctx: RequestContext): void {
  const { db, now, keys } = ctx.services;
  const names = cookieNames(ctx.config.isProduction);
  const cookies = parseCookies(ctx.req.headers.cookie);
  const t = now();
  const token = cookies.get(names.session);
  const session = lookupSession(db, token, t);
  // A pre-login token is always available (also to a signed-in browser, so it can
  // log in again: switch account or re-authenticate after RECENT_AUTH_REQUIRED).
  let nonce = cookies.get(names.preSession);
  if (!nonce || !PRESESSION_NONCE_PATTERN.test(nonce)) {
    nonce = newPreSessionNonce();
    appendSetCookie(ctx.res, serializeCookie(names.preSession, nonce, { secure: ctx.config.isProduction, maxAge: PRELOGIN_TTL_MS / 1000 }));
  }
  const expiresAt = t + PRELOGIN_TTL_MS;
  sendJson(ctx.res, 200, {
    authenticated: session.kind === 'valid',
    /** For authenticated mutations (logout, password change, later business routes). */
    csrfToken: session.kind === 'valid' && token ? sessionCsrfToken(keys.csrf, token) : null,
    /** Only for POST /auth/login and /auth/register. */
    preLoginToken: preLoginToken(keys.csrf, nonce, expiresAt),
    preLoginExpiresAt: expiresAt,
  });
}

// ---------------------------------------------------------------- POST /auth/register

const registerSchema = z.strictObject({
  ...merchantProfileSchema.shape,
  username: usernameSchema,
  password: z.string().max(4096),
});

const REGISTRATION_RECEIVED = {
  status: 'received',
  message: 'تم استلام طلب التسجيل. إذا كانت البيانات صالحة فسيُراجع الحساب من الإدارة، ويمكنك تسجيل الدخول لمتابعة حالته. لم تُرسل أي رسائل تأكيد.',
} as const;

export async function register(ctx: RequestContext): Promise<void> {
  const body = await parseBody(ctx, registerSchema);
  requirePreLoginCsrf(ctx);
  enforce(ctx, 'register_ip', rateLimitIdentity(ctx.clientIp));
  assertNewWrite(ctx, { skipEpoch: true }); // no new accounts while writes are suspended
  assertPasswordPolicy(body.password, 'trader', 'password');

  // Always hash (also for duplicates) so timing does not reveal existing usernames.
  const releaseAdmission = admitCredentialWork(ctx, rateLimitIdentity(ctx.clientIp));
  let passwordHash: string;
  try {
    passwordHash = await ctx.services.hasher.hash(body.password);
  } finally {
    releaseAdmission();
  }
  const { db, now } = ctx.services;
  writeTransaction(db, () => {
    const t = now();
    const existing = db.prepare('SELECT id FROM auth_users WHERE username = ? COLLATE NOCASE').get(body.username) as { id: string } | undefined;
    if (existing) {
      writeAudit(db, { actorUserId: null, action: 'auth.register_duplicate', targetType: 'user', targetId: existing.id, ipHmac: ipHmac(ctx), requestId: ctx.requestId, now: t });
      return;
    }
    const userId = randomUUID();
    db.prepare(
      `INSERT INTO auth_users (id, username, password_hash, password_changed_at, role, totp_ciphertext, last_otp_step, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'trader', NULL, NULL, ?, ?)`,
    ).run(userId, body.username, passwordHash, t, t, t);
    db.prepare(
      `INSERT INTO merchants (id, user_id, business_name, contact_name, email, phone, governorate, address, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)`,
    ).run(randomUUID(), userId, body.businessName, body.contactName, body.email, body.phone, body.governorate, body.address, t, t);
    writeAudit(db, { actorUserId: userId, action: 'auth.register', targetType: 'user', targetId: userId, ipHmac: ipHmac(ctx), requestId: ctx.requestId, now: t });
  });
  // Identical response for new and duplicate usernames (no account-existence oracle).
  sendJson(ctx.res, 202, REGISTRATION_RECEIVED);
}

// ---------------------------------------------------------------- POST /auth/login

const loginSchema = z.strictObject({
  username: z.string().max(256),
  password: z.string().max(4096),
  /** Administrators only; traders omit it. Never revealed as "required" (no MFA oracle). */
  totp: z.string().max(16).optional(),
});

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  password_changed_at: number;
  role: Role;
  totp_ciphertext: string | null;
  last_otp_step: number | null;
  /** Monotonic credential marker (migration 0007): +1 on every operator recovery action. */
  credential_version: number;
  merchant_id: string | null;
  merchant_status: string | null;
  /** Monotonic authorization marker (migration 0002): +1 on every status change. */
  merchant_access_version: number | null;
}

const USER_BY_USERNAME = `SELECT u.id, u.username, u.password_hash, u.password_changed_at, u.role, u.totp_ciphertext, u.last_otp_step, u.credential_version,
                                 m.id AS merchant_id, m.status AS merchant_status, m.access_version AS merchant_access_version
                            FROM auth_users u LEFT JOIN merchants m ON m.user_id = u.id
                           WHERE u.username = ? COLLATE NOCASE`;
const USER_BY_ID = USER_BY_USERNAME.replace('WHERE u.username = ? COLLATE NOCASE', 'WHERE u.id = ?');

type FailureReason =
  | 'invalid_username'
  | 'unknown_user'
  | 'bad_password'
  | 'unsupported_hash'
  | 'mfa_failed'
  | 'mfa_unreadable'
  | 'suspended'
  | 'no_profile'
  | 'stale_credentials'
  | 'access_changed'
  | 'otp_replay';

function loginFailed(ctx: RequestContext, reason: FailureReason, userId: string | null): never {
  const { db, now } = ctx.services;
  writeTransaction(db, () =>
    writeAudit(db, { actorUserId: null, action: 'auth.login_failed', targetType: userId ? 'user' : null, targetId: userId, metadata: { reason }, ipHmac: ipHmac(ctx), requestId: ctx.requestId, now: now() }),
  );
  throw new AppError('INVALID_CREDENTIALS');
}

/** TOTP check for an administrator; returns the accepted step or null. */
function verifyAdminTotp(ctx: RequestContext, user: UserRow, code: string | undefined): number | null | 'unreadable' {
  if (!user.totp_ciphertext) return 'unreadable';
  let secret: Buffer;
  try {
    secret = decryptSecret(ctx.services.keys.totp, user.totp_ciphertext, totpAad(user.id));
  } catch {
    ctx.log.error('mfa_secret_unreadable', { requestId: ctx.requestId });
    return 'unreadable';
  }
  const v = verifyTotp(secret, code, ctx.services.now(), { lastAcceptedStep: user.last_otp_step });
  secret.fill(0);
  return v.ok ? v.step : null;
}

export async function login(ctx: RequestContext): Promise<void> {
  const body = await parseBody(ctx, loginSchema);
  requirePreLoginCsrf(ctx);
  const username = normalizeUsername(body.username);
  // Abuse limits BEFORE any expensive work enters the hashing queue (docs/SECURITY.md §7):
  // per source, per (source, username), then the account-wide distributed-guessing backstop.
  const source = rateLimitIdentity(ctx.clientIp);
  const counted: Array<[RateLimitBucket, string]> = [];
  const count = (bucket: RateLimitBucket, identifier: string) => {
    enforce(ctx, bucket, identifier);
    counted.push([bucket, identifier]);
  };
  count('login_ip', source);
  count('login_source_account', `${source}\u0000${username}`);
  count('login_account', username);
  // Stage 18: a refusal for CAPACITY (per-source credential concurrency, or a full hashing queue → 503) happens
  // before any password or code is checked, so it gives the attempts back. Otherwise a legitimate user retrying
  // during a sign-in surge — or while an attacker keeps the queue full — would lock themselves out for 15 minutes.
  const refund = () => {
    for (const [bucket, identifier] of counted) ctx.services.rateLimiter.refund(bucket, identifier);
  };
  let release: () => void;
  try {
    release = admitCredentialWork(ctx, source);
  } catch (err) {
    refund();
    throw err;
  }
  try {
    await loginAdmitted(ctx, body, username, source);
  } catch (err) {
    if (err instanceof PasswordHasherBusyError) refund();
    throw err;
  } finally {
    release();
  }
}

/** At most a few credential jobs in flight per source, so one client cannot fill the shared hash queue. */
function admitCredentialWork(ctx: RequestContext, source: string): () => void {
  const release = admissionFor(ctx.services).tryAcquire(source);
  if (!release) {
    ctx.log.info('rate_limited', { requestId: ctx.requestId, bucket: 'credential_concurrency' });
    throw new AppError('RATE_LIMITED', { headers: { 'Retry-After': '1' } });
  }
  return release;
}

async function loginAdmitted(ctx: RequestContext, body: z.infer<typeof loginSchema>, username: string, source: string): Promise<void> {
  const { db, hasher, now, keys } = ctx.services;
  const user = USERNAME_PATTERN.test(username) ? (db.prepare(USER_BY_USERNAME).get(username) as UserRow | undefined) : undefined;
  if (!user) {
    await hasher.verifyDummy(body.password);
    loginFailed(ctx, USERNAME_PATTERN.test(username) ? 'unknown_user' : 'invalid_username', null);
  }
  let passwordOk: boolean;
  try {
    passwordOk = await hasher.verify(body.password, user.password_hash);
  } catch (err) {
    if (!(err instanceof UnsupportedPasswordHashError)) throw err;
    ctx.log.error('unsupported_password_hash', { requestId: ctx.requestId });
    await hasher.verifyDummy(body.password);
    loginFailed(ctx, 'unsupported_hash', user.id);
  }
  if (!passwordOk) loginFailed(ctx, 'bad_password', user.id);

  let acceptedStep: number | null = null;
  if (user.role === 'admin') {
    const step = verifyAdminTotp(ctx, user, body.totp);
    if (step === 'unreadable') loginFailed(ctx, 'mfa_unreadable', user.id);
    if (step === null) loginFailed(ctx, 'mfa_failed', user.id);
    acceptedStep = step;
  }
  if (!user.merchant_id) loginFailed(ctx, 'no_profile', user.id);
  if (user.merchant_status === 'suspended') loginFailed(ctx, 'suspended', user.id);

  // Commit: re-read current state; the verification above is valid only if nothing changed meanwhile.
  const presented = parseCookies(ctx.req.headers.cookie).get(cookieNames(ctx.config.isProduction).session);
  const outcome = writeTransaction(db, () => {
    const t = now();
    const current = db.prepare(USER_BY_ID).get(user.id) as UserRow | undefined;
    if (!current || current.password_hash !== user.password_hash || current.role !== user.role || current.password_changed_at !== user.password_changed_at) {
      return { ok: false as const, reason: 'stale_credentials' as const };
    }
    // Operator recovery (password reset, authenticator replacement, session revocation; stage 15) advances
    // credential_version: a verification made with the old credentials or MFA secret is void.
    if (current.credential_version !== user.credential_version || current.totp_ciphertext !== user.totp_ciphertext) {
      return { ok: false as const, reason: 'stale_credentials' as const };
    }
    if (!current.merchant_id || current.merchant_status === 'suspended') return { ok: false as const, reason: 'suspended' as const };
    // ABA defence: any status change since the account was read (e.g. approved -> suspended -> approved)
    // invalidates this verification, even if the final status looks the same.
    if (current.merchant_access_version !== user.merchant_access_version) return { ok: false as const, reason: 'access_changed' as const };
    if (acceptedStep !== null) {
      const updated = db.prepare('UPDATE auth_users SET last_otp_step = ? WHERE id = ? AND (last_otp_step IS NULL OR last_otp_step < ?)').run(acceptedStep, user.id, acceptedStep);
      if (updated.changes !== 1) return { ok: false as const, reason: 'otp_replay' as const };
    }
    // Rotation: whatever session cookie the browser presented is destroyed (fixation defence).
    const replaced = presented && SESSION_TOKEN_PATTERN.test(presented) ? deleteSession(db, hashSessionToken(presented)) : 0;
    const session = insertSession(db, user.id, user.role, current.password_changed_at, t);
    writeAudit(db, {
      actorUserId: user.id,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      metadata: { role: user.role, mfa: user.role === 'admin', replaced_session: replaced > 0 },
      ipHmac: ipHmac(ctx),
      requestId: ctx.requestId,
      now: t,
    });
    // Only this source's pair counter is cleared; the account-wide backstop keeps counting.
    ctx.services.rateLimiter.reset('login_source_account', `${source}\u0000${username}`);
    return { ok: true as const, session, merchantStatus: current.merchant_status };
  });
  if (!outcome.ok) loginFailed(ctx, outcome.reason, user.id);

  appendSetCookie(ctx.res, sessionCookie(ctx, outcome.session.token));
  clearPreSessionCookie(ctx);
  sendJson(ctx.res, 200, {
    user: { id: user.id, username: user.username, role: user.role },
    merchant: { status: outcome.merchantStatus },
    session: { expiresAt: outcome.session.expiresAt, idleTimeoutMinutes: SESSION_POLICY.idleMs[user.role] / 60_000 },
    csrfToken: sessionCsrfToken(keys.csrf, outcome.session.token),
    system: writeStatus(ctx.services),
  });
}

// ---------------------------------------------------------------- POST /auth/logout

export async function logout(ctx: RequestContext): Promise<void> {
  // A body is optional; if present it must still be small, JSON and empty of surprises.
  if (ctx.req.headers['content-length'] !== undefined && ctx.req.headers['content-length'] !== '0') await parseBody(ctx, z.strictObject({}));
  const presented = parseCookies(ctx.req.headers.cookie).get(cookieNames(ctx.config.isProduction).session);
  const { db, now } = ctx.services;
  const found = lookupSession(db, presented, now());
  if (found.kind !== 'valid' || !presented) {
    // Nothing valid to revoke: make sure an invalid leftover row is gone, then clear the cookie.
    if (found.kind === 'invalid') writeTransaction(db, () => deleteSession(db, found.tokenHash));
    clearSessionCookie(ctx);
    sendJson(ctx.res, 200, { loggedOut: true });
    return;
  }
  const auth: AuthenticatedRequest = { identity: found.identity, token: presented };
  requireSessionCsrf(ctx, auth);
  // If this transaction fails, the error propagates: the cookie is NOT cleared and success is NOT reported.
  writeTransaction(db, () => {
    deleteSession(db, auth.identity.tokenHash);
    writeAudit(db, { actorUserId: auth.identity.userId, action: 'auth.logout', targetType: 'user', targetId: auth.identity.userId, ipHmac: ipHmac(ctx), requestId: ctx.requestId, now: now() });
  });
  clearSessionCookie(ctx);
  sendJson(ctx.res, 200, { loggedOut: true });
}

// ---------------------------------------------------------------- GET /auth/me

export function me(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  const { db, keys, now } = ctx.services;
  const m = db
    .prepare('SELECT id, status, business_name, contact_name, email, phone, governorate, address, version FROM merchants WHERE id = ?')
    .get(auth.identity.merchantId) as Record<string, string | number | null>;
  const id = auth.identity;
  const t = now();
  sendJson(ctx.res, 200, {
    user: { id: id.userId, username: id.username, role: id.role },
    merchant: {
      id: m.id,
      status: m.status,
      businessName: m.business_name,
      contactName: m.contact_name,
      email: m.email,
      phone: m.phone,
      governorate: m.governorate,
      address: m.address,
      version: m.version,
    },
    session: {
      absoluteExpiresAt: id.expiresAt,
      idleExpiresAt: Math.min(Math.max(id.lastSeenAt, t) + SESSION_POLICY.idleMs[id.role], id.expiresAt),
      recentAuthUntil: id.role === 'admin' ? id.authAt + SESSION_POLICY.recentAuthMs : null,
    },
    csrfToken: sessionCsrfToken(keys.csrf, auth.token),
    system: writeStatus(ctx.services),
  });
}

// ---------------------------------------------------------------- POST /auth/password

const passwordSchema = z.strictObject({
  currentPassword: z.string().max(4096),
  newPassword: z.string().max(4096),
  totp: z.string().max(16).optional(),
});

function passwordChangeFailed(ctx: RequestContext, userId: string, reason: string, code: 'REAUTH_FAILED' | 'CREDENTIALS_CHANGED' | 'UNAUTHENTICATED'): never {
  const { db, now } = ctx.services;
  writeTransaction(db, () =>
    writeAudit(db, { actorUserId: userId, action: 'auth.password_change_failed', targetType: 'user', targetId: userId, metadata: { reason }, ipHmac: ipHmac(ctx), requestId: ctx.requestId, now: now() }),
  );
  throw new AppError(code);
}

export async function changePassword(ctx: RequestContext): Promise<void> {
  // Stage 16 (finding F-06): authenticate and check CSRF BEFORE reading the body, like every other
  // mutation, so anonymous or cross-site requests cannot drive body parsing or validation messages.
  const auth = requireSession(ctx);
  requireSessionCsrf(ctx, auth);
  const body = await parseBody(ctx, passwordSchema);
  const id = auth.identity;
  enforce(ctx, 'password_account', id.userId);
  assertPasswordPolicy(body.newPassword, id.role, 'newPassword');

  const { db, hasher, now } = ctx.services;
  const before = db.prepare(USER_BY_ID).get(id.userId) as unknown as UserRow;
  let currentOk: boolean;
  try {
    currentOk = await hasher.verify(body.currentPassword, before.password_hash);
  } catch (err) {
    if (!(err instanceof UnsupportedPasswordHashError)) throw err;
    currentOk = false;
  }
  if (!currentOk) passwordChangeFailed(ctx, id.userId, 'bad_password', 'REAUTH_FAILED');
  let acceptedStep: number | null = null;
  if (id.role === 'admin') {
    const step = verifyAdminTotp(ctx, before, body.totp);
    if (step === null || step === 'unreadable') passwordChangeFailed(ctx, id.userId, 'mfa_failed', 'REAUTH_FAILED');
    acceptedStep = step;
  }
  const newHash = await hasher.hash(body.newPassword);

  const outcome = writeTransaction(db, () => {
    const t = now();
    const session = lookupSession(db, auth.token, t);
    if (session.kind !== 'valid' || session.identity.userId !== id.userId) return { ok: false as const, reason: 'session_ended', code: 'UNAUTHENTICATED' as const };
    const current = db.prepare(USER_BY_ID).get(id.userId) as UserRow | undefined;
    if (!current || current.password_hash !== before.password_hash || current.password_changed_at !== before.password_changed_at || current.credential_version !== before.credential_version) {
      return { ok: false as const, reason: 'stale_credentials', code: 'CREDENTIALS_CHANGED' as const };
    }
    if (acceptedStep !== null) {
      const u = db.prepare('UPDATE auth_users SET last_otp_step = ? WHERE id = ? AND (last_otp_step IS NULL OR last_otp_step < ?)').run(acceptedStep, id.userId, acceptedStep);
      if (u.changes !== 1) return { ok: false as const, reason: 'otp_replay', code: 'REAUTH_FAILED' as const };
    }
    const changedAt = Math.max(t, current.password_changed_at + 1);
    const updated = db
      .prepare('UPDATE auth_users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ? AND password_hash = ?')
      .run(newHash, changedAt, changedAt, id.userId, before.password_hash);
    if (updated.changes !== 1) return { ok: false as const, reason: 'stale_credentials', code: 'CREDENTIALS_CHANGED' as const };
    const revoked = deleteUserSessions(db, id.userId);
    writeAudit(db, {
      actorUserId: id.userId,
      action: 'auth.password_changed',
      targetType: 'user',
      targetId: id.userId,
      metadata: { sessions_revoked: revoked },
      ipHmac: ipHmac(ctx),
      requestId: ctx.requestId,
      now: t,
    });
    return { ok: true as const, revoked };
  });
  if (!outcome.ok) passwordChangeFailed(ctx, id.userId, outcome.reason, outcome.code);
  clearSessionCookie(ctx);
  sendJson(ctx.res, 200, { passwordChanged: true, sessionsRevoked: outcome.revoked, reloginRequired: true });
}
