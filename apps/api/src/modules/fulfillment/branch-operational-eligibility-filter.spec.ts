import { checkOperationalEligibility } from './branch-operational-eligibility-filter';
import type { OperationalEligibilityInput } from './branch-operational-eligibility-filter';

function baseInput(overrides: Partial<OperationalEligibilityInput> = {}): OperationalEligibilityInput {
  return {
    active: true,
    temporarilyClosed: false,
    prescriptionFulfillmentEnabled: true,
    isOpenNow: true,
    maximumDailyOrders: null,
    currentDailyOrderCount: 0,
    requiredCapabilityCodes: [],
    branchCapabilityCodes: [],
    coldChainRequired: false,
    controlledDrugRequired: false,
    specialHandlingRequired: false,
    requestedMode: 'EITHER',
    serviceAreaDeliveryEnabled: true,
    serviceAreaPickupEnabled: true,
    ...overrides,
  };
}

describe('checkOperationalEligibility', () => {
  it('is eligible when every check passes', () => {
    const result = checkOperationalEligibility(baseInput());
    expect(result.eligible).toBe(true);
    expect(result.exclusionCodes).toEqual([]);
  });

  it('excludes an inactive branch', () => {
    const result = checkOperationalEligibility(baseInput({ active: false }));
    expect(result.eligible).toBe(false);
    expect(result.exclusionCodes).toContain('BRANCH_INACTIVE');
  });

  it('excludes a temporarily closed branch', () => {
    const result = checkOperationalEligibility(baseInput({ temporarilyClosed: true }));
    expect(result.exclusionCodes).toContain('TEMPORARILY_CLOSED');
  });

  it('excludes a branch without prescription-fulfillment enabled', () => {
    const result = checkOperationalEligibility(baseInput({ prescriptionFulfillmentEnabled: false }));
    expect(result.exclusionCodes).toContain('PRESCRIPTION_FULFILLMENT_NOT_ENABLED');
  });

  it('treats a null prescriptionFulfillmentEnabled the same as false — never assumed enabled', () => {
    const result = checkOperationalEligibility(baseInput({ prescriptionFulfillmentEnabled: null }));
    expect(result.exclusionCodes).toContain('PRESCRIPTION_FULFILLMENT_NOT_ENABLED');
  });

  it('excludes a closed-now branch with CLOSED_AT_REQUESTED_TIME, not as a ranking penalty', () => {
    const result = checkOperationalEligibility(baseInput({ isOpenNow: false }));
    expect(result.eligible).toBe(false);
    expect(result.exclusionCodes).toContain('CLOSED_AT_REQUESTED_TIME');
  });

  it('excludes when at or over daily capacity', () => {
    const atCapacity = checkOperationalEligibility(
      baseInput({ maximumDailyOrders: 10, currentDailyOrderCount: 10 }),
    );
    expect(atCapacity.exclusionCodes).toContain('CAPACITY_EXCEEDED');
    const underCapacity = checkOperationalEligibility(
      baseInput({ maximumDailyOrders: 10, currentDailyOrderCount: 9 }),
    );
    expect(underCapacity.exclusionCodes).not.toContain('CAPACITY_EXCEEDED');
  });

  it('excludes DELIVERY_NOT_ENABLED only when the requested mode is DELIVERY and it is off', () => {
    const result = checkOperationalEligibility(
      baseInput({ requestedMode: 'DELIVERY', serviceAreaDeliveryEnabled: false }),
    );
    expect(result.exclusionCodes).toEqual(['DELIVERY_NOT_ENABLED']);
  });

  it('excludes PICKUP_NOT_ENABLED only when the requested mode is PICKUP and it is off', () => {
    const result = checkOperationalEligibility(
      baseInput({ requestedMode: 'PICKUP', serviceAreaPickupEnabled: false }),
    );
    expect(result.exclusionCodes).toEqual(['PICKUP_NOT_ENABLED']);
  });

  it('EITHER mode only excludes when both delivery and pickup are off', () => {
    const oneOn = checkOperationalEligibility(
      baseInput({ requestedMode: 'EITHER', serviceAreaDeliveryEnabled: true, serviceAreaPickupEnabled: false }),
    );
    expect(oneOn.eligible).toBe(true);
    const bothOff = checkOperationalEligibility(
      baseInput({ requestedMode: 'EITHER', serviceAreaDeliveryEnabled: false, serviceAreaPickupEnabled: false }),
    );
    expect(bothOff.exclusionCodes).toEqual(expect.arrayContaining(['DELIVERY_NOT_ENABLED', 'PICKUP_NOT_ENABLED']));
  });

  it('excludes COLD_CHAIN_UNSUPPORTED when required and the branch lacks the capability', () => {
    const result = checkOperationalEligibility(baseInput({ coldChainRequired: true }));
    expect(result.exclusionCodes).toContain('COLD_CHAIN_UNSUPPORTED');
    const withCapability = checkOperationalEligibility(
      baseInput({ coldChainRequired: true, branchCapabilityCodes: ['COLD_CHAIN'] }),
    );
    expect(withCapability.exclusionCodes).not.toContain('COLD_CHAIN_UNSUPPORTED');
  });

  it('excludes CONTROLLED_DRUG_UNSUPPORTED when required and missing', () => {
    const result = checkOperationalEligibility(baseInput({ controlledDrugRequired: true }));
    expect(result.exclusionCodes).toContain('CONTROLLED_DRUG_UNSUPPORTED');
  });

  it('excludes SPECIAL_ITEM_UNSUPPORTED when required and missing', () => {
    const result = checkOperationalEligibility(baseInput({ specialHandlingRequired: true }));
    expect(result.exclusionCodes).toContain('SPECIAL_ITEM_UNSUPPORTED');
  });

  it('excludes REQUIRED_CAPABILITY_MISSING when a generically required capability is absent', () => {
    const result = checkOperationalEligibility(
      baseInput({ requiredCapabilityCodes: ['SAME_DAY_DELIVERY'], branchCapabilityCodes: [] }),
    );
    expect(result.exclusionCodes).toContain('REQUIRED_CAPABILITY_MISSING');
  });

  it('accumulates every applicable exclusion code, not just the first one found', () => {
    const result = checkOperationalEligibility(
      baseInput({ active: false, temporarilyClosed: true, isOpenNow: false }),
    );
    expect(result.exclusionCodes).toEqual(
      expect.arrayContaining(['BRANCH_INACTIVE', 'TEMPORARILY_CLOSED', 'CLOSED_AT_REQUESTED_TIME']),
    );
  });
});
