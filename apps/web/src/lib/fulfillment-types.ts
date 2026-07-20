/** Phase 6 — location hierarchy reference data. */
export interface Region {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  active: boolean;
}

export interface City {
  id: string;
  regionId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  active: boolean;
}

export interface District {
  id: string;
  cityId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
}

export interface LocationAlias {
  id: string;
  entityType: 'CITY' | 'DISTRICT';
  entityId: string;
  alias: string;
  language: string;
  active: boolean;
}

export interface LocationDataQuality {
  totalBranches: number;
  byMatchStatus: Record<string, number>;
  missingCoordinates: number;
}

/** Phase 6 Step 6 — fulfillment API response shapes. */
export type SearchLocationSourceType =
  | 'MANUAL_CITY'
  | 'MANUAL_DISTRICT'
  | 'FREE_TEXT_ADDRESS'
  | 'MAP_PIN'
  | 'DEVICE_GEOLOCATION'
  | 'SAVED_ADDRESS'
  | 'PARTNER_API'
  | 'IMPORTED'
  | 'UNKNOWN';

export type FulfillmentRequestStatus =
  | 'DRAFT'
  | 'LOCATION_REQUIRED'
  | 'SEARCH_QUEUED'
  | 'SEARCHING'
  | 'OPTIONS_FOUND'
  | 'PARTIAL_OPTIONS_FOUND'
  | 'NO_OPTIONS_FOUND'
  | 'REVIEW_REQUIRED'
  | 'PLAN_SELECTED'
  | 'EXPIRED'
  | 'FAILED';

export type FulfillmentPlanType = 'SINGLE_BRANCH' | 'SPLIT_BRANCH' | 'PICKUP' | 'DELIVERY' | 'MIXED_MODE' | 'NO_SAFE_PLAN';

export type PlanItemAvailabilityStatus = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'UNKNOWN';

export interface FulfillmentDrugSummary {
  id: string;
  materialNo: string;
  nameEn: string;
  nameAr: string | null;
}

export interface FulfillmentBranchSummary {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  latitude: number | null;
  longitude: number | null;
}

export interface FulfillmentPlanItemEntry {
  id: string;
  drugId: string;
  drug: FulfillmentDrugSummary;
  requestedQuantity: number | null;
  availableQuantity: number | null;
  allocatedQuantity: number | null;
  availabilityStatus: PlanItemAvailabilityStatus;
  freshnessStatus: string | null;
}

export interface FulfillmentPlanBranchEntry {
  id: string;
  branchId: string;
  branch: FulfillmentBranchSummary;
  sequence: number;
  distanceKm: number | null;
  score: number | null;
  items: FulfillmentPlanItemEntry[];
}

export interface InventoryReservationEntry {
  id: string;
  branchId: string;
  drugId: string;
  quantity: number;
  status: string;
}

export interface FulfillmentPlanEntry {
  id: string;
  fulfillmentRequestId: string;
  planType: FulfillmentPlanType;
  rank: number;
  totalScore: number;
  branchCount: number;
  completeCoverage: boolean;
  totalDistanceKm: number | null;
  explanationJson: { reason?: string; excludedBranchCount?: number } | null;
  selected: boolean;
  branches: FulfillmentPlanBranchEntry[];
  reservations?: InventoryReservationEntry[];
}

export interface FulfillmentRequestItemEntry {
  id: string;
  drugId: string;
  drug: FulfillmentDrugSummary;
  requiredQuantity: number | null;
}

export interface FulfillmentRequestEntry {
  id: string;
  status: FulfillmentRequestStatus;
  items: FulfillmentRequestItemEntry[];
  plans: FulfillmentPlanEntry[];
}
