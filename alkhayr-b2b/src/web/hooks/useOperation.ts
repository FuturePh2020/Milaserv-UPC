import { useCallback, useRef } from 'react';
import type { ApiFailure, ApiResult } from '../api/client.ts';
import { useOperations } from '../admin/operations.tsx';

/**
 * One idempotent administrator operation whose payload carries its own operation key, held by the
 * shell's account-scoped coordinator (admin/coordinator.ts) under `slot`, so it survives navigation
 * between administration screens. In memory only (never browser storage).
 *
 * - sending:  request in flight; a second run in the slot is refused.
 * - unknown:  no answer / 5xx / malformed answer. It MAY have been applied. The same key and exact
 *             payload are kept; the form is locked; only a same-key retry or an explicit discard.
 * - reauth:   428 — nothing was executed; the draft stays unsent and needs a NEW confirmation.
 * - rejected: a definite refusal — nothing applied; the key is released.
 * - done:     result returned (possibly a replay of the original operation).
 */
export type OperationState<P, R> =
  | { status: 'idle' }
  | { status: 'sending'; payload: P }
  | { status: 'unknown'; payload: P; failure: ApiFailure }
  | { status: 'reauth'; failure: ApiFailure; payload: P }
  | { status: 'rejected'; failure: ApiFailure; handled: boolean }
  | { status: 'done'; result: R; payload: P; handled: boolean };

export function useOperation<P, R>(slot: string, meta: { label: string; href: string }, send: (payload: P) => Promise<ApiResult<R>>) {
  const c = useOperations();
  const sendRef = useRef(send);
  sendRef.current = send; // a retry after re-authentication uses the CURRENT session/CSRF token
  const e = c.get(slot);
  const state: OperationState<P, R> = !e
    ? { status: 'idle' }
    : e.status === 'sending'
      ? { status: 'sending', payload: e.payload as P }
      : e.status === 'unknown'
        ? { status: 'unknown', payload: e.payload as P, failure: e.failure! }
        : e.status === 'reauth'
          ? { status: 'reauth', failure: e.failure!, payload: e.payload as P }
          : e.status === 'rejected'
            ? { status: 'rejected', failure: e.failure!, handled: e.handled }
            : { status: 'done', result: e.result as R, payload: e.payload as P, handled: e.handled };
  const sender = (p: unknown) => sendRef.current(p as P) as Promise<ApiResult<unknown>>;
  /** `label` describes this specific intention (shown in the global unresolved-operation notice). */
  const run = useCallback((payload: P, label: string = meta.label) => c.run(slot, { label, href: meta.href }, payload, sender), [c, slot, meta.label, meta.href]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = useCallback(() => c.retry(slot, sender), [c, slot]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = useCallback(() => c.discard(slot), [c, slot]);
  const markHandled = useCallback(() => c.markHandled(slot), [c, slot]);
  return { state, label: e?.label ?? null, run, retry, reset, markHandled, unresolved: state.status === 'sending' || state.status === 'unknown' };
}
