import { matchCityByText, matchDistrictByText } from './branch-location-matcher';
import { normalizeLocationArabic, normalizeLocationEnglish } from './location-normalizer';

const RIYADH = {
  id: 'city-riyadh',
  normalizedNameEn: normalizeLocationEnglish('Riyadh'),
  normalizedNameAr: normalizeLocationArabic('الرياض'),
};
const JEDDAH = {
  id: 'city-jeddah',
  normalizedNameEn: normalizeLocationEnglish('Jeddah'),
  normalizedNameAr: normalizeLocationArabic('جدة'),
};
const CITIES = [RIYADH, JEDDAH];

describe('matchCityByText', () => {
  it('matches on the English normalized name', () => {
    expect(matchCityByText('riyadh', CITIES, [])).toEqual(RIYADH);
  });

  it('matches on the Arabic normalized name', () => {
    expect(matchCityByText('الرياض', CITIES, [])).toEqual(RIYADH);
  });

  it('is case/whitespace insensitive', () => {
    expect(matchCityByText('  RIYADH  ', CITIES, [])).toEqual(RIYADH);
  });

  it('falls back to an approved alias when there is no direct name match', () => {
    const alias = { entityId: JEDDAH.id, normalizedAlias: normalizeLocationEnglish('Jiddah') };
    expect(matchCityByText('Jiddah', CITIES, [alias])).toEqual(JEDDAH);
  });

  it('returns null rather than guessing when nothing matches', () => {
    expect(matchCityByText('Nonexistent Town', CITIES, [])).toBeNull();
  });

  it('never fuzzy-matches a near-miss spelling without an explicit alias', () => {
    // "Riyad" (missing the trailing h) must not silently resolve to Riyadh —
    // only an exact normalized match or an explicit, approved alias may.
    expect(matchCityByText('Riyad', CITIES, [])).toBeNull();
  });
});

describe('matchDistrictByText', () => {
  const OLAYA = {
    id: 'district-olaya',
    normalizedNameEn: normalizeLocationEnglish('Olaya'),
    normalizedNameAr: normalizeLocationArabic('العليا'),
  };

  it('matches on either script', () => {
    expect(matchDistrictByText('Olaya', [OLAYA])).toEqual(OLAYA);
    expect(matchDistrictByText('العليا', [OLAYA])).toEqual(OLAYA);
  });

  it('returns null when no district matches', () => {
    expect(matchDistrictByText('Unknown District', [OLAYA])).toBeNull();
  });
});
