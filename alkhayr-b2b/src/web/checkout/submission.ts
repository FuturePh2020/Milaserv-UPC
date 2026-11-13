import type { ApiFailure } from '../api/client.ts';
import type { CreateOrderPayload, OrderTerms } from '../api/endpoints.ts';
import { newRequestKey, pageRecoveryEpoch } from '../api/client.ts';
import { payloadLines, type Cart } from '../cart/model.ts';
import type { PendingSubmission } from '../cart/storage.ts';

/**
 * Order submission rules (stage 11):
 * - One request key per intended submission. The exact payload sent with it is stored with it.
 * - A retry of an unresolved submission re-sends THE SAME key and THE SAME payload.
 * - A changed cart (accepted new prices, edited quantities, other note) is a NEW payload with a
 *   NEW key, and is only allowed once the previous submission's outcome is resolved.
 * - Nothing is retried automatically.
 */

export function newSubmission(cart: Cart, note: string, terms: OrderTerms, now: number = Date.now(), epoch: number = pageRecoveryEpoch() ?? 0): PendingSubmission {
  const requestKey = newRequestKey();
  const trimmed = note.trim();
  // The reviewed shipping/tax terms travel with the payload: a retry re-sends them unchanged.
  const expectedTerms: OrderTerms = { shippingCents: terms.shippingCents, shippingTaxable: terms.shippingTaxable, taxBps: terms.taxBps };
  const payload: CreateOrderPayload = { requestKey, expectedTerms, items: payloadLines(cart), ...(trimmed ? { note: trimmed } : {}) };
  return { requestKey, payload, createdAt: now, epoch };
}

/**
 * What a failed POST /orders means for the pending submission:
 * - unknown: no answer or a server error — the order MAY exist. Keep key + payload; offer a
 *   same-request retry (the server replays an existing order instead of creating another).
 * - not_processed: the request was refused before processing (rate limit) — keep and retry later.
 * - rejected: a definite answer that nothing was created (validation, conflicts, stock,
 *   minimums, forbidden) — the pending submission is discarded.
 * - session: the session ended or needs renewal — keep it, so the same account can retry
 *   after signing in again.
 */
export type SubmissionOutcome = 'unknown' | 'not_processed' | 'rejected' | 'session';

export function classifyFailure(f: ApiFailure): SubmissionOutcome {
  // Stage 16: definite answers that nothing was processed now.
  if (f.code === 'WRITES_SUSPENDED') return 'not_processed'; // maintenance/recovery: keep, retry later
  if (f.code === 'RECOVERY_EPOCH_STALE') return 'rejected'; // prepared before a restore: review again, new key
  switch (f.kind) {
    case 'network':
    case 'server':
    case 'unavailable':
    case 'invalid_response':
      return 'unknown';
    case 'rate_limited':
      return 'not_processed';
    case 'unauthenticated':
    case 'reauth_required':
      return 'session';
    default:
      return 'rejected';
  }
}

/** Current product terms returned with PRICE_CHANGED / PACKAGING_CHANGED (validated). */
export function conflictTerms(f: ApiFailure): Array<{ productId: string; cartonPriceCents: number; packSize: number }> {
  const items = f.current?.items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (i): i is { productId: string; cartonPriceCents: number; packSize: number } =>
      typeof i === 'object' && i !== null && typeof (i as { productId?: unknown }).productId === 'string' && Number.isSafeInteger((i as { cartonPriceCents?: unknown }).cartonPriceCents) && Number.isSafeInteger((i as { packSize?: unknown }).packSize),
  );
}

/** Product ids the server reported in `current.items` (unavailable / insufficient stock / minimum). */
export function conflictProductIds(f: ApiFailure): string[] {
  const items = f.current?.items;
  if (!Array.isArray(items)) return [];
  return items.map((i) => (typeof i === 'object' && i !== null ? (i as { productId?: unknown }).productId : null)).filter((id): id is string => typeof id === 'string');
}
