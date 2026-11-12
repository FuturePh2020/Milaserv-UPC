import type { Router } from '../http/router.ts';
import { sendJson } from '../http/response.ts';

/**
 * GET /healthz — liveness only. Deliberately reveals no version, uptime,
 * paths, configuration or dependency details. Database reachability is added
 * in stage 02 when a database exists.
 */
export function registerHealthRoutes(router: Router): void {
  router.get('/healthz', ({ res }) => {
    sendJson(res, 200, { status: 'ok' });
  });
}
