import { createHmac } from 'node:crypto';
import { deriveKey, MissingSecretError } from './encryption.ts';

/** All purpose-separated server keys, derived once at startup from APP_SECRET. */
export interface ServerKeys {
  readonly totp: Buffer;
  readonly csrf: Buffer;
  readonly rateLimit: Buffer;
  readonly ip: Buffer;
  readonly cursor: Buffer;
}

export function deriveServerKeys(appSecret: Buffer | null): ServerKeys {
  if (!appSecret) throw new MissingSecretError('running the server (sessions, CSRF, rate limits and MFA)');
  return Object.freeze({
    totp: deriveKey(appSecret, 'totp'),
    csrf: deriveKey(appSecret, 'csrf'),
    rateLimit: deriveKey(appSecret, 'rate_limit'),
    ip: deriveKey(appSecret, 'ip'),
    cursor: deriveKey(appSecret, 'cursor'),
  });
}

export function hmacHex(key: Buffer, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

export function hmacBase64Url(key: Buffer, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('base64url');
}
