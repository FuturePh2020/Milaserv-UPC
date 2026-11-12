import type { IncomingMessage } from 'node:http';
import type { AppConfig } from '../config.ts';
import { AppError } from './errors.ts';

/**
 * Request-boundary checks for /api (docs/SECURITY.md §6):
 * - Fetch Metadata: when the browser sends Sec-Fetch-Site, API requests must be
 *   same-origin (or "none" for a directly typed GET); cross-site/same-site are refused.
 * - Unsafe methods additionally require Origin to equal APP_ORIGIN exactly
 *   (missing Origin is refused). Plain same-origin GETs do not need Origin.
 * - Content type and body size are enforced by readJsonBody at parse time.
 * There is no CORS: no Access-Control-* header is ever emitted.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method);
}

export function assertApiRequestBoundary(req: IncomingMessage, config: AppConfig): void {
  const method = req.method ?? 'GET';
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined) {
    const value = String(site).toLowerCase();
    const allowed = isSafeMethod(method) ? value === 'same-origin' || value === 'none' : value === 'same-origin';
    if (!allowed) throw new AppError('ORIGIN_REJECTED');
  }
  if (!isSafeMethod(method)) {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin !== config.appOrigin) throw new AppError('ORIGIN_REJECTED');
  }
}
