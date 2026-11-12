import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiFailure, ApiResult } from '../api/client.ts';
import type { Page } from '../api/contracts.ts';
import { useIdentity } from '../session/identity.tsx';

export interface PagedState<T> {
  status: 'loading' | 'ok' | 'error';
  items: T[];
  nextCursor: string | null;
  /** failure of the first page (replaces the list) */
  failure: ApiFailure | null;
  /** failure of a "load more" request (keeps the items already shown) */
  moreFailure: ApiFailure | null;
  loadingMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * Keyset pagination for a query `key` (the query string). Changing the key resets the list and
 * aborts every request of the previous key; responses for an outdated key or generation are
 * ignored, so an older search can never overwrite newer results or append to them.
 */
export function usePaged<T>(key: string, fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<ApiResult<Page<T>>>): PagedState<T> {
  const { handleAuthFailure } = useIdentity();
  const [state, setState] = useState<Omit<PagedState<T>, 'loadMore' | 'reload'>>({ status: 'loading', items: [], nextCursor: null, failure: null, moreFailure: null, loadingMore: false });
  const [generation, setGeneration] = useState(0);
  const current = useRef({ key, generation });
  const controllers = useRef<AbortController[]>([]);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  useEffect(() => {
    current.current = { key, generation };
    for (const c of controllers.current) c.abort();
    const controller = new AbortController();
    controllers.current = [controller];
    setState({ status: 'loading', items: [], nextCursor: null, failure: null, moreFailure: null, loadingMore: false });
    fetchRef.current(undefined, controller.signal).then(
      (r) => {
        if (controller.signal.aborted || current.current.key !== key || current.current.generation !== generation) return;
        if (r.ok) setState({ status: 'ok', items: r.data.items, nextCursor: r.data.nextCursor, failure: null, moreFailure: null, loadingMore: false });
        else {
          handleAuthFailure(r);
          setState({ status: 'error', items: [], nextCursor: null, failure: r, moreFailure: null, loadingMore: false });
        }
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [key, generation, handleAuthFailure]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const loadMore = useCallback(() => {
    const s = stateRef.current;
    if (s.loadingMore || !s.nextCursor) return;
    const cursor = s.nextCursor;
    const snapshot = current.current;
    const controller = new AbortController();
    controllers.current.push(controller);
    setState((p) => ({ ...p, loadingMore: true, moreFailure: null }));
    stateRef.current = { ...s, loadingMore: true }; // block a second click before re-render
    fetchRef.current(cursor, controller.signal).then(
      (r) => {
        if (controller.signal.aborted || current.current !== snapshot) return;
        if (r.ok) setState((p) => ({ ...p, items: [...p.items, ...r.data.items], nextCursor: r.data.nextCursor, loadingMore: false, moreFailure: null }));
        else {
          handleAuthFailure(r);
          setState((p) => ({ ...p, loadingMore: false, moreFailure: r }));
        }
      },
      () => undefined,
    );
  }, [handleAuthFailure]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  return { ...state, loadMore, reload };
}
