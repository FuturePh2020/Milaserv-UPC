import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Purpose-separated keys and authenticated encryption (docs/SECURITY.md §3–4).
 *
 * Keys: HKDF-SHA256(ikm = APP_SECRET bytes, salt = "alkhayr/kdf/v1", info = "alkhayr:<purpose>:v1").
 * Each purpose gets an independent 32-byte key; BACKUP_KEY is NOT derived from
 * APP_SECRET (it is a separate, independently generated secret, stage 15).
 *
 * Envelope (version 1): "v1." + base64url( nonce[12] || ciphertext || tag[16] ),
 * AES-256-GCM with a fresh random nonce per encryption and caller-supplied AAD
 * (e.g. the user id, binding a ciphertext to its row).
 *
 * Decryption failures are explicit and never return partial plaintext:
 *   MALFORMED            not "v<digits>.<base64url>" or non-canonical base64url
 *   UNSUPPORTED_VERSION  version other than 1
 *   TRUNCATED            shorter than nonce + tag + 1 byte
 *   AUTH_FAILED          wrong key, wrong AAD, or modified data
 */

export const KEY_PURPOSES = ['totp', 'csrf', 'cursor', 'ip', 'rate_limit', 'import_preview'] as const;
export type KeyPurpose = (typeof KEY_PURPOSES)[number];

const KDF_SALT = Buffer.from('alkhayr/kdf/v1', 'utf8');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_VERSION = 1;
const MAX_ENVELOPE_CHARS = 4096;

export class MissingSecretError extends Error {
  readonly code = 'APP_SECRET_REQUIRED';
  constructor(purpose: string) {
    super(`APP_SECRET is required for ${purpose}. Generate one locally (see .env.example) and configure it; no fallback key is ever generated.`);
    this.name = 'MissingSecretError';
  }
}

export type EnvelopeErrorCode = 'MALFORMED' | 'UNSUPPORTED_VERSION' | 'TRUNCATED' | 'AUTH_FAILED';

export class EnvelopeError extends Error {
  readonly code: EnvelopeErrorCode;
  constructor(code: EnvelopeErrorCode) {
    super(`Encrypted value rejected: ${code}`);
    this.name = 'EnvelopeError';
    this.code = code;
  }
}

export function deriveKey(appSecret: Buffer | null, purpose: KeyPurpose): Buffer {
  if (!appSecret || appSecret.length < 32) throw new MissingSecretError(`the ${purpose} key`);
  if (!(KEY_PURPOSES as readonly string[]).includes(purpose)) throw new RangeError('unknown key purpose');
  return Buffer.from(hkdfSync('sha256', appSecret, KDF_SALT, Buffer.from(`alkhayr:${purpose}:v1`, 'utf8'), 32));
}

export function encryptSecret(key: Buffer, plaintext: Buffer, aad: string): string {
  if (key.length !== 32) throw new RangeError('AES-256-GCM key must be 32 bytes');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `v${ENVELOPE_VERSION}.${Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64url')}`;
}

export function decryptSecret(key: Buffer, envelope: unknown, aad: string): Buffer {
  if (typeof envelope !== 'string' || envelope.length > MAX_ENVELOPE_CHARS) throw new EnvelopeError('MALFORMED');
  const m = /^v(\d{1,3})\.([A-Za-z0-9_-]*)$/.exec(envelope);
  if (!m) throw new EnvelopeError('MALFORMED');
  if (Number(m[1]) !== ENVELOPE_VERSION) throw new EnvelopeError('UNSUPPORTED_VERSION');
  const raw = Buffer.from(m[2] as string, 'base64url');
  if (raw.toString('base64url') !== m[2]) throw new EnvelopeError('MALFORMED');
  if (raw.length < NONCE_BYTES + TAG_BYTES + 1) throw new EnvelopeError('TRUNCATED');
  const nonce = raw.subarray(0, NONCE_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const body = raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new EnvelopeError('AUTH_FAILED');
  }
}

/** AAD binding an MFA ciphertext to its user row. */
export function totpAad(userId: string): string {
  return `alkhayr:totp:v1:${userId}`;
}
