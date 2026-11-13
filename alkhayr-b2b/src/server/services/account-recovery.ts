import type { DatabaseSync } from 'node:sqlite';
import { writeTransaction } from '../database/transaction.ts';
import type { MerchantProfile } from '../../shared/schemas.ts';
import { assertUsernameAvailable } from './admin-bootstrap.ts';

/**
 * Operator account provisioning and recovery (stage 15). Called ONLY by the trusted-operator CLI
 * (server stopped, instance lock held). Every write is one transaction that re-checks the target's
 * `credential_version` (migration 0007), advances it, revokes all sessions where credentials change,
 * and appends an audit row with actor NULL (operator) and the operator's reason — never passwords,
 * hashes, TOTP secrets or codes. Roles and approval status are never changed here.
 */

export class RecoveryError extends Error {
  readonly code: 'NOT_FOUND' | 'ACCOUNT_CHANGED' | 'NOT_ADMIN' | 'NO_PROFILE';
  constructor(code: RecoveryError['code'], message: string) {
    super(message);
    this.name = 'RecoveryError';
    this.code = code;
  }
}

export interface AccountSummary {
  id: string;
  username: string;
  role: 'admin' | 'trader';
  credentialVersion: number;
  lastOtpStep: number | null;
  businessName: string | null;
  merchantStatus: string | null;
  sessions: number;
}

export function findAccount(db: DatabaseSync, username: string): AccountSummary | null {
  const r = db
    .prepare(
      `SELECT u.id, u.username, u.role, u.credential_version, u.last_otp_step, m.business_name, m.status,
              (SELECT count(*) FROM sessions s WHERE s.user_id = u.id) AS sessions
         FROM auth_users u LEFT JOIN merchants m ON m.user_id = u.id WHERE u.username = ? COLLATE NOCASE`,
    )
    .get(username) as
    | { id: string; username: string; role: 'admin' | 'trader'; credential_version: number; last_otp_step: number | null; business_name: string | null; status: string | null; sessions: number }
    | undefined;
  if (!r) return null;
  return { id: r.id, username: r.username, role: r.role, credentialVersion: r.credential_version, lastOtpStep: r.last_otp_step, businessName: r.business_name, merchantStatus: r.status, sessions: Number(r.sessions) };
}

function audit(db: DatabaseSync, action: string, userId: string, meta: Record<string, string | number | boolean>, requestId: string, now: number) {
  db.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, ip_hmac, request_id, created_at) VALUES (NULL, ?, 'user', ?, ?, NULL, ?, ?)").run(
    action,
    userId,
    JSON.stringify(meta),
    requestId,
    now,
  );
}

/** Advances credential_version iff it still equals `expected` (operator saw the current account). */
function bump(db: DatabaseSync, userId: string, expected: number, extraSet = '', extraParams: Array<string | number> = []): number {
  const r = db.prepare(`UPDATE auth_users SET credential_version = credential_version + 1${extraSet} WHERE id = ? AND credential_version = ?`).run(...extraParams, userId, expected);
  if (r.changes !== 1) throw new RecoveryError('ACCOUNT_CHANGED', 'The account changed while this command was running (another recovery action or a password change). Nothing was saved; run the command again.');
  return expected + 1;
}

export function resetPassword(db: DatabaseSync, o: { userId: string; expectedCredentialVersion: number; passwordHash: string; reason: string; now: number; requestId: string }): { sessionsRevoked: number } {
  return writeTransaction(db, () => {
    const cur = db.prepare('SELECT password_changed_at FROM auth_users WHERE id = ?').get(o.userId) as { password_changed_at: number } | undefined;
    if (!cur) throw new RecoveryError('NOT_FOUND', 'The account no longer exists.');
    const changedAt = Math.max(o.now, cur.password_changed_at + 1);
    const version = bump(db, o.userId, o.expectedCredentialVersion, ', password_hash = ?, password_changed_at = ?, updated_at = ?', [o.passwordHash, changedAt, changedAt]);
    const sessionsRevoked = Number(db.prepare('DELETE FROM sessions WHERE user_id = ?').run(o.userId).changes);
    audit(db, 'account.password_reset', o.userId, { method: 'cli', reason: o.reason, sessions_revoked: sessionsRevoked, credential_version: version }, o.requestId, changedAt);
    return { sessionsRevoked };
  });
}

/**
 * Replaces an administrator's authenticator. The OLD enrollment stays valid until this commit; the
 * new secret is already encrypted with the user-bound key and was proven with a code at `acceptedStep`,
 * which becomes the anti-replay baseline (never lowered).
 */
export function replaceTotp(db: DatabaseSync, o: { userId: string; expectedCredentialVersion: number; totpCiphertext: string; acceptedStep: number; reason: string; now: number; requestId: string }): { sessionsRevoked: number } {
  return writeTransaction(db, () => {
    const cur = db.prepare('SELECT role, last_otp_step FROM auth_users WHERE id = ?').get(o.userId) as { role: string; last_otp_step: number | null } | undefined;
    if (!cur) throw new RecoveryError('NOT_FOUND', 'The account no longer exists.');
    if (cur.role !== 'admin') throw new RecoveryError('NOT_ADMIN', 'Only administrator accounts use an authenticator.');
    const step = Math.max(cur.last_otp_step ?? 0, o.acceptedStep);
    const version = bump(db, o.userId, o.expectedCredentialVersion, ', totp_ciphertext = ?, last_otp_step = ?, updated_at = ?', [o.totpCiphertext, step, o.now]);
    const sessionsRevoked = Number(db.prepare('DELETE FROM sessions WHERE user_id = ?').run(o.userId).changes);
    audit(db, 'account.mfa_replaced', o.userId, { method: 'cli', reason: o.reason, sessions_revoked: sessionsRevoked, credential_version: version }, o.requestId, o.now);
    return { sessionsRevoked };
  });
}

export function revokeSessions(db: DatabaseSync, o: { userId: string; expectedCredentialVersion: number; reason: string; now: number; requestId: string }): { sessionsRevoked: number } {
  return writeTransaction(db, () => {
    if (!db.prepare('SELECT 1 FROM auth_users WHERE id = ?').get(o.userId)) throw new RecoveryError('NOT_FOUND', 'The account no longer exists.');
    const version = bump(db, o.userId, o.expectedCredentialVersion, ', updated_at = max(updated_at, ?)', [o.now]);
    const sessionsRevoked = Number(db.prepare('DELETE FROM sessions WHERE user_id = ?').run(o.userId).changes);
    audit(db, 'account.sessions_revoked', o.userId, { method: 'cli', reason: o.reason, sessions_revoked: sessionsRevoked, credential_version: version }, o.requestId, o.now);
    return { sessionsRevoked };
  });
}

/** An ADDITIONAL administrator (setup-admin remains first-administrator only). Never promotes anyone. */
export function createAdditionalAdministrator(
  db: DatabaseSync,
  a: { userId: string; merchantId: string; username: string; passwordHash: string; totpCiphertext: string; acceptedStep: number; profile: MerchantProfile; reason: string },
  now: number,
  requestId: string,
): void {
  writeTransaction(db, () => {
    assertUsernameAvailable(db, a.username);
    db.prepare(
      `INSERT INTO auth_users (id, username, password_hash, password_changed_at, role, totp_ciphertext, last_otp_step, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', ?, ?, ?, ?)`,
    ).run(a.userId, a.username, a.passwordHash, now, a.totpCiphertext, a.acceptedStep, now, now);
    const p = a.profile;
    db.prepare(
      `INSERT INTO merchants (id, user_id, business_name, contact_name, email, phone, governorate, address, status, version, status_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', 1, ?, ?, ?)`,
    ).run(a.merchantId, a.userId, p.businessName, p.contactName, p.email, p.phone, p.governorate, p.address, now, now, now);
    audit(db, 'admin.created', a.userId, { method: 'cli', mfa: 'totp', reason: a.reason }, requestId, now);
  });
}
