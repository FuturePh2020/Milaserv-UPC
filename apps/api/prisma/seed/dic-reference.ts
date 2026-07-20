import type { PrismaClient } from '@prisma/client';

/** Phase 4 (design doc §4) — controlled dosage-form catalog, never free
 *  text. Starter set matching the design doc's own examples. */
const DOSAGE_FORMS = [
  { code: 'TABLET', nameEn: 'Tablet', nameAr: 'قرص' },
  { code: 'CAPSULE', nameEn: 'Capsule', nameAr: 'كبسولة' },
  { code: 'SYRUP', nameEn: 'Syrup', nameAr: 'شراب' },
  { code: 'SUSPENSION', nameEn: 'Suspension', nameAr: 'معلق' },
  { code: 'INJECTION', nameEn: 'Injection', nameAr: 'حقنة' },
  { code: 'CREAM', nameEn: 'Cream', nameAr: 'كريم' },
  { code: 'OINTMENT', nameEn: 'Ointment', nameAr: 'مرهم' },
  { code: 'DROPS', nameEn: 'Drops', nameAr: 'قطرات' },
  { code: 'INHALER', nameEn: 'Inhaler', nameAr: 'بخاخ استنشاق' },
  { code: 'SUPPOSITORY', nameEn: 'Suppository', nameAr: 'تحميلة' },
  { code: 'SACHET', nameEn: 'Sachet', nameAr: 'كيس' },
  { code: 'GEL', nameEn: 'Gel', nameAr: 'جل' },
  { code: 'SOLUTION', nameEn: 'Solution', nameAr: 'محلول' },
];

/** Phase 4 (design doc §4) — controlled unit catalog, never free text.
 *  normalizationFactor × value → baseUnitCode (e.g. 1 g = 1000 mg); null
 *  where conversion isn't meaningful (percentages, discrete counts). */
const MEASUREMENT_UNITS = [
  {
    code: 'mg',
    nameEn: 'Milligram',
    nameAr: 'ملغ',
    unitCategory: 'MASS',
    normalizationFactor: '1',
    baseUnitCode: 'mg',
  },
  {
    code: 'g',
    nameEn: 'Gram',
    nameAr: 'غرام',
    unitCategory: 'MASS',
    normalizationFactor: '1000',
    baseUnitCode: 'mg',
  },
  {
    code: 'mcg',
    nameEn: 'Microgram',
    nameAr: 'ميكروغرام',
    unitCategory: 'MASS',
    normalizationFactor: '0.001',
    baseUnitCode: 'mg',
  },
  {
    code: 'ml',
    nameEn: 'Milliliter',
    nameAr: 'مل',
    unitCategory: 'VOLUME',
    normalizationFactor: '1',
    baseUnitCode: 'ml',
  },
  {
    code: 'mg/ml',
    nameEn: 'Milligram per milliliter',
    nameAr: 'ملغ/مل',
    unitCategory: 'CONCENTRATION',
    normalizationFactor: null,
    baseUnitCode: null,
  },
  {
    code: 'IU',
    nameEn: 'International Unit',
    nameAr: 'وحدة دولية',
    unitCategory: 'ACTIVITY',
    normalizationFactor: '1',
    baseUnitCode: 'IU',
  },
  {
    code: '%',
    nameEn: 'Percent',
    nameAr: '%',
    unitCategory: 'PERCENTAGE',
    normalizationFactor: null,
    baseUnitCode: null,
  },
  {
    code: 'mmol',
    nameEn: 'Millimole',
    nameAr: 'ملي مول',
    unitCategory: 'AMOUNT',
    normalizationFactor: '1',
    baseUnitCode: 'mmol',
  },
  {
    code: 'tablet',
    nameEn: 'Tablet',
    nameAr: 'قرص',
    unitCategory: 'COUNT',
    normalizationFactor: '1',
    baseUnitCode: 'tablet',
  },
  {
    code: 'capsule',
    nameEn: 'Capsule',
    nameAr: 'كبسولة',
    unitCategory: 'COUNT',
    normalizationFactor: '1',
    baseUnitCode: 'capsule',
  },
];

/** Common drug-manufacturing/origin countries — starter set, extensible
 *  via inserts (same doctrine as InsuranceCompany, spec H3). */
const COUNTRIES = [
  { isoCode: 'SA', nameEn: 'Saudi Arabia', nameAr: 'المملكة العربية السعودية' },
  { isoCode: 'US', nameEn: 'United States', nameAr: 'الولايات المتحدة' },
  { isoCode: 'GB', nameEn: 'United Kingdom', nameAr: 'المملكة المتحدة' },
  { isoCode: 'DE', nameEn: 'Germany', nameAr: 'ألمانيا' },
  { isoCode: 'FR', nameEn: 'France', nameAr: 'فرنسا' },
  { isoCode: 'CH', nameEn: 'Switzerland', nameAr: 'سويسرا' },
  { isoCode: 'IN', nameEn: 'India', nameAr: 'الهند' },
  { isoCode: 'EG', nameEn: 'Egypt', nameAr: 'مصر' },
  { isoCode: 'JO', nameEn: 'Jordan', nameAr: 'الأردن' },
  { isoCode: 'CN', nameEn: 'China', nameAr: 'الصين' },
];

/** Starter pharmacological classification — distinct from Drug.className/
 *  subClassName (feed merchandising categories, unchanged). Deliberately
 *  minimal: a real therapeutic-class taxonomy is pharmacist-curated data,
 *  not something to fabricate wholesale here (design doc risk: don't
 *  insert example production data as real master data). */
const THERAPEUTIC_CLASSES: { code: string; nameEn: string; nameAr: string; parentCode?: string }[] =
  [
    { code: 'ANALGESICS', nameEn: 'Analgesics', nameAr: 'مسكنات الألم' },
    { code: 'ANTIBIOTICS', nameEn: 'Antibiotics', nameAr: 'مضادات حيوية' },
    {
      code: 'ANTIBIOTICS_PENICILLINS',
      nameEn: 'Penicillins',
      nameAr: 'البنسلينات',
      parentCode: 'ANTIBIOTICS',
    },
    {
      code: 'ANTIBIOTICS_CEPHALOSPORINS',
      nameEn: 'Cephalosporins',
      nameAr: 'السيفالوسبورينات',
      parentCode: 'ANTIBIOTICS',
    },
    { code: 'ANTIHISTAMINES', nameEn: 'Antihistamines', nameAr: 'مضادات الهيستامين' },
    { code: 'CARDIOVASCULAR', nameEn: 'Cardiovascular', nameAr: 'أدوية القلب والأوعية الدموية' },
    { code: 'GASTROINTESTINAL', nameEn: 'Gastrointestinal', nameAr: 'أدوية الجهاز الهضمي' },
    { code: 'RESPIRATORY', nameEn: 'Respiratory', nameAr: 'أدوية الجهاز التنفسي' },
    { code: 'DERMATOLOGICAL', nameEn: 'Dermatological', nameAr: 'أدوية الجلدية' },
    { code: 'ENDOCRINE', nameEn: 'Endocrine & Diabetes', nameAr: 'الغدد الصماء والسكري' },
    {
      code: 'VITAMINS_SUPPLEMENTS',
      nameEn: 'Vitamins & Supplements',
      nameAr: 'الفيتامينات والمكملات',
    },
    { code: 'OTHER', nameEn: 'Other', nameAr: 'أخرى' },
  ];

export async function seedDicReferenceData(prisma: PrismaClient): Promise<void> {
  for (const f of DOSAGE_FORMS) {
    await prisma.dosageForm.upsert({
      where: { code: f.code },
      update: {},
      create: { ...f, normalizedNameEn: f.nameEn.toLowerCase(), normalizedNameAr: f.nameAr },
    });
  }
  for (const u of MEASUREMENT_UNITS) {
    await prisma.measurementUnit.upsert({ where: { code: u.code }, update: {}, create: u });
  }
  for (const c of COUNTRIES) {
    await prisma.country.upsert({ where: { isoCode: c.isoCode }, update: {}, create: c });
  }
  // Parents before children — parentCode is resolved to a real id here.
  const classIdByCode = new Map<string, string>();
  for (const cls of THERAPEUTIC_CLASSES) {
    const parentId = cls.parentCode ? (classIdByCode.get(cls.parentCode) ?? null) : null;
    const row = await prisma.therapeuticClass.upsert({
      where: { code: cls.code },
      update: { parentId },
      create: { code: cls.code, nameEn: cls.nameEn, nameAr: cls.nameAr, parentId },
    });
    classIdByCode.set(cls.code, row.id);
  }
  console.log(
    `✔ dic reference data (Phase 4): ${DOSAGE_FORMS.length} dosage forms, ` +
      `${MEASUREMENT_UNITS.length} units, ${COUNTRIES.length} countries, ` +
      `${THERAPEUTIC_CLASSES.length} therapeutic classes`,
  );
}
