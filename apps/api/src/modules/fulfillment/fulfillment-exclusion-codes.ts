/**
 * Phase 6 §25 — explicit exclusion codes, stored for audit/explainability
 * (never a silent drop). Stages 1-3 (this step) use the location/
 * serviceability/operational subset; inventory-related codes are wired
 * in by Stage 4 (Step 5). PARTNER_RESTRICTION / CITY_ROUTING_RESTRICTION
 * are omitted — no Partner entity exists in this platform yet (Step 1
 * research finding), so a restriction keyed on one can't be evaluated.
 */
export type FulfillmentExclusionCode =
  | 'OUTSIDE_CITY'
  | 'OUTSIDE_SERVICE_AREA'
  | 'DELIVERY_NOT_ENABLED'
  | 'PICKUP_NOT_ENABLED'
  | 'PRESCRIPTION_FULFILLMENT_NOT_ENABLED'
  | 'BRANCH_INACTIVE'
  | 'TEMPORARILY_CLOSED'
  | 'CLOSED_AT_REQUESTED_TIME'
  | 'CAPACITY_EXCEEDED'
  | 'REQUIRED_CAPABILITY_MISSING'
  | 'COLD_CHAIN_UNSUPPORTED'
  | 'CONTROLLED_DRUG_UNSUPPORTED'
  | 'SPECIAL_ITEM_UNSUPPORTED'
  | 'LOCATION_TOO_FAR'
  | 'DRUG_OUT_OF_STOCK'
  | 'INSUFFICIENT_QUANTITY'
  | 'STALE_INVENTORY'
  | 'UNKNOWN_INVENTORY'
  | 'LIVE_VERIFICATION_FAILED';
