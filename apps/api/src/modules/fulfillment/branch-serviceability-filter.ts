import type { FulfillmentExclusionCode } from './fulfillment-exclusion-codes';

export interface ServiceAreaInput {
  serviceAreaType: 'CITY' | 'DISTRICT' | 'RADIUS' | 'POLYGON' | 'POSTAL_CODE' | 'MANUAL_ZONE';
  cityId: string | null;
  districtId: string | null;
  radiusKm: number | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  active: boolean;
}

export interface SearchLocationInput {
  cityId: string | null;
  districtId: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ServiceabilityResult {
  eligible: boolean;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  exclusionCode: FulfillmentExclusionCode | null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function areaMatches(area: ServiceAreaInput, location: SearchLocationInput): boolean {
  switch (area.serviceAreaType) {
    case 'CITY':
      return area.cityId !== null && area.cityId === location.cityId;
    case 'DISTRICT':
      return area.districtId !== null && area.districtId === location.districtId;
    case 'RADIUS':
      if (
        area.radiusKm == null ||
        area.centerLatitude == null ||
        area.centerLongitude == null ||
        location.latitude == null ||
        location.longitude == null
      ) {
        return false;
      }
      return haversineKm(area.centerLatitude, area.centerLongitude, location.latitude, location.longitude) <= area.radiusKm;
    case 'POLYGON':
    case 'POSTAL_CODE':
    case 'MANUAL_ZONE':
      // Not supported until the PostGIS upgrade (Step 1 decision) — a
      // POLYGON/POSTAL_CODE/MANUAL_ZONE area never matches rather than
      // being silently treated as always-on.
      return false;
  }
}

/**
 * Phase 6 §8/§18 Stage 2 — serviceability is never distance-only. A
 * branch with no service areas configured at all is treated as
 * unrestricted (eligible) rather than blocking every branch until every
 * one of 600+ branches has service areas hand-configured — a branch
 * that HAS service areas is bound by them exactly.
 */
export function checkServiceability(
  serviceAreas: ServiceAreaInput[],
  location: SearchLocationInput,
): ServiceabilityResult {
  const active = serviceAreas.filter((a) => a.active);
  if (active.length === 0) {
    return { eligible: true, deliveryEnabled: true, pickupEnabled: true, exclusionCode: null };
  }
  const matched = active.find((a) => areaMatches(a, location));
  if (!matched) {
    return { eligible: false, deliveryEnabled: false, pickupEnabled: false, exclusionCode: 'OUTSIDE_SERVICE_AREA' };
  }
  return {
    eligible: true,
    deliveryEnabled: matched.deliveryEnabled,
    pickupEnabled: matched.pickupEnabled,
    exclusionCode: null,
  };
}
