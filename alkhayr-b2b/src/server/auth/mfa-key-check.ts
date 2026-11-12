import type { DatabaseSync } from 'node:sqlite';
import { decryptSecret, deriveKey, EnvelopeError, totpAad } from './encryption.ts';
import { TOTP_SECRET_BYTES } from './totp.ts';

export class SecurityConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SecurityConfigError';
    this.code = code;
  }
}

/**
 * Startup check: every administrator's MFA secret must decrypt with the
 * configured APP_SECRET. On failure the process refuses to start with an
 * actionable message; it NEVER replaces the secret, disables MFA or resets an
 * account. Returns the number of administrators (0 is allowed: setup-admin pending).
 */
export function assertAdministratorMfaReadable(db: DatabaseSync, appSecret: Buffer | null): { administrators: number } {
  const admins = db.prepare("SELECT id, totp_ciphertext FROM auth_users WHERE role = 'admin'").all() as Array<{ id: string; totp_ciphertext: string }>;
  if (admins.length === 0) return { administrators: 0 };
  if (!appSecret) {
    throw new SecurityConfigError(
      'APP_SECRET_REQUIRED',
      'Administrator accounts exist but APP_SECRET is not configured. Configure the same APP_SECRET that was used when the administrator was enrolled.',
    );
  }
  const key = deriveKey(appSecret, 'totp');
  let failures = 0;
  let lastCode = '';
  for (const admin of admins) {
    try {
      const secret = decryptSecret(key, admin.totp_ciphertext, totpAad(admin.id));
      if (secret.length < TOTP_SECRET_BYTES) throw new EnvelopeError('MALFORMED');
    } catch (err) {
      failures++;
      lastCode = err instanceof EnvelopeError ? err.code : 'UNKNOWN';
    }
  }
  if (failures > 0) {
    throw new SecurityConfigError(
      'MFA_KEY_MISMATCH',
      `${failures} of ${admins.length} administrator MFA secret(s) cannot be decrypted with the configured APP_SECRET (${lastCode}). ` +
        'The key differs from the one used at enrollment, or the stored value was altered. Restore the original APP_SECRET from your secret store. ' +
        'Do not reset or disable MFA to work around this; if the original key is irrecoverably lost, use the local MFA-reset procedure (stage 15) after verifying the administrator identity.',
    );
  }
  return { administrators: admins.length };
}
