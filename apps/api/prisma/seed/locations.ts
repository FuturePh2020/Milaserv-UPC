import type { PrismaClient } from '@prisma/client';

/** Seed data is already canonical, so normalization here is trivial —
 *  matches DIC reference seed's own precedent (dic-reference.ts). The
 *  real normalizeEnglish/normalizeArabic pipeline is used by the
 *  Branch backfill matcher, which deals with messy free-text input. */
function normalizeSeedEnglish(text: string): string {
  return text.toLowerCase().trim();
}

/** Phase 6 §5 — Saudi Arabia's 13 administrative regions (starter set,
 *  the platform's operating country). Reference data, extendable via
 *  the locations.manage CRUD API — this is not meant to be exhaustive. */
const REGIONS = [
  { code: 'RIYADH', nameEn: 'Riyadh Region', nameAr: 'منطقة الرياض' },
  { code: 'MAKKAH', nameEn: 'Makkah Region', nameAr: 'منطقة مكة المكرمة' },
  { code: 'MADINAH', nameEn: 'Madinah Region', nameAr: 'منطقة المدينة المنورة' },
  { code: 'EASTERN', nameEn: 'Eastern Province', nameAr: 'المنطقة الشرقية' },
  { code: 'QASSIM', nameEn: 'Qassim Region', nameAr: 'منطقة القصيم' },
  { code: 'ASIR', nameEn: 'Asir Region', nameAr: 'منطقة عسير' },
  { code: 'TABUK', nameEn: 'Tabuk Region', nameAr: 'منطقة تبوك' },
  { code: 'HAIL', nameEn: 'Hail Region', nameAr: 'منطقة حائل' },
  { code: 'NORTHERN_BORDERS', nameEn: 'Northern Borders Region', nameAr: 'منطقة الحدود الشمالية' },
  { code: 'JAZAN', nameEn: 'Jazan Region', nameAr: 'منطقة جازان' },
  { code: 'NAJRAN', nameEn: 'Najran Region', nameAr: 'منطقة نجران' },
  { code: 'AL_BAHAH', nameEn: 'Al Bahah Region', nameAr: 'منطقة الباحة' },
  { code: 'AL_JOUF', nameEn: 'Al Jouf Region', nameAr: 'منطقة الجوف' },
];

/** Starter set of major cities per region — extendable via CRUD as real
 *  branch data reveals more. Coordinates are approximate city centers
 *  (city-level precision only; branch-level precision comes from each
 *  Branch's own latitude/longitude). */
const CITIES: {
  regionCode: string;
  code: string;
  nameEn: string;
  nameAr: string;
  latitude: number;
  longitude: number;
}[] = [
  { regionCode: 'RIYADH', code: 'RIYADH_CITY', nameEn: 'Riyadh', nameAr: 'الرياض', latitude: 24.7136, longitude: 46.6753 },
  { regionCode: 'RIYADH', code: 'AL_KHARJ', nameEn: 'Al Kharj', nameAr: 'الخرج', latitude: 24.1556, longitude: 47.334 },
  { regionCode: 'RIYADH', code: 'AL_MAJMAAH', nameEn: "Al Majma'ah", nameAr: 'المجمعة', latitude: 25.9065, longitude: 45.3419 },
  { regionCode: 'RIYADH', code: 'AL_DIRIYAH', nameEn: 'Al Diriyah', nameAr: 'الدرعية', latitude: 24.7332, longitude: 46.5758 },
  { regionCode: 'MAKKAH', code: 'JEDDAH', nameEn: 'Jeddah', nameAr: 'جدة', latitude: 21.4858, longitude: 39.1925 },
  { regionCode: 'MAKKAH', code: 'MAKKAH_CITY', nameEn: 'Makkah', nameAr: 'مكة المكرمة', latitude: 21.3891, longitude: 39.8579 },
  { regionCode: 'MAKKAH', code: 'TAIF', nameEn: 'Taif', nameAr: 'الطائف', latitude: 21.2703, longitude: 40.4158 },
  { regionCode: 'MAKKAH', code: 'RABIGH', nameEn: 'Rabigh', nameAr: 'رابغ', latitude: 22.7986, longitude: 39.0349 },
  { regionCode: 'MADINAH', code: 'MADINAH_CITY', nameEn: 'Madinah', nameAr: 'المدينة المنورة', latitude: 24.5247, longitude: 39.5692 },
  { regionCode: 'MADINAH', code: 'YANBU', nameEn: 'Yanbu', nameAr: 'ينبع', latitude: 24.0895, longitude: 38.0618 },
  { regionCode: 'EASTERN', code: 'DAMMAM', nameEn: 'Dammam', nameAr: 'الدمام', latitude: 26.4207, longitude: 50.0888 },
  { regionCode: 'EASTERN', code: 'KHOBAR', nameEn: 'Khobar', nameAr: 'الخبر', latitude: 26.2172, longitude: 50.1971 },
  { regionCode: 'EASTERN', code: 'DHAHRAN', nameEn: 'Dhahran', nameAr: 'الظهران', latitude: 26.2361, longitude: 50.0393 },
  { regionCode: 'EASTERN', code: 'AL_AHSA', nameEn: 'Al Ahsa', nameAr: 'الأحساء', latitude: 25.3833, longitude: 49.5871 },
  { regionCode: 'EASTERN', code: 'JUBAIL', nameEn: 'Jubail', nameAr: 'الجبيل', latitude: 27.0046, longitude: 49.6534 },
  { regionCode: 'EASTERN', code: 'QATIF', nameEn: 'Qatif', nameAr: 'القطيف', latitude: 26.5651, longitude: 50.0089 },
  { regionCode: 'QASSIM', code: 'BURAIDAH', nameEn: 'Buraidah', nameAr: 'بريدة', latitude: 26.3260, longitude: 43.9750 },
  { regionCode: 'QASSIM', code: 'UNAIZAH', nameEn: 'Unaizah', nameAr: 'عنيزة', latitude: 26.0842, longitude: 43.9935 },
  { regionCode: 'ASIR', code: 'ABHA', nameEn: 'Abha', nameAr: 'أبها', latitude: 18.2465, longitude: 42.5117 },
  { regionCode: 'ASIR', code: 'KHAMIS_MUSHAIT', nameEn: 'Khamis Mushait', nameAr: 'خميس مشيط', latitude: 18.3061, longitude: 42.7297 },
  { regionCode: 'TABUK', code: 'TABUK_CITY', nameEn: 'Tabuk', nameAr: 'تبوك', latitude: 28.3838, longitude: 36.5550 },
  { regionCode: 'HAIL', code: 'HAIL_CITY', nameEn: 'Hail', nameAr: 'حائل', latitude: 27.5114, longitude: 41.6900 },
  { regionCode: 'NORTHERN_BORDERS', code: 'ARAR', nameEn: 'Arar', nameAr: 'عرعر', latitude: 30.9753, longitude: 41.0381 },
  { regionCode: 'JAZAN', code: 'JAZAN_CITY', nameEn: 'Jazan', nameAr: 'جازان', latitude: 16.8892, longitude: 42.5611 },
  { regionCode: 'NAJRAN', code: 'NAJRAN_CITY', nameEn: 'Najran', nameAr: 'نجران', latitude: 17.4933, longitude: 44.1277 },
  { regionCode: 'AL_BAHAH', code: 'AL_BAHAH_CITY', nameEn: 'Al Bahah', nameAr: 'الباحة', latitude: 20.0129, longitude: 41.4677 },
  { regionCode: 'AL_JOUF', code: 'SAKAKA', nameEn: 'Sakaka', nameAr: 'سكاكا', latitude: 29.9697, longitude: 40.2064 },
];

export async function seedLocationHierarchy(prisma: PrismaClient): Promise<void> {
  const regionIds = new Map<string, string>();
  for (const r of REGIONS) {
    const row = await prisma.region.upsert({
      where: { code: r.code },
      update: { nameEn: r.nameEn, nameAr: r.nameAr },
      create: r,
    });
    regionIds.set(r.code, row.id);
  }

  for (const c of CITIES) {
    const regionId = regionIds.get(c.regionCode);
    if (!regionId) throw new Error(`Unknown region code in CITIES seed: ${c.regionCode}`);
    await prisma.city.upsert({
      where: { code: c.code },
      update: {
        regionId,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        normalizedNameEn: normalizeSeedEnglish(c.nameEn),
        normalizedNameAr: c.nameAr,
        latitude: c.latitude,
        longitude: c.longitude,
      },
      create: {
        regionId,
        code: c.code,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        normalizedNameEn: normalizeSeedEnglish(c.nameEn),
        normalizedNameAr: c.nameAr,
        latitude: c.latitude,
        longitude: c.longitude,
      },
    });
  }

  console.log(`✔ location hierarchy: ${REGIONS.length} regions, ${CITIES.length} cities`);
}
