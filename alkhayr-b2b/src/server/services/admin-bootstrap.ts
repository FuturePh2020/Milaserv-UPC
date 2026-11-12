import type { DatabaseSync } from 'node:sqlite';
import { writeTransaction } from '../database/transaction.ts';
import type { MerchantProfile } from '../../shared/schemas.ts';

/**
 * Administrator bootstrap (stage 03). Expensive/async work (password hashing,
 * TOTP enrollment proof, encryption) happens BEFORE `createAdministrator`; the
 * write itself is one synchronous transaction that re-checks every
 * precondition, so a failure or race leaves no partially created administrator.
 */

export type BootstrapErrorCode = 'ADMIN_EXISTS' | 'USERNAME_TAKEN';

export class BootstrapError extends Error {
  readonly code: BootstrapErrorCode;
  constructor(code: BootstrapErrorCode, message: string) {
    super(message);
    this.name = 'BootstrapError';
    this.code = code;
  }
}

export function countAdministrators(db: DatabaseSync): number {
  return Number((db.prepare("SELECT count(*) AS n FROM auth_users WHERE role = 'admin'").get() as { n: number }).n);
}

export function assertNoAdministrator(db: DatabaseSync): void {
  if (countAdministrators(db) > 0) {
    throw new BootstrapError(
      'ADMIN_EXISTS',
      'An administrator already exists. setup-admin only bootstraps the first administrator; nothing was changed.',
    );
  }
}

export function assertUsernameAvailable(db: DatabaseSync, username: string): void {
  const row = db.prepare('SELECT role FROM auth_users WHERE username = ? COLLATE NOCASE').get(username) as { role: string } | undefined;
  if (row) {
    throw new BootstrapError(
      'USERNAME_TAKEN',
      `The username is already used by an existing ${row.role === 'trader' ? 'trader' : 'account'}. Existing accounts are never promoted to administrator; choose another username.`,
    );
  }
}

export interface PreparedAdministrator {
  userId: string;
  merchantId: string;
  username: string;
  /** Encoded scrypt hash — never the password. */
  passwordHash: string;
  /** AES-256-GCM envelope — never the raw TOTP secret. */
  totpCiphertext: string;
  /** TOTP step proven during enrollment; becomes last_otp_step (anti-replay baseline). */
  acceptedStep: number;
  profile: MerchantProfile;
}

export function createAdministrator(db: DatabaseSync, admin: PreparedAdministrator, now: number, requestId: string): void {
  writeTransaction(db, () => {
    assertNoAdministrator(db);
    assertUsernameAvailable(db, admin.username);
    db.prepare(
      `INSERT INTO auth_users (id, username, password_hash, password_changed_at, role, totp_ciphertext, last_otp_step, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', ?, ?, ?, ?)`,
    ).run(admin.userId, admin.username, admin.passwordHash, now, admin.totpCiphertext, admin.acceptedStep, now, now);
    const p = admin.profile;
    db.prepare(
      `INSERT INTO merchants (id, user_id, business_name, contact_name, email, phone, governorate, address, status, version, status_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', 1, ?, ?, ?)`,
    ).run(admin.merchantId, admin.userId, p.businessName, p.contactName, p.email, p.phone, p.governorate, p.address, now, now, now);
    db.prepare(
      `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, ip_hmac, request_id, created_at)
       VALUES (?, 'admin.bootstrap', 'user', ?, ?, NULL, ?, ?)`,
    ).run(admin.userId, admin.userId, JSON.stringify({ method: 'cli', mfa: 'totp' }), requestId, now);
  });
}
