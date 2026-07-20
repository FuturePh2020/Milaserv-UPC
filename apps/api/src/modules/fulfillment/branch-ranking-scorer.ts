import type { FreshnessStatus } from '../inventory/inventory-calculations';

export interface RankingWeights {
  location: number;
  inventory: number;
  operational: number;
  business: number;
}

export interface RankingPenalties {
  staleInventory: number;
  unknownInventory: number;
  splitPerExtraBranch: number;
}

export interface BranchScoreInput {
  distanceKm: number;
  /** km at which the location score decays to 0 — Settings-driven. */
  maxRelevantDistanceKm: number;
  coverageRatio: number;
  worstFreshness: FreshnessStatus;
}

export interface BranchScoreBreakdown {
  locationScore: number;
  inventoryScore: number;
  operationalScore: number;
  businessScore: number;
  riskPenalty: number;
  totalScore: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Phase 6 §21 — per-branch weighted score. Nearest is never
 * automatically best (§22): inventory carries the largest default
 * weight so a farther, complete, fresh branch outranks a closer,
 * incomplete, stale one, matching the brief's own worked example.
 * operationalScore stays a flat 100 here — every candidate already
 * passed Stage 3's hard operational-eligibility gate, and no live
 * order-count/preparation-load signal is tracked yet (documented
 * simplification, not a fabricated value). businessScore is neutral
 * (50, "no evidence either way") since no business-priority signal
 * exists in this platform yet — never fabricated as confidently good
 * or bad, mirroring Phase 5's own "neutral when unset" rule.
 */
export function scoreBranch(
  input: BranchScoreInput,
  weights: RankingWeights,
  penalties: RankingPenalties,
): BranchScoreBreakdown {
  const locationScore = clamp(
    100 - (input.distanceKm / Math.max(input.maxRelevantDistanceKm, 0.001)) * 100,
    0,
    100,
  );
  const inventoryScore = clamp(input.coverageRatio * 100, 0, 100);
  const operationalScore = 100;
  const businessScore = 50;

  let riskPenalty = 0;
  if (input.worstFreshness === 'STALE') riskPenalty += penalties.staleInventory;
  if (input.worstFreshness === 'UNKNOWN') riskPenalty += penalties.unknownInventory;

  const weightedSubtotal =
    locationScore * weights.location +
    inventoryScore * weights.inventory +
    operationalScore * weights.operational +
    businessScore * weights.business;

  const totalScore = clamp(weightedSubtotal - riskPenalty, 0, 100);

  return { locationScore, inventoryScore, operationalScore, businessScore, riskPenalty, totalScore };
}

/**
 * Phase 6 §19/§21 — plan-level score: average of its branches' scores,
 * a bonus for complete single-request coverage, and a penalty per
 * extra branch beyond the first (never hard-coded — both configurable,
 * §19 "must be configurable, not hard-coded").
 */
export function scorePlan(
  branchScores: number[],
  completeCoverage: boolean,
  completeCoverageBonus: number,
  splitPenaltyPerExtraBranch: number,
): number {
  if (branchScores.length === 0) return 0;
  const average = branchScores.reduce((sum, s) => sum + s, 0) / branchScores.length;
  const bonus = completeCoverage ? completeCoverageBonus : 0;
  const splitPenalty = Math.max(0, branchScores.length - 1) * splitPenaltyPerExtraBranch;
  return clamp(average + bonus - splitPenalty, 0, 100);
}
