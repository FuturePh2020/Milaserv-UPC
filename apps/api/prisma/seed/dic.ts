import type { PrismaClient } from '@prisma/client';

/** §15.2 item classifications — feed values (spec H1). Existing keys are
 *  never renamed (22,732 real Drug rows reference them) — Phase 4 (design
 *  doc §2) only appends the additional classifications it needs. */
const ITEM_TYPES = [
  { key: 'NORMAL', nameAr: 'صنف عادي', nameEn: 'Normal Item' },
  { key: 'SPECIAL', nameAr: 'صنف خاص', nameEn: 'Special Item' },
  { key: 'HOSPITAL_AT_HOME', nameAr: 'مستشفى في المنزل', nameEn: 'Hospital At Home' },
  { key: 'RAQEEB', nameAr: 'صنف رقيب', nameEn: 'Raqeeb Item' },
  { key: 'OTC', nameAr: 'يُصرف دون وصفة', nameEn: 'Over-the-Counter' },
  { key: 'PRESCRIPTION_ONLY', nameAr: 'يُصرف بوصفة فقط', nameEn: 'Prescription Only' },
  { key: 'MEDICAL_SUPPLY', nameAr: 'مستلزم طبي', nameEn: 'Medical Supply' },
  { key: 'SUPPLEMENT', nameAr: 'مكمل غذائي', nameEn: 'Supplement' },
  { key: 'OTHER', nameAr: 'أخرى', nameEn: 'Other' },
];

/** §15.3 — seeded companies; additional companies are inserts (spec H3). */
const COMPANIES = [
  { key: 'MEENA', nameAr: 'مينا', nameEn: 'Meena' },
  { key: 'TAWUNIYA', nameAr: 'التعاونية', nameEn: 'Tawuniya' },
  { key: 'BUPA', nameAr: 'بوبا', nameEn: 'BUPA' },
];

export async function seedDicCatalogs(prisma: PrismaClient): Promise<void> {
  for (const t of ITEM_TYPES) {
    await prisma.drugItemType.upsert({ where: { key: t.key }, update: {}, create: t });
  }
  for (const c of COMPANIES) {
    await prisma.insuranceCompany.upsert({ where: { key: c.key }, update: {}, create: c });
  }
  console.log(
    `✔ dic catalogs (§15): ${ITEM_TYPES.length} item types, ${COMPANIES.length} insurance companies`,
  );
}
