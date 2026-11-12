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
