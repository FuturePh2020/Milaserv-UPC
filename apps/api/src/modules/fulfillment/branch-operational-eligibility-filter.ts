import type { FulfillmentExclusionCode } from './fulfillment-exclusion-codes';

export interface OperationalEligibilityInput {
  active: boolean;
  temporarilyClosed: boolean;
  prescriptionFulfillmentEnabled: boolean | null;
  isOpenNow: boolean;
  maximumDailyOrders: number | null;
  currentDailyOrderCount: number;
  requiredCapabilityCodes: string[];
  branchCapabilityCodes: string[];
  coldChainRequired: boolean;
  controlledDrugRequired: boolean;
  specialHandlingRequired: boolean;
  requestedMode: 'DELIVERY' | 'PICKUP' | 'EITHER' | 'INTERNAL_TRANSFER' | 'UNKNOWN';
  serviceAreaDeliveryEnabled: boolean;
  serviceAreaPickupEnabled: boolean;
}

export interface OperationalEligibilityResult {
  eligible: boolean;
  exclusionCodes: FulfillmentExclusionCode[];
}

/**
 * Phase 6 §6/§10/§18 Stage 3 — hard exclusions only (definitely closed,
 * inactive, missing a required capability, over capacity). "Closing
 * soon" is deliberately NOT checked here — that's a soft ranking risk
 * penalty for Stage 5 (Step 5), not a Stage 3 exclusion, resolving the
 * spec's own tension between listing "branch open now" as a ranking
 * signal and CLOSED_AT_REQUESTED_TIME as an exclusion code (Step 1
 * proposal §8 decision).
 */
export function checkOperationalEligibility(input: OperationalEligibilityInput): OperationalEligibilityResult {
  const codes: FulfillmentExclusionCode[] = [];

  if (!input.active) codes.push('BRANCH_INACTIVE');
  if (input.temporarilyClosed) codes.push('TEMPORARILY_CLOSED');
  if (input.prescriptionFulfillmentEnabled !== true) codes.push('PRESCRIPTION_FULFILLMENT_NOT_ENABLED');
  if (!input.isOpenNow) codes.push('CLOSED_AT_REQUESTED_TIME');
  if (input.maximumDailyOrders != null && input.currentDailyOrderCount >= input.maximumDailyOrders) {
    codes.push('CAPACITY_EXCEEDED');
  }

  if (input.requestedMode === 'DELIVERY' && !input.serviceAreaDeliveryEnabled) codes.push('DELIVERY_NOT_ENABLED');
  if (input.requestedMode === 'PICKUP' && !input.serviceAreaPickupEnabled) codes.push('PICKUP_NOT_ENABLED');
  if (
    input.requestedMode === 'EITHER' &&
    !input.serviceAreaDeliveryEnabled &&
    !input.serviceAreaPickupEnabled
  ) {
    codes.push('DELIVERY_NOT_ENABLED', 'PICKUP_NOT_ENABLED');
  }

  if (input.coldChainRequired && !input.branchCapabilityCodes.includes('COLD_CHAIN')) {
    codes.push('COLD_CHAIN_UNSUPPORTED');
  }
  if (input.controlledDrugRequired && !input.branchCapabilityCodes.includes('CONTROLLED_MEDICINE')) {
    codes.push('CONTROLLED_DRUG_UNSUPPORTED');
  }
  if (input.specialHandlingRequired && !input.branchCapabilityCodes.includes('SPECIAL_MEDICINE')) {
    codes.push('SPECIAL_ITEM_UNSUPPORTED');
  }
  const missingCapabilities = input.requiredCapabilityCodes.filter(
    (code) => !input.branchCapabilityCodes.includes(code),
  );
  if (missingCapabilities.length > 0) codes.push('REQUIRED_CAPABILITY_MISSING');

  return { eligible: codes.length === 0, exclusionCodes: codes };
}
