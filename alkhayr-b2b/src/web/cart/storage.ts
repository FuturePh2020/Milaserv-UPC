import type { CreateOrderPayload } from '../api/endpoints.ts';
import { EMPTY_CART, MAX_CARTONS, MAX_LINES, type Cart, type CartLine } from './model.ts';

/**
 * THE ONLY MODULE THAT USES BROWSER STORAGE (enforced by tests).
 *
 * What is stored (localStorage, key `alkhayr.v1.draft.<userId>.<merchantId>`):
 *   - the cart draft: product ids, names/brands for display, reviewed carton price and pack size,
 *     minimum and carton quantity;
 *   - at most one pending order submission: its request key and the exact payload sent.
 * Never stored: session/CSRF tokens, passwords, TOTP codes, buyer profile, prices of record or
 * whole API responses. Scope: one verified user + merchant; drafts of other accounts are deleted
 * when a different identity signs in on this browser. Retention: 7 days from the last change,
 * cleared on explicit logout and on successful submission. Everything read back is validated as
 * untrusted input; malformed values are dropped. If storage is unavailable (private mode, quota,
 * disabled), the cart works in memory for the current page only.
 */

const PREFIX = 'alkhayr.v1.draft.';
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface DraftScope {
  userId: string;
  merchantId: string;
}

export interface PendingSubmission {
  requestKey: string;
  payload: CreateOrderPayload;
  createdAt: number;
}

export interface Draft {
  cart: Cart;
  pending: PendingSubmission | null;
}

/** The subset of the Web Storage API used here (typed locally so tests can run without the DOM lib). */
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): StorageLike | null {
  try {
    const s = (globalThis as unknown as { window?: { localStorage?: StorageLike } }).window?.localStorage;
    if (!s) return null;
    const probe = `${PREFIX}probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function draftKey(scope: DraftScope): string {
  if (!UUID.test(scope.userId) || !UUID.test(scope.merchantId)) throw new Error('invalid draft scope');
  return `${PREFIX}${scope.userId}.${scope.merchantId}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

export function parseLine(v: unknown): CartLine | null {
  if (!isObj(v)) return null;
  if (!str(v.productId, 36) || !UUID.test(v.productId) || !str(v.name, 400) || typeof v.brand !== 'string' || v.brand.length > 400 || !str(v.categoryId, 40)) return null;
  if (!int(v.cartonPriceCents, 1, 100_000_000) || !int(v.packSize, 1, 10_000) || !int(v.minimumCartons, 1, MAX_CARTONS) || !int(v.cartons, 1, MAX_CARTONS)) return null;
  return { productId: v.productId, name: v.name, brand: v.brand, categoryId: v.categoryId, cartonPriceCents: v.cartonPriceCents, packSize: v.packSize, minimumCartons: v.minimumCartons, cartons: v.cartons };
}

export function parsePending(v: unknown): PendingSubmission | null {
  if (!isObj(v) || !str(v.requestKey, 36) || !UUID.test(v.requestKey) || !int(v.createdAt, 1, Number.MAX_SAFE_INTEGER) || !isObj(v.payload)) return null;
  const p = v.payload;
  if (p.requestKey !== v.requestKey || !Array.isArray(p.items) || p.items.length < 1 || p.items.length > MAX_LINES) return null;
  if (p.note !== undefined && (typeof p.note !== 'string' || p.note.length > 500)) return null;
  const items = p.items.map((i) =>
    isObj(i) && str(i.productId, 36) && UUID.test(i.productId) && int(i.cartons, 1, MAX_CARTONS) && int(i.expectedCartonPriceCents, 1, 100_000_000) && int(i.expectedPackSize, 1, 10_000)
      ? { productId: i.productId, cartons: i.cartons, expectedCartonPriceCents: i.expectedCartonPriceCents, expectedPackSize: i.expectedPackSize }
      : null,
  );
  if (items.some((i) => i === null)) return null;
  const payload: CreateOrderPayload = { requestKey: v.requestKey, items: items as CreateOrderPayload['items'], ...(typeof p.note === 'string' ? { note: p.note } : {}) };
  return { requestKey: v.requestKey, createdAt: v.createdAt, payload };
}

/** Reads and validates the draft of exactly this account; expired or malformed data is discarded. */
export function loadDraft(scope: DraftScope, now: number = Date.now()): Draft {
  const s = storage();
  const empty: Draft = { cart: EMPTY_CART, pending: null };
  if (!s) return empty;
  const key = draftKey(scope);
  let raw: unknown;
  try {
    raw = JSON.parse(s.getItem(key) ?? 'null');
  } catch {
    s.removeItem(key);
    return empty;
  }
  if (!isObj(raw) || raw.v !== 1 || !int(raw.savedAt, 1, Number.MAX_SAFE_INTEGER) || now - raw.savedAt > DRAFT_TTL_MS) {
    s.removeItem(key);
    return empty;
  }
  const seen = new Set<string>();
  const lines = (Array.isArray(raw.lines) ? raw.lines : [])
    .map(parseLine)
    .filter((l): l is CartLine => l !== null && !seen.has(l.productId) && Boolean(seen.add(l.productId)))
    .slice(0, MAX_LINES);
  return { cart: { lines }, pending: parsePending(raw.pending) };
}

export function saveDraft(scope: DraftScope, draft: Draft, now: number = Date.now()): void {
  const s = storage();
  if (!s) return;
  const key = draftKey(scope);
  try {
    if (draft.cart.lines.length === 0 && !draft.pending) s.removeItem(key);
    else s.setItem(key, JSON.stringify({ v: 1, savedAt: now, lines: draft.cart.lines, pending: draft.pending }));
  } catch {
    // Quota exceeded or storage disabled: keep working in memory.
  }
}

/** Removes every ALKHAYR draft on this browser (explicit logout). */
export function clearAllDrafts(): void {
  const s = storage();
  if (!s) return;
  for (const key of Object.keys(s)) if (key.startsWith(PREFIX)) s.removeItem(key);
}

/** Account switching: drafts of any other identity are deleted, never restored into this session. */
export function purgeOtherDrafts(scope: DraftScope): void {
  const s = storage();
  if (!s) return;
  const keep = draftKey(scope);
  for (const key of Object.keys(s)) if (key.startsWith(PREFIX) && key !== keep) s.removeItem(key);
}
