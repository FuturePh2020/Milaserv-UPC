/**
 * Product limits and business-setting defaults from the master contract
 * (docs/SPEC.md). Limits are product rules, not load-test results.
 */
export const LIMITS = {
  maxProducts: 5000,
  maxOrderDistinctItems: 100,
  maxCartonsPerLine: 100_000,
  maxCartonPriceCents: 100_000_000,
  maxOrderTotalCents: 10_000_000_000_000,
  importMaxRows: 1000,
  importMaxFileBytes: 1024 * 1024,
  jsonBodyDefaultBytes: 64 * 1024,
  jsonBodyImportBytes: 2 * 1024 * 1024,
  maxUrlLength: 2048,
} as const;

/**
 * Development / initial-pilot defaults for business settings (owner decision,
 * stage 01). These are implementation defaults, NOT a statement of legal tax
 * treatment or exemption. The business must confirm and configure the
 * applicable values before production. Stored per order as a snapshot.
 */
export const BUSINESS_SETTING_DEFAULTS = {
  taxBps: 0,
  shippingCents: 0,
  shippingTaxable: false,
  minimumOrderCents: 0,
  lowStockThresholdCartons: 10,
} as const;

export const BASIS_POINTS_DENOMINATOR = 10_000;
