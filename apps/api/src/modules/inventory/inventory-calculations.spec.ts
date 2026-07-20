import { classifyFreshness, classifyInventoryStatus, computeAvailableQuantity } from './inventory-calculations';

describe('computeAvailableQuantity', () => {
  it('subtracts reserved, blocked, and damaged from on-hand', () => {
    expect(computeAvailableQuantity(100, 10, 5, 2)).toBe(83);
  });

  it('treats missing reserved/blocked/damaged as zero', () => {
    expect(computeAvailableQuantity(50, null, null, null)).toBe(50);
  });

  it('never goes negative when deductions exceed on-hand', () => {
    expect(computeAvailableQuantity(10, 8, 5, 0)).toBe(0);
  });

  it('propagates null on-hand as null rather than guessing zero', () => {
    expect(computeAvailableQuantity(null, 0, 0, 0)).toBeNull();
  });
});

describe('classifyInventoryStatus', () => {
  it('is DISCONTINUED regardless of quantity when the drug is discontinued', () => {
    expect(classifyInventoryStatus(100, 10, true)).toBe('DISCONTINUED');
  });

  it('is UNKNOWN when availableQuantity is null', () => {
    expect(classifyInventoryStatus(null, 10, false)).toBe('UNKNOWN');
  });

  it('is OUT_OF_STOCK at zero available', () => {
    expect(classifyInventoryStatus(0, 10, false)).toBe('OUT_OF_STOCK');
  });

  it('is LOW_STOCK at or below the safety-stock threshold', () => {
    expect(classifyInventoryStatus(10, 10, false)).toBe('LOW_STOCK');
    expect(classifyInventoryStatus(5, 10, false)).toBe('LOW_STOCK');
  });

  it('is IN_STOCK above the safety-stock threshold', () => {
    expect(classifyInventoryStatus(50, 10, false)).toBe('IN_STOCK');
  });

  it('is IN_STOCK when there is no safety-stock threshold configured', () => {
    expect(classifyInventoryStatus(1, null, false)).toBe('IN_STOCK');
  });
});

describe('classifyFreshness', () => {
  const now = new Date('2026-07-20T12:00:00Z');

  it('is UNKNOWN when there is no source timestamp', () => {
    expect(classifyFreshness(null, now, 10, 60)).toBe('UNKNOWN');
  });

  it('is UNKNOWN for a future-dated timestamp rather than trusted', () => {
    const future = new Date('2026-07-20T12:05:00Z');
    expect(classifyFreshness(future, now, 10, 60)).toBe('UNKNOWN');
  });

  it('is FRESH within the fresh threshold', () => {
    const t = new Date('2026-07-20T11:55:00Z'); // 5 min ago
    expect(classifyFreshness(t, now, 10, 60)).toBe('FRESH');
  });

  it('is ACCEPTABLE between the fresh and acceptable thresholds', () => {
    const t = new Date('2026-07-20T11:30:00Z'); // 30 min ago
    expect(classifyFreshness(t, now, 10, 60)).toBe('ACCEPTABLE');
  });

  it('is STALE beyond the acceptable threshold', () => {
    const t = new Date('2026-07-20T10:00:00Z'); // 120 min ago
    expect(classifyFreshness(t, now, 10, 60)).toBe('STALE');
  });

  it('never returns LIVE — that is set by the caller, not derived here', () => {
    const t = now;
    expect(classifyFreshness(t, now, 10, 60)).not.toBe('LIVE');
  });
});
