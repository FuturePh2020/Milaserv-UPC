import { normalizeLocationText } from './location-normalizer';

export interface MatchableCity {
  id: string;
  normalizedNameEn: string;
  normalizedNameAr: string;
}

export interface MatchableDistrict {
  id: string;
  normalizedNameEn: string;
  normalizedNameAr: string;
}

export interface CityAlias {
  entityId: string;
  normalizedAlias: string;
}

/**
 * Phase 6 §5 — matches a Branch's free-text city/district against the
 * structured hierarchy. Pure/DB-free so it's independently unit-tested,
 * mirroring DrugCandidateGenerator's dedupe/hydrate split: this is the
 * "decide" half, LocationsService.backfillBranchLocations is the "fetch
 * rows, apply the decision, persist" half. Exact normalized match only
 * (name or approved alias) — no fuzzy/trigram guessing, since a wrong
 * branch-location match has real fulfillment consequences later.
 */
export function matchCityByText(
  cityText: string,
  cities: MatchableCity[],
  aliases: CityAlias[],
): MatchableCity | null {
  const { en, ar } = normalizeLocationText(cityText);
  const direct = cities.find((c) => c.normalizedNameEn === en || c.normalizedNameAr === ar);
  if (direct) return direct;

  const alias = aliases.find((a) => a.normalizedAlias === en || a.normalizedAlias === ar);
  if (!alias) return null;
  return cities.find((c) => c.id === alias.entityId) ?? null;
}

export function matchDistrictByText(
  districtText: string,
  districts: MatchableDistrict[],
): MatchableDistrict | null {
  const { en, ar } = normalizeLocationText(districtText);
  return districts.find((d) => d.normalizedNameEn === en || d.normalizedNameAr === ar) ?? null;
}
