import type { FreshnessStatus } from '../inventory/inventory-calculations';

export interface RequiredItemInput {
  fulfillmentRequestItemId: string;
  drugId: string;
  requiredQuantity: number | null;
}

export interface BranchInventoryRowInput {
  drugId: string;
  availableQuantity: number | null;
  freshness: FreshnessStatus;
}

export type PlanItemAvailabilityStatus = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'UNKNOWN';

export interface ItemCoverage {
  fulfillmentRequestItemId: string;
  drugId: string;
  requiredQuantity: number | null;
  availableQuantity: number | null;
  allocatedQuantity: number | null;
  availabilityStatus: PlanItemAvailabilityStatus;
  freshnessStatus: FreshnessStatus;
}

export interface BranchCoverageResult {
  items: ItemCoverage[];
  completeCoverage: boolean;
  coverageRatio: number;
  worstFreshness: FreshnessStatus;
}

const FRESHNESS_SEVERITY: Record<FreshnessStatus, number> = {
  LIVE: 0,
  FRESH: 1,
  ACCEPTABLE: 2,
  STALE: 3,
  UNKNOWN: 4,
};

/**
 * Phase 6 §15/§20 Stage 4 — compares required quantity against
 * BranchInventory.availableQuantity (never onHand alone, already
 * enforced upstream at write time). A drug with no inventory row at
 * all for this branch is UNKNOWN, never assumed unavailable or
 * available. When requiredQuantity is unresolved (§15: "allow
 * availability checking by presence"), a positive availableQuantity is
 * treated as AVAILABLE without asserting a specific allocated amount.
 */
export function computeBranchCoverage(
  requiredItems: RequiredItemInput[],
  inventoryRows: BranchInventoryRowInput[],
): BranchCoverageResult {
  const rowByDrugId = new Map(inventoryRows.map((r) => [r.drugId, r]));
  const items: ItemCoverage[] = requiredItems.map((item) => {
    const row = rowByDrugId.get(item.drugId);
    if (!row || row.availableQuantity == null) {
      return {
        fulfillmentRequestItemId: item.fulfillmentRequestItemId,
        drugId: item.drugId,
        requiredQuantity: item.requiredQuantity,
        availableQuantity: row?.availableQuantity ?? null,
        allocatedQuantity: null,
        availabilityStatus: 'UNKNOWN',
        freshnessStatus: row?.freshness ?? 'UNKNOWN',
      };
    }

    if (item.requiredQuantity == null) {
      return {
        fulfillmentRequestItemId: item.fulfillmentRequestItemId,
        drugId: item.drugId,
        requiredQuantity: null,
        availableQuantity: row.availableQuantity,
        allocatedQuantity: null,
        availabilityStatus: row.availableQuantity > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
        freshnessStatus: row.freshness,
      };
    }

    if (row.availableQuantity >= item.requiredQuantity) {
      return {
        fulfillmentRequestItemId: item.fulfillmentRequestItemId,
        drugId: item.drugId,
        requiredQuantity: item.requiredQuantity,
        availableQuantity: row.availableQuantity,
        allocatedQuantity: item.requiredQuantity,
        availabilityStatus: 'AVAILABLE',
        freshnessStatus: row.freshness,
      };
    }
    if (row.availableQuantity > 0) {
      return {
        fulfillmentRequestItemId: item.fulfillmentRequestItemId,
        drugId: item.drugId,
        requiredQuantity: item.requiredQuantity,
        availableQuantity: row.availableQuantity,
        allocatedQuantity: row.availableQuantity,
        availabilityStatus: 'PARTIAL',
        freshnessStatus: row.freshness,
      };
    }
    return {
      fulfillmentRequestItemId: item.fulfillmentRequestItemId,
      drugId: item.drugId,
      requiredQuantity: item.requiredQuantity,
      availableQuantity: row.availableQuantity,
      allocatedQuantity: 0,
      availabilityStatus: 'UNAVAILABLE',
      freshnessStatus: row.freshness,
    };
  });

  const availableCount = items.filter((i) => i.availabilityStatus === 'AVAILABLE').length;
  const worstFreshness = items.reduce<FreshnessStatus>(
    (worst, i) => (FRESHNESS_SEVERITY[i.freshnessStatus] > FRESHNESS_SEVERITY[worst] ? i.freshnessStatus : worst),
    'LIVE',
  );

  return {
    items,
    completeCoverage: items.length > 0 && availableCount === items.length,
    coverageRatio: items.length === 0 ? 0 : availableCount / items.length,
    worstFreshness,
  };
}
