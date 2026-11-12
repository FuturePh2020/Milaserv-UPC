import { useEffect, useState } from 'react';

/**
 * Hash-based routing (D-006): the server never needs an index.html fallback.
 * Returns the current route path, e.g. "#/catalog" -> "/catalog".
 */
export function currentHashPath(): string {
  const raw = window.location.hash.replace(/^#/, '');
  if (raw === '' || raw === '/') return '/';
  const path = raw.startsWith('/') ? (raw.split('?')[0] ?? '/') : '/' + raw;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export function useHashPath(): string {
  const [path, setPath] = useState(currentHashPath);
  useEffect(() => {
    const onChange = () => setPath(currentHashPath());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path;
}
