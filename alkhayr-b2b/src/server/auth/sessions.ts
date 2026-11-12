import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Server-side sessions (docs/SECURITY.md §5). The cookie carries a random
 * 256-bit token; the database stores only SHA-256(token).
 *
 * A session is valid only if ALL hold (checked on every request, server time):
 *   now < expires_at (absolute 8 h) · now < last_seen_at + idle (admin 15 min, trader 30 min)
 *   · sessions.password_changed_at = auth_users.password_changed_at
 *   · the account has a merchant profile that is not suspended.
 * Invalid sessions are deleted, never revived: the idle "touch" is a
 * conditional UPDATE that re-checks expiry in its WHERE clause.
 */

export const SESSION_POLICY = Object.freeze({
  idleMs: Object.freeze({ admin: 15 * 60_000, trader: 30 * 60_000 }),
  absoluteMs: 8 * 60 * 60_000,
  maxPerUser: 5,
  recentAuthMs: 15 * 60_000,
  /** last_seen_at is written at most once per interval (effective idle precision). */
  touchIntervalMs: 60_000,
});

export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type Role = 'admin' | 'trader';
export type MerchantStatus = 'pending' | 'approved' | 'suspended';

export interface Identity {
  readonly userId: string;
  readonly username: string;
  readonly role: Role;
  readonly merchantId: string;
  readonly merchantStatus: MerchantStatus;
  readonly tokenHash: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
  readonly authAt: number;
  readonly idleExpiresAt: number;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}

interface SessionRow {
  token_hash: string;
  user_id: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  auth_at: number;
  session_pca: number;
  user_pca: number;
  username: string;
  role: Role;
  merchant_id: string | null;
  merchant_status: MerchantStatus | null;
}

export type SessionLookup = { kind: 'none' } | { kind: 'invalid'; tokenHash: string } | { kind: 'valid'; identity: Identity };

/** Read-only lookup and validation of a presented raw token. */
export function lookupSession(db: DatabaseSync, rawToken: string | undefined, now: number): SessionLookup {
  if (!rawToken || !SESSION_TOKEN_PATTERN.test(rawToken)) return { kind: 'none' };
  const tokenHash = hashSessionToken(rawToken);
  const row = db
    .prepare(
      `SELECT s.token_hash, s.user_id, s.created_at, s.last_seen_at, s.expires_at, s.auth_at, s.password_changed_at AS session_pca,
              u.password_changed_at AS user_pca, u.username, u.role, m.id AS merchant_id, m.status AS merchant_status
         FROM sessions s JOIN auth_users u ON u.id = s.user_id LEFT JOIN merchants m ON m.user_id = u.id
        WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as SessionRow | undefined;
  if (!row) return { kind: 'none' };
  const idleExpiresAt = row.last_seen_at + SESSION_POLICY.idleMs[row.role];
  const valid =
    now < row.expires_at &&
    now < idleExpiresAt &&
    row.session_pca === row.user_pca &&
    row.merchant_id !== null &&
    row.merchant_status !== null &&
    row.merchant_status !== 'suspended';
  if (!valid) return { kind: 'invalid', tokenHash };
  return {
    kind: 'valid',
    identity: {
      userId: row.user_id,
      username: row.username,
      role: row.role,
      merchantId: row.merchant_id as string,
      merchantStatus: row.merchant_status as MerchantStatus,
      tokenHash,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      authAt: row.auth_at,
      idleExpiresAt: Math.min(idleExpiresAt, row.expires_at),
    },
  };
}

/** Extends the idle window if due. Conditional: an expired session is never revived. */
export function touchSession(db: DatabaseSync, identity: Identity, now: number): boolean {
  if (now - identity.lastSeenAt < SESSION_POLICY.touchIntervalMs) return false;
  const idle = SESSION_POLICY.idleMs[identity.role];
  return (
    db
      .prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ? AND last_seen_at < ? AND expires_at > ? AND last_seen_at + ? > ?')
      .run(now, identity.tokenHash, now, now, idle, now).changes === 1
  );
}

/**
 * Inserts a new session for `userId` (call inside the login transaction).
 * Removes the user's expired/idle sessions and keeps at most maxPerUser - 1
 * existing ones (newest first) so the new session makes exactly the cap.
 */
export function insertSession(db: DatabaseSync, userId: string, role: Role, passwordChangedAt: number, now: number): { token: string; tokenHash: string; expiresAt: number } {
  const { token, tokenHash } = newSessionToken();
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND (expires_at <= ? OR last_seen_at + ? <= ?)').run(userId, now, SESSION_POLICY.idleMs[role], now);
  db.prepare(
    `DELETE FROM sessions WHERE token_hash IN (
       SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC, token_hash DESC LIMIT -1 OFFSET ?)`,
  ).run(userId, SESSION_POLICY.maxPerUser - 1);
  const expiresAt = now + SESSION_POLICY.absoluteMs;
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, auth_at, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    tokenHash,
    userId,
    now,
    now,
    expiresAt,
    now,
    passwordChangedAt,
  );
  return { token, tokenHash, expiresAt };
}

export function deleteSession(db: DatabaseSync, tokenHash: string): number {
  return Number(db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash).changes);
}

export function deleteUserSessions(db: DatabaseSync, userId: string): number {
  return Number(db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes);
}

/** Periodic cleanup: absolute expiry or beyond the longest idle timeout. Bounded per call. */
export function sweepExpiredSessions(db: DatabaseSync, now: number, batch = 5000): number {
  const maxIdle = Math.max(SESSION_POLICY.idleMs.admin, SESSION_POLICY.idleMs.trader);
  return Number(
    db
      .prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at <= ? OR last_seen_at + ? <= ? LIMIT ?)')
      .run(now, maxIdle, now, batch).changes,
  );
}
