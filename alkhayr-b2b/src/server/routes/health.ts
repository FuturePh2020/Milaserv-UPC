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
export function registerHealthRoutes(router: Router, readiness: ReadinessProbe): void {
  router.get('/healthz', ({ res }) => {
    sendJson(res, 200, { status: 'ok' });
  });
  router.get('/readyz', ({ res }) => {
    if (!readiness()) throw new AppError('NOT_READY', { headers: { 'Retry-After': '5' } });
    sendJson(res, 200, { status: 'ready' });
  });
}
