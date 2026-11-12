import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from './config.ts';
import type { Logger } from './logger.ts';
import { AppError, isAppError } from './http/errors.ts';
import { parseRequestTarget } from './http/request-target.ts';
import { sendError } from './http/response.ts';
import { methodNotAllowed, Router } from './http/router.ts';
import { applySecurityHeaders } from './http/security-headers.ts';
import type { StaticFiles } from './http/static-files.ts';
import type { ReadinessProbe } from './database/readiness.ts';
import { registerHealthRoutes } from './routes/health.ts';

export interface AppState {
  shuttingDown: boolean;
}

export interface App {
  readonly router: Router;
  readonly state: AppState;
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

const API_PREFIX = /^\/api(\/|$)/;

export interface AppDependencies {
  readonly staticFiles: StaticFiles;
  readonly readiness: ReadinessProbe;
}

export function createApp(config: AppConfig, log: Logger, deps: AppDependencies): App {
  const { staticFiles } = deps;
  const router = new Router();
  registerHealthRoutes(router, deps.readiness);
  // Business routes under /api/v1 are registered by later stages.

  const state: AppState = { shuttingDown: false };

  async function dispatch(req: IncomingMessage, res: ServerResponse, requestId: string): Promise<void> {
    if (state.shuttingDown) {
      res.setHeader('Connection', 'close');
      throw new AppError('UNAVAILABLE');
    }
    const { pathname, query } = parseRequestTarget(req.url);

    // Host must match the configured public origin (blocks DNS-rebinding and
    // requests that bypass the documented proxy hostname).
    const host = req.headers.host?.toLowerCase();
    if (host !== config.expectedHost) throw new AppError('HOST_REJECTED');

    const method = req.method ?? 'GET';
    const match = router.match(method, pathname);
    if (match.kind === 'matched') {
      await match.handler({ req, res, requestId, pathname, query, params: match.params, config, log });
      return;
    }
    if (match.kind === 'method_not_allowed') throw methodNotAllowed(match.allow);

    // No SPA fallback: unknown API paths are JSON 404s, unknown pages are 404s.
    if (API_PREFIX.test(pathname)) throw new AppError('NOT_FOUND');
    if (staticFiles.serve(method, pathname, req.headers['if-none-match'], res)) return;
    if (staticFiles.has(pathname)) throw methodNotAllowed(['GET', 'HEAD']);
    throw new AppError('NOT_FOUND');
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    const started = process.hrtime.bigint();
    res.setHeader('X-Request-Id', requestId);
    applySecurityHeaders(res, config.isProduction);

    res.once('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      // Path only (no query string: it may later carry search terms); no headers or bodies.
      const rawPath = (req.url ?? '').split('?')[0]?.slice(0, 256);
      log.info('http_request', { requestId, method: req.method, path: rawPath, status: res.statusCode, ms: Math.round(ms) });
    });

    try {
      await dispatch(req, res, requestId);
    } catch (err) {
      if (isAppError(err)) {
        sendError(res, requestId, err.code, err);
      } else {
        log.error('unhandled_request_error', { requestId, error: err instanceof Error ? err : String(err) });
        sendError(res, requestId, 'INTERNAL');
      }
    }
  }

  return { router, state, handle };
}
