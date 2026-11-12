import { AppError } from './errors.ts';
import { LIMITS } from '../../shared/constants.ts';

export interface RequestTarget {
  /** Raw (still percent-encoded) path, validated, never normalized. */
  pathname: string;
  query: URLSearchParams;
}

// Encoded dot, slash, backslash or NUL anywhere in the path is never legitimate here.
const FORBIDDEN_ENCODED = /%(2e|2f|5c|00)/i;
// Only printable ASCII is accepted in the raw path.
const ALLOWED_RAW = /^[\x21-\x7e]+$/;

/**
 * Parse an origin-form request target ("/path?query") WITHOUT resolving dot
 * segments: a request for "/assets/../.env" is rejected, not rewritten.
 * Absolute-form, authority-form and asterisk-form targets are rejected.
 */
export function parseRequestTarget(rawUrl: string | undefined): RequestTarget {
  if (rawUrl === undefined || rawUrl.length === 0) throw new AppError('BAD_REQUEST');
  if (rawUrl.length > LIMITS.maxUrlLength) throw new AppError('URI_TOO_LONG');
  if (!rawUrl.startsWith('/') || rawUrl.startsWith('//')) throw new AppError('BAD_REQUEST');
  if (!ALLOWED_RAW.test(rawUrl)) throw new AppError('BAD_REQUEST');

  const hashIndex = rawUrl.indexOf('#');
  const withoutHash = hashIndex === -1 ? rawUrl : rawUrl.slice(0, hashIndex);
  const qIndex = withoutHash.indexOf('?');
  const pathname = qIndex === -1 ? withoutHash : withoutHash.slice(0, qIndex);
  const search = qIndex === -1 ? '' : withoutHash.slice(qIndex + 1);

  if (pathname.includes('\\') || FORBIDDEN_ENCODED.test(pathname)) throw new AppError('BAD_REQUEST');
  const segments = pathname.split('/').slice(1);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '.' || seg === '..') throw new AppError('BAD_REQUEST');
    // Empty segments ("//") are only allowed as a single trailing slash.
    if (seg === '' && i !== segments.length - 1) throw new AppError('BAD_REQUEST');
  }
  return { pathname, query: new URLSearchParams(search) };
}
