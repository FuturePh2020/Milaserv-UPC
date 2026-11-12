import { timingSafeEqual } from 'node:crypto';
import { hmacBase64Url } from '../auth/keys.ts';
import { AppError } from './errors.ts';

/**
 * Opaque, tamper-evident keyset cursors: base64url(JSON payload) + "." + HMAC.
 * The MAC covers the payload, the requesting user and a "scope" string that
 * encodes the endpoint, sort and filters, so a cursor cannot be forged, edited,
 * replayed by another user, or reused with different filters.
 */

export function encodeCursor(key: Buffer, scope: string, userId: string, position: unknown[]): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, p: position })).toString('base64url');
  return `${payload}.${hmacBase64Url(key, `cursor\0${scope}\0${userId}\0${payload}`)}`;
}

export function decodeCursor(key: Buffer, scope: string, userId: string, cursor: string): unknown[] {
  const invalid = () => new AppError('VALIDATION_FAILED', { fields: [{ path: 'cursor', message: 'مؤشر الصفحة غير صالح. ابدأ من الصفحة الأولى.' }] });
  const m = /^([A-Za-z0-9_-]{1,1024})\.([A-Za-z0-9_-]{43})$/.exec(cursor);
  if (!m) throw invalid();
  const expected = Buffer.from(hmacBase64Url(key, `cursor\0${scope}\0${userId}\0${m[1]}`));
  const given = Buffer.from(m[2] as string);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid();
  let parsed: { v?: unknown; p?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(m[1] as string, 'base64url').toString('utf8')) as { v?: unknown; p?: unknown };
  } catch {
    throw invalid();
  }
  if (parsed.v !== 1 || !Array.isArray(parsed.p)) throw invalid();
  return parsed.p;
}
