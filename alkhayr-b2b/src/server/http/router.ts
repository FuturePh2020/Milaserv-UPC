import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from '../config.ts';
import type { Logger } from '../logger.ts';
import { AppError } from './errors.ts';

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly requestId: string;
  readonly pathname: string;
  readonly query: URLSearchParams;
  readonly params: Readonly<Record<string, string>>;
  readonly config: AppConfig;
  readonly log: Logger;
}

export type Handler = (ctx: RequestContext) => void | Promise<void>;

interface Route {
  method: HttpMethod;
  segments: string[];
  handler: Handler;
}

export type RouteMatch =
  | { kind: 'matched'; handler: Handler; params: Record<string, string> }
  | { kind: 'method_not_allowed'; allow: HttpMethod[] }
  | { kind: 'not_found' };

const PARAM_VALUE = /^[A-Za-z0-9._~-]{1,128}$/;

/**
 * Minimal exact-segment router. Patterns use ":name" segments. GET routes also
 * answer HEAD. Parameters are restricted to unreserved characters.
 */
export class Router {
  readonly #routes: Route[] = [];

  add(method: HttpMethod, pattern: string, handler: Handler): this {
    if (!pattern.startsWith('/')) throw new Error(`Route pattern must start with "/": ${pattern}`);
    this.#routes.push({ method, segments: pattern.split('/').slice(1), handler });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.add('GET', pattern, handler);
  }

  match(method: string, pathname: string): RouteMatch {
    const parts = pathname.split('/').slice(1);
    const allow = new Set<HttpMethod>();
    for (const route of this.#routes) {
      const params = matchSegments(route.segments, parts);
      if (!params) continue;
      allow.add(route.method);
      if (route.method === 'GET') allow.add('HEAD');
      if (route.method === method || (method === 'HEAD' && route.method === 'GET')) {
        return { kind: 'matched', handler: route.handler, params };
      }
    }
    if (allow.size > 0) return { kind: 'method_not_allowed', allow: [...allow] };
    return { kind: 'not_found' };
  }
}

function matchSegments(pattern: string[], parts: string[]): Record<string, string> | null {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i] as string;
    const v = parts[i] as string;
    if (p.startsWith(':')) {
      if (!PARAM_VALUE.test(v)) return null;
      params[p.slice(1)] = v;
    } else if (p !== v) {
      return null;
    }
  }
  return params;
}

export function methodNotAllowed(allow: HttpMethod[]): AppError {
  return new AppError('METHOD_NOT_ALLOWED', { headers: { Allow: allow.join(', ') } });
}
