import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiFailure, ApiResult } from '../api/client.ts';
import { useIdentity } from '../session/identity.tsx';

export type LoadState<T> = { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error'; failure: ApiFailure };

/**
 * Loads data for a screen. Each change of `key` aborts the previous request, and a response that
 * is no longer the latest is ignored, so an older search can never replace newer results.
 * Session/approval failures are passed to the identity provider (which removes protected UI).
 */
export function useLoad<T>(key: string, fetcher: (signal: AbortSignal) => Promise<ApiResult<T>>): LoadState<T> & { reload: () => void } {
  const { handleAuthFailure } = useIdentity();
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const id = ++latest.current;
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetcherRef.current(controller.signal).then(
      (r) => {
        if (controller.signal.aborted || id !== latest.current) return;
        if (r.ok) setState({ status: 'ok', data: r.data });
        else {
          handleAuthFailure(r);
          setState({ status: 'error', failure: r });
        }
      },
      () => undefined, // aborted
    );
    return () => controller.abort();
  }, [key, attempt, handleAuthFailure]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  return { ...state, reload };
}

/**
 * Like useLoad, but keeps showing the last successfully loaded record while a reload runs (and if
 * a reload fails), so forms with unsent operator drafts are not unmounted by a refresh. The caller
 * shows `refreshing` / `failure` alongside the retained data. Data of another `scope` (record id)
 * is never shown.
 */
export function useStickyLoad<T>(scope: string, generation: number, fetcher: (signal: AbortSignal) => Promise<ApiResult<T>>) {
  const load = useLoad(`${scope}#${generation}`, fetcher);
  const [last, setLast] = useState<{ scope: string; data: T } | null>(null);
  const fresh = load.status === 'ok' ? load.data : null;
  useEffect(() => {
    if (fresh !== null) setLast({ scope, data: fresh });
  }, [fresh, scope]);
  const data = fresh ?? (last && last.scope === scope ? last.data : null);
  return {
    data,
    refreshing: load.status === 'loading' && data !== null,
    failure: load.status === 'error' ? load.failure : null,
    initialLoading: load.status === 'loading' && data === null,
    reload: load.reload,
  };
}
