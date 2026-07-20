import { computeBranchCoverage } from './branch-inventory-coverage';
import type { BranchInventoryRowInput, RequiredItemInput } from './branch-inventory-coverage';

describe('computeBranchCoverage', () => {
  it('is AVAILABLE when availableQuantity meets or exceeds requiredQuantity', () => {
    const items: RequiredItemInput[] = [{ fulfillmentRequestItemId: 'i1', drugId: 'd1', requiredQuantity: 10 }];
    const rows: BranchInventoryRowInput[] = [{ drugId: 'd1', availableQuantity: 10, freshness: 'FRESH' }];
    const result = computeBranchCoverage(items, rows);
    expect(result.items[0]!.availabilityStatus).toBe('AVAILABLE');
    expect(result.items[0]!.allocatedQuantity).toBe(10);
    expect(result.completeCoverage).toBe(true);
  });

  it('is PARTIAL when some but not enough is available', () => {
    const items: RequiredItemInput[] = [{ fulfillmentRequestItemId: 'i1', drugId: 'd1', requiredQuantity: 10 }];
    const rows: BranchInventoryRowInput[] = [{ drugId: 'd1', availableQuantity: 4, freshness: 'FRESH' }];
    const result = computeBranchCoverage(items, rows);
    expect(result.items[0]!.availabilityStatus).toBe('PARTIAL');
    expect(result.items[0]!.allocatedQuantity).toBe(4);
    expect(result.completeCoverage).toBe(false);
  });

  it('is UNAVAILABLE at zero available stock', () => {
    const items: RequiredItemInput[] = [{ fulfillmentRequestItemId: 'i1', drugId: 'd1', requiredQuantity: 10 }];
    const rows: BranchInventoryRowInput[] = [{ drugId: 'd1', availableQuantity: 0, freshness: 'FRESH' }];
    const result = computeBranchCoverage(items, rows);
    expect(result.items[0]!.availabilityStatus).toBe('UNAVAILABLE');
    expect(result.items[0]!.allocatedQuantity).toBe(0);
  });

  it('is UNKNOWN when there is no inventory row at all for the drug — never assumed available or unavailable', () => {
    const items: RequiredItemInput[] = [{ fulfillmentRequestItemId: 'i1', drugId: 'd1', requiredQuantity: 10 }];
    const result = computeBranchCoverage(items, []);
    expect(result.items[0]!.availabilityStatus).toBe('UNKNOWN');
    expect(result.items[0]!.allocatedQuantity).toBeNull();
    expect(result.completeCoverage).toBe(false);
  });

  it('is UNKNOWN when the inventory row exists but availableQuantity itself is null', () => {
    const items: RequiredItemInput[] = [{ fulfillmentRequestItemId: 'i1', drugId: 'd1', requiredQuantity: 10 }];
    const rows: BranchInventoryRowInput[] = [{ drugId: 'd1', availableQuantity: null, freshness: 'UNKNOWN' }];
    const result = computeBranchCoverage(items, rows);
    expect(result.items[0]!.availabilityStatus).toBe('UNKNOWN');
  });

  it('checks by presence only when requiredQuantity is unresolved (null)', () => {
    const items: RequiredItemInput[] = [{ fulfillmentRequestItemId: 'i1', drugId: 'd1', requiredQuantity: null }];
    const present: BranchInventoryRowInput[] = [{ drugId: 'd1', availableQuantity: 3, freshness: 'FRESH' }];
    expect(computeBranchCoverage(items, present).items[0]!.availabilityStatus).toBe('AVAILABLE');
    const absent: BranchInventoryRowInput[] = [{ drugId: 'd1', availableQuantity: 0, freshness: 'FRESH' }];
    expect(computeBranchCoverage(items, absent).items[0]!.availabilityStatus).toBe('UNAVAILABLE');
  });

  it('completeCoverage requires every item to be AVAILABLE', () => {
    const items: RequiredItemInput[] = [
      { fulfillmentRequestItemId: 'i1', drugId: 'd1', requiredQuantity: 5 },
      { fulfillmentRequestItemId: 'i2', drugId: 'd2', requiredQuantity: 5 },
    ];
    const rows: BranchInventoryRowInput[] = [
      { drugId: 'd1', availableQuantity: 10, freshness: 'FRESH' },
      { drugId: 'd2', availableQuantity: 2, freshness: 'FRESH' },
    ];
    const result = computeBranchCoverage(items, rows);
    expect(result.completeCoverage).toBe(false);
    expect(result.coverageRatio).toBe(0.5);
  });

  it('reports the worst (most stale) freshness across all items', () => {
    const items: RequiredItemInput[] = [
      { fulfillmentRequestItemId: 'i1', drugId: 'd1', requiredQuantity: 1 },
      { fulfillmentRequestItemId: 'i2', drugId: 'd2', requiredQuantity: 1 },
    ];
    const rows: BranchInventoryRowInput[] = [
      { drugId: 'd1', availableQuantity: 10, freshness: 'FRESH' },
      { drugId: 'd2', availableQuantity: 10, freshness: 'STALE' },
    ];
    expect(computeBranchCoverage(items, rows).worstFreshness).toBe('STALE');
  });
});
