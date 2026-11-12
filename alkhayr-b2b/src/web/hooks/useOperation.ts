import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiFailure, ApiResult } from '../api/client.ts';
import { classifyFailure } from '../checkout/submission.ts';
import { useIdentity } from '../session/identity.tsx';
import { trackUnresolved } from '../admin/unresolved.ts';

/**
 * One idempotent administrator operation (inventory adjustment or order transition) whose payload
 * carries its own operation key. Kept IN MEMORY only (never browser storage).
 *
 * - sending:  request in flight (buttons disabled — a convenience, not the guarantee).
 * - unknown:  no answer / 5xx / malformed answer. The operation MAY have been applied. The same key
 *             and exact payload are kept for an explicit retry; the form is locked meanwhile.
 * - reauth:   428 — nothing was executed. The operator re-authenticates; the form values stay as an
 *             unsent draft and a NEW confirmation (with a new key) is required. Nothing auto-runs.
 * - rejected: a definite refusal (409/422/400/403/429…) — nothing was applied; the key is released.
 * - done:     result returned (possibly a replay of the original operation).
 * While sending/unknown, leaving or reloading the page asks for confirmation (beforeunload).
 */
export type OperationState<P, R> =
  | { status: 'idle' }
  | { status: 'sending'; payload: P }
  | { status: 'unknown'; payload: P; failure: ApiFailure }
  | { status: 'reauth'; failure: ApiFailure }
  | { status: 'rejected'; failure: ApiFailure }
  | { status: 'done'; result: R; payload: P };

export function useOperation<P, R>(send: (payload: P) => Promise<ApiResult<R>>) {
  const { handleAuthFailure } = useIdentity();
  const [state, setState] = useState<OperationState<P, R>>({ status: 'idle' });
  const inFlight = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;

  const unresolved = state.status === 'sending' || state.status === 'unknown';
  useEffect(() => {
    if (!unresolved) return;
    const release = trackUnresolved();
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      release();
      window.removeEventListener('beforeunload', warn);
    };
  }, [unresolved]);

  const run = useCallback(
    async (payload: P) => {
      if (inFlight.current) return; // repeated taps: at most one request at a time
      inFlight.current = true;
      setState({ status: 'sending', payload });
      const r = await sendRef.current(payload);
      inFlight.current = false;
      if (r.ok) {
        setState({ status: 'done', result: r.data, payload });
        return;
      }
      if (r.kind === 'reauth_required') {
        setState({ status: 'reauth', failure: r });
        return;
      }
      const outcome = classifyFailure(r);
      if (outcome === 'unknown') setState({ status: 'unknown', payload, failure: r });
      else {
        handleAuthFailure(r);
        setState({ status: 'rejected', failure: r });
      }
    },
    [handleAuthFailure],
  );

  /** Same key, exact same payload. Only available for an unknown outcome. */
  const retry = useCallback(() => {
    if (state.status === 'unknown') void run(state.payload);
  }, [state, run]);

  const reset = useCallback(() => setState({ status: 'idle' }), []);
  return { state, run, retry, reset, unresolved };
}
