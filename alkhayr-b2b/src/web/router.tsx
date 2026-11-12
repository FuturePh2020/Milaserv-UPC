import { useEffect, useState } from 'react';

/**
 * Hash-based routing (D-006): the server never needs an index.html fallback.
 * "#/catalog?q=x" -> { path: "/catalog", query: q=x }. Navigation targets are always internal
 * paths built by the app; there is no "next"/redirect parameter, so no open redirect exists.
 */
export interface Route {
  path: string;
  query: URLSearchParams;
}

export function currentRoute(): Route {
  const raw = window.location.hash.replace(/^#/, '');
  const [rawPath = '', rawQuery = ''] = raw.split('?', 2);
  let path = rawPath === '' ? '/' : rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return { path, query: new URLSearchParams(rawQuery) };
}

/** Kept for existing callers. */
export function currentHashPath(): string {
  return currentRoute().path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function useHashPath(): string {
  return useRoute().path;
}

/** Builds an internal hash link. Only app-defined paths starting with "/" are accepted. */
export function href(path: string, query?: Record<string, string | undefined>): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('internal paths only');
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) params.set(k, v);
  const s = params.toString();
  return `#${path}${s ? `?${s}` : ''}`;
}

export function navigate(path: string, query?: Record<string, string | undefined>, options: { replace?: boolean } = {}): void {
  const target = href(path, query);
  if (options.replace) {
    window.history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}
