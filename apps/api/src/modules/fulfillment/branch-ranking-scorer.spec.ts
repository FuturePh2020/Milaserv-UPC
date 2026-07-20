import { scoreBranch, scorePlan } from './branch-ranking-scorer';
import type { RankingPenalties, RankingWeights } from './branch-ranking-scorer';

const WEIGHTS: RankingWeights = { location: 0.3, inventory: 0.4, operational: 0.15, business: 0.15 };
const PENALTIES: RankingPenalties = { staleInventory: 15, unknownInventory: 10, splitPerExtraBranch: 8 };

describe('scoreBranch', () => {
  it('scores a closer branch higher than a farther one when all else is equal', () => {
    const near = scoreBranch(
      { distanceKm: 1, maxRelevantDistanceKm: 20, coverageRatio: 1, worstFreshness: 'LIVE' },
      WEIGHTS,
      PENALTIES,
    );
    const far = scoreBranch(
      { distanceKm: 15, maxRelevantDistanceKm: 20, coverageRatio: 1, worstFreshness: 'LIVE' },
      WEIGHTS,
      PENALTIES,
    );
    expect(near.totalScore).toBeGreaterThan(far.totalScore);
  });

  it("nearest is not always best — the spec's own worked example", () => {
    // Branch A: 1.2 km, missing one medicine (partial coverage), stale snapshot.
    const branchA = scoreBranch(
      { distanceKm: 1.2, maxRelevantDistanceKm: 20, coverageRatio: 0.5, worstFreshness: 'STALE' },
      WEIGHTS,
      PENALTIES,
    );
    // Branch B: 3.8 km, complete prescription, live-verified stock.
    const branchB = scoreBranch(
      { distanceKm: 3.8, maxRelevantDistanceKm: 20, coverageRatio: 1, worstFreshness: 'LIVE' },
      WEIGHTS,
      PENALTIES,
    );
    expect(branchB.totalScore).toBeGreaterThan(branchA.totalScore);
  });

  it('applies a risk penalty for stale inventory', () => {
    const fresh = scoreBranch(
      { distanceKm: 5, maxRelevantDistanceKm: 20, coverageRatio: 1, worstFreshness: 'FRESH' },
      WEIGHTS,
      PENALTIES,
    );
    const stale = scoreBranch(
      { distanceKm: 5, maxRelevantDistanceKm: 20, coverageRatio: 1, worstFreshness: 'STALE' },
      WEIGHTS,
      PENALTIES,
    );
    expect(stale.riskPenalty).toBe(PENALTIES.staleInventory);
    expect(stale.totalScore).toBeLessThan(fresh.totalScore);
  });

  it('applies a smaller/no penalty for LIVE or FRESH freshness', () => {
    const live = scoreBranch(
      { distanceKm: 5, maxRelevantDistanceKm: 20, coverageRatio: 1, worstFreshness: 'LIVE' },
      WEIGHTS,
      PENALTIES,
    );
    expect(live.riskPenalty).toBe(0);
  });

  it('never produces a score outside [0, 100]', () => {
    const extreme = scoreBranch(
      { distanceKm: 1000, maxRelevantDistanceKm: 20, coverageRatio: 0, worstFreshness: 'UNKNOWN' },
      WEIGHTS,
      PENALTIES,
    );
    expect(extreme.totalScore).toBeGreaterThanOrEqual(0);
    expect(extreme.totalScore).toBeLessThanOrEqual(100);
  });

  it('keeps businessScore neutral (50) — never fabricated as good or bad', () => {
    const result = scoreBranch(
      { distanceKm: 5, maxRelevantDistanceKm: 20, coverageRatio: 1, worstFreshness: 'FRESH' },
      WEIGHTS,
      PENALTIES,
    );
    expect(result.businessScore).toBe(50);
  });
});

describe('scorePlan', () => {
  it('averages branch scores (single-branch, so no split penalty applies)', () => {
    expect(scorePlan([70], false, 10, 8)).toBeCloseTo(70, 5);
  });

  it('averages branch scores minus the split penalty for a multi-branch plan', () => {
    // average(80, 60) = 70, minus one extra-branch penalty of 8.
    expect(scorePlan([80, 60], false, 10, 8)).toBeCloseTo(62, 5);
  });

  it('adds a bonus for complete coverage', () => {
    const withoutBonus = scorePlan([70], false, 10, 8);
    const withBonus = scorePlan([70], true, 10, 8);
    expect(withBonus).toBe(withoutBonus + 10);
  });

  it('penalizes each branch beyond the first — single-branch plans rank above equivalent split plans', () => {
    const single = scorePlan([90], true, 10, 8);
    const split = scorePlan([90, 90], true, 10, 8);
    expect(single).toBeGreaterThan(split);
  });

  it('is 0 for an empty branch list', () => {
    expect(scorePlan([], false, 10, 8)).toBe(0);
  });
});
