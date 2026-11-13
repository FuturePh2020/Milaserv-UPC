import { AppError } from '../http/errors.ts';
import type { Router } from '../http/router.ts';
import { sendJson } from '../http/response.ts';
import type { ReadinessProbe } from '../database/readiness.ts';

/**
 * GET /healthz — process liveness only (no database access).
 * GET /readyz  — the database is reachable, is the configured file, and is at
 *                the schema version this release requires.
 * Neither response reveals versions, paths, SQL, configuration or data.
 */
export function registerHealthRoutes(router: Router, readiness: ReadinessProbe, writes?: () => 'open' | 'closed'): void {
  router.get('/healthz', ({ res }) => {
    sendJson(res, 200, { status: 'ok' });
  });
  router.get('/readyz', ({ res }) => {
    if (!readiness()) throw new AppError('NOT_READY', { headers: { 'Retry-After': '5' } });
    // Stage 16: a restored installation in recovery mode (or under an integrity hold) is up for reads but
    // closed for new business writes. Only that one word is disclosed — never the reason or any data.
    sendJson(res, 200, { status: 'ready', writes: writes ? safeWrites(writes) : 'open' });
  });
}

function safeWrites(writes: () => 'open' | 'closed'): 'open' | 'closed' {
  try {
    return writes();
  } catch {
    return 'closed';
  }
}
