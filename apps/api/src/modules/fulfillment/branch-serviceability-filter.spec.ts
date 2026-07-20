import { checkServiceability } from './branch-serviceability-filter';
import type { SearchLocationInput, ServiceAreaInput } from './branch-serviceability-filter';

const RIYADH: SearchLocationInput = { cityId: 'city-riyadh', districtId: null, latitude: 24.7136, longitude: 46.6753 };
const JEDDAH: SearchLocationInput = { cityId: 'city-jeddah', districtId: null, latitude: 21.4858, longitude: 39.1925 };

describe('checkServiceability', () => {
  it('is eligible and unrestricted when a branch has no service areas configured at all', () => {
    const result = checkServiceability([], RIYADH);
    expect(result.eligible).toBe(true);
    expect(result.deliveryEnabled).toBe(true);
    expect(result.pickupEnabled).toBe(true);
  });

  it('matches a CITY service area on exact cityId', () => {
    const area: ServiceAreaInput = {
      serviceAreaType: 'CITY',
      cityId: 'city-riyadh',
      districtId: null,
      radiusKm: null,
      centerLatitude: null,
      centerLongitude: null,
      deliveryEnabled: true,
      pickupEnabled: false,
      active: true,
    };
    expect(checkServiceability([area], RIYADH).eligible).toBe(true);
    expect(checkServiceability([area], JEDDAH).eligible).toBe(false);
  });

  it('excludes with OUTSIDE_SERVICE_AREA when a branch has areas but none match', () => {
    const area: ServiceAreaInput = {
      serviceAreaType: 'CITY',
      cityId: 'city-riyadh',
      districtId: null,
      radiusKm: null,
      centerLatitude: null,
      centerLongitude: null,
      deliveryEnabled: true,
      pickupEnabled: true,
      active: true,
    };
    const result = checkServiceability([area], JEDDAH);
    expect(result.eligible).toBe(false);
    expect(result.exclusionCode).toBe('OUTSIDE_SERVICE_AREA');
  });

  it('matches a RADIUS service area within distance and excludes beyond it', () => {
    const area: ServiceAreaInput = {
      serviceAreaType: 'RADIUS',
      cityId: null,
      districtId: null,
      radiusKm: 5,
      centerLatitude: 24.7136,
      centerLongitude: 46.6753,
      deliveryEnabled: true,
      pickupEnabled: true,
      active: true,
    };
    const nearby: SearchLocationInput = { cityId: null, districtId: null, latitude: 24.72, longitude: 46.68 };
    expect(checkServiceability([area], nearby).eligible).toBe(true);
    expect(checkServiceability([area], JEDDAH).eligible).toBe(false);
  });

  it('a physically close branch outside its own service area is still excluded (spec worked example)', () => {
    // Branch is in Jeddah's service area only, even though the search
    // point happens to be geographically near it.
    const area: ServiceAreaInput = {
      serviceAreaType: 'CITY',
      cityId: 'city-jeddah',
      districtId: null,
      radiusKm: null,
      centerLatitude: null,
      centerLongitude: null,
      deliveryEnabled: true,
      pickupEnabled: true,
      active: true,
    };
    const closeButWrongCity: SearchLocationInput = { cityId: 'city-riyadh', districtId: null, latitude: 21.5, longitude: 39.2 };
    expect(checkServiceability([area], closeButWrongCity).eligible).toBe(false);
  });

  it('never matches an unsupported POLYGON/POSTAL_CODE/MANUAL_ZONE area (deferred until PostGIS)', () => {
    const polygonArea: ServiceAreaInput = {
      serviceAreaType: 'POLYGON',
      cityId: null,
      districtId: null,
      radiusKm: null,
      centerLatitude: null,
      centerLongitude: null,
      deliveryEnabled: true,
      pickupEnabled: true,
      active: true,
    };
    expect(checkServiceability([polygonArea], RIYADH).eligible).toBe(false);
  });

  it('ignores an inactive service area', () => {
    const inactiveArea: ServiceAreaInput = {
      serviceAreaType: 'CITY',
      cityId: 'city-riyadh',
      districtId: null,
      radiusKm: null,
      centerLatitude: null,
      centerLongitude: null,
      deliveryEnabled: true,
      pickupEnabled: true,
      active: false,
    };
    // Only inactive areas exist, so the branch falls back to unrestricted.
    expect(checkServiceability([inactiveArea], RIYADH).eligible).toBe(true);
  });
});
