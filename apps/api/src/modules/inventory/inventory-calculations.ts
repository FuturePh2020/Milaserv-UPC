export type FreshnessStatus = 'LIVE' | 'FRESH' | 'ACCEPTABLE' | 'STALE' | 'UNKNOWN';
export type InventoryStatusValue =
  | 'IN_STOCK'
  | 'LOW_STOCK'
  | 'OUT_OF_STOCK'
  | 'BLOCKED'
  | 'UNKNOWN'
  | 'STALE'
  | 'IN_TRANSIT'
  | 'DISCONTINUED';

/**
 * Phase 6 §11 — "use availableQuantity, never onHandQuantity alone."
 * Blocked, damaged, and reserved stock are never counted as available;
 * a null onHandQuantity means "unknown," not zero, so it propagates as
 * null rather than being coerced into a possibly-wrong number.
 */
export function computeAvailableQuantity(
  onHandQuantity: number | null,
  reservedQuantity: number | null,
  blockedQuantity: number | null,
  damagedQuantity: number | null,
): number | null {
  if (onHandQuantity == null) return null;
  const reserved = reservedQuantity ?? 0;
  const blocked = blockedQuantity ?? 0;
  const damaged = damagedQuantity ?? 0;
  return Math.max(0, onHandQuantity - reserved - blocked - damaged);
}

/**
 * Fallback classifier used only when the source system doesn't supply
 * an explicit status of its own (BLOCKED/IN_TRANSIT are provider-
 * reported states this function can't infer from quantities alone —
 * the sync service always prefers a provider-supplied status over this
 * derivation).
 */
export function classifyInventoryStatus(
  availableQuantity: number | null,
  safetyStockQuantity: number | null,
  discontinued: boolean,
): InventoryStatusValue {
  if (discontinued) return 'DISCONTINUED';
  if (availableQuantity == null) return 'UNKNOWN';
  if (availableQuantity <= 0) return 'OUT_OF_STOCK';
  if (safetyStockQuantity != null && availableQuantity <= safetyStockQuantity) return 'LOW_STOCK';
  return 'IN_STOCK';
}

/**
 * Phase 6 §14 — freshness bands. LIVE is never derived here — the
 * caller sets it directly when a snapshot was just verified during the
 * current request, since "live" is about the verification event, not
 * the timestamp's age. A future-dated timestamp is treated as UNKNOWN
 * rather than trusted (never fabricate confidence in a snapshot whose
 * own clock doesn't check out).
 */
export function classifyFreshness(
  sourceTimestamp: Date | null,
  now: Date,
  freshThresholdMinutes: number,
  acceptableThresholdMinutes: number,
): FreshnessStatus {
  if (!sourceTimestamp) return 'UNKNOWN';
  const ageMinutes = (now.getTime() - sourceTimestamp.getTime()) / 60_000;
  if (ageMinutes < 0) return 'UNKNOWN';
  if (ageMinutes <= freshThresholdMinutes) return 'FRESH';
  if (ageMinutes <= acceptableThresholdMinutes) return 'ACCEPTABLE';
  return 'STALE';
}
