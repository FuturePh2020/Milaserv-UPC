import { NETWORK_MUTATION_MESSAGE, type ApiFailure, type ApiResult } from '../api/client.ts';
import { classifyFailure } from '../checkout/submission.ts';
import { setUnresolvedCount } from './unresolved.ts';

/**
 * Account-scoped, IN-MEMORY coordinator for administrator operations whose outcome matters
 * (inventory adjustments, order transitions, import confirmations). It lives in the administrator
 * shell, which React remounts for every identity, so a different account (or a confirmed sign-out)
 * never sees another account's operations. It survives navigation between administration screens,
 * NOT a page refresh, closing the tab or a session that expires (the shell unmounts) — those
 * limits are explained to the operator; nothing is written to browser storage.
 *
 * Per slot (e.g. "inventory:<productId>"): at most one operation. While it is sending or its
 * outcome is unknown, a new run in that slot is refused (no silent replacement); only a same-key,
 * same-payload retry or an explicit discard is possible.
 */
export type OperationStatus = 'sending' | 'unknown' | 'reauth' | 'rejected' | 'done';

export interface OperationEntry {
  slot: string;
  /** What the operator intended, in Arabic (shown in the global notice). */
  label: string;
  /** Internal route of the screen that owns the operation. */
  href: string;
  /** The exact payload (with its operation key) — reused verbatim by a retry. */
  payload: unknown;
  status: OperationStatus;
  failure: ApiFailure | null;
  result: unknown;
  /** The owning screen has handled the result (toast, reload); avoids repeating it on remount. */
  handled: boolean;
  startedAt: number;
}

type Sender = (payload: unknown) => Promise<ApiResult<unknown>>;

export class OperationCoordinator {
  #entries = new Map<string, OperationEntry>();
  #listeners = new Set<() => void>();
  #version = 0;
  #onAuthFailure: (f: ApiFailure) => void;
  constructor(onAuthFailure: (f: ApiFailure) => void = () => undefined) {
    this.#onAuthFailure = onAuthFailure;
  }

  subscribe = (fn: () => void) => {
    this.#listeners.add(fn);
    return () => void this.#listeners.delete(fn);
  };
  version = () => this.#version;
  get(slot: string): OperationEntry | undefined {
    return this.#entries.get(slot);
  }
  unresolved(): OperationEntry[] {
    return [...this.#entries.values()].filter((e) => e.status === 'sending' || e.status === 'unknown');
  }
  #set(slot: string, entry: OperationEntry | undefined) {
    if (entry) this.#entries.set(slot, entry);
    else this.#entries.delete(slot);
    this.#version += 1;
    setUnresolvedCount(this.unresolved().length);
    for (const l of this.#listeners) l();
  }

  /** Starts a NEW operation. Refused (returns false) while the slot is sending or unknown. */
  run(slot: string, meta: { label: string; href: string }, payload: unknown, send: Sender): boolean {
    const current = this.#entries.get(slot);
    if (current && (current.status === 'sending' || current.status === 'unknown')) return false;
    void this.#send({ slot, ...meta, payload, status: 'sending', failure: null, result: null, handled: false, startedAt: Date.now() }, send);
    return true;
  }

  /** Same key, exact same payload. Only for an unknown outcome. */
  retry(slot: string, send: Sender): boolean {
    const current = this.#entries.get(slot);
    if (!current || current.status !== 'unknown') return false;
    void this.#send({ ...current, status: 'sending', failure: null }, send);
    return true;
  }

  async #send(entry: OperationEntry, send: Sender) {
    this.#set(entry.slot, entry);
    let r: ApiResult<unknown>;
    try {
      r = await send(entry.payload);
    } catch {
      r = { ok: false, kind: 'network', code: null, status: 0, message: NETWORK_MUTATION_MESSAGE, requestId: null, fields: [], retryAfterSeconds: null, current: null };
    }
    if (this.#entries.get(entry.slot) !== entry) return; // discarded (or cleared) meanwhile: never resurrect it
    if (r.ok) return this.#set(entry.slot, { ...entry, status: 'done', result: r.data, failure: null, handled: false });
    if (r.kind === 'reauth_required') return this.#set(entry.slot, { ...entry, status: 'reauth', failure: r });
    if (classifyFailure(r) === 'unknown') return this.#set(entry.slot, { ...entry, status: 'unknown', failure: r });
    this.#onAuthFailure(r);
    this.#set(entry.slot, { ...entry, status: 'rejected', failure: r, handled: false });
  }

  /** Explicit discard (after the operator checked the history) or reset of a finished entry. */
  discard(slot: string) {
    if (this.#entries.has(slot)) this.#set(slot, undefined);
  }
  markHandled(slot: string) {
    const e = this.#entries.get(slot);
    if (e && !e.handled) {
      this.#entries.set(slot, { ...e, handled: true });
      this.#version += 1;
      for (const l of this.#listeners) l();
    }
  }
  clear() {
    this.#entries.clear();
    this.#version += 1;
    setUnresolvedCount(0);
    for (const l of this.#listeners) l();
  }
}

