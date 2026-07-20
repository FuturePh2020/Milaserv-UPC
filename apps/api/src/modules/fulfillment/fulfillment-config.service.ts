import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import type { RankingPenalties, RankingWeights } from './branch-ranking-scorer';

export interface FulfillmentConfig {
  weights: RankingWeights;
  penalties: RankingPenalties;
  maxRelevantDistanceKm: number;
  completeCoverageBonus: number;
  maxSplitBranches: number;
}

/**
 * Phase 6 §19/§21 — resolves every ranking weight/threshold from
 * Settings (ADR-008), mirroring MatchConfigService's exact pattern.
 * Nothing here is hard-coded.
 */
@Injectable()
export class FulfillmentConfigService {
  constructor(private readonly settings: SettingsService) {}

  async resolve(): Promise<FulfillmentConfig> {
    const num = (key: string) => this.settings.resolve(key).then(Number);
    const [
      locationWeight,
      inventoryWeight,
      operationalWeight,
      businessWeight,
      staleInventoryPenalty,
      unknownInventoryPenalty,
      splitPenaltyPerExtraBranch,
      maxRelevantDistanceKm,
      completeCoverageBonus,
      maxSplitBranches,
    ] = await Promise.all([
      num('fulfillment.ranking.location_weight'),
      num('fulfillment.ranking.inventory_weight'),
      num('fulfillment.ranking.operational_weight'),
      num('fulfillment.ranking.business_weight'),
      num('fulfillment.ranking.stale_inventory_penalty'),
      num('fulfillment.ranking.unknown_inventory_penalty'),
      num('fulfillment.ranking.split_penalty_per_extra_branch'),
      num('fulfillment.ranking.max_relevant_distance_km'),
      num('fulfillment.ranking.complete_coverage_bonus'),
      num('fulfillment.ranking.max_split_branches'),
    ]);

    return {
      weights: {
        location: locationWeight,
        inventory: inventoryWeight,
        operational: operationalWeight,
        business: businessWeight,
      },
      penalties: {
        staleInventory: staleInventoryPenalty,
        unknownInventory: unknownInventoryPenalty,
        splitPerExtraBranch: splitPenaltyPerExtraBranch,
      },
      maxRelevantDistanceKm,
      completeCoverageBonus,
      maxSplitBranches,
    };
  }
}
