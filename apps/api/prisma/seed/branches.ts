import type { PrismaClient } from '@prisma/client';

/** §16.2 — verbatim. */
const BRANCH_TYPES = [
  { key: 'ONLINE_STORE', nameAr: 'متجر إلكتروني', nameEn: 'Online Store' },
  { key: 'DARK_STORE', nameAr: 'متجر مظلم', nameEn: 'Dark Store' },
  { key: 'OFFLINE_BRANCH', nameAr: 'فرع تقليدي', nameEn: 'Offline Branch' },
  { key: 'RAQEEB_BRANCH', nameAr: 'فرع رقيب', nameEn: 'Raqeeb Branch' },
];

export async function seedBranchTypes(prisma: PrismaClient): Promise<void> {
  for (const t of BRANCH_TYPES) {
    await prisma.branchType.upsert({ where: { key: t.key }, update: {}, create: t });
  }
  console.log(`✔ branch types (§16.2): ${BRANCH_TYPES.length}`);
}

/** Phase 6 §10 — starter capability catalog the fulfillment engine's
 *  Stage 3 (operational eligibility) checks against. Extendable via the
 *  branch.manage-gated capabilities API; not meant to be exhaustive. */
const BRANCH_CAPABILITIES = [
  { code: 'PRESCRIPTION_FULFILLMENT', nameEn: 'Prescription Fulfillment', nameAr: 'صرف الوصفات الطبية' },
  { code: 'ONLINE_DELIVERY', nameEn: 'Online Delivery', nameAr: 'التوصيل الإلكتروني' },
  { code: 'CLICK_AND_COLLECT', nameEn: 'Click & Collect', nameAr: 'الطلب والاستلام' },
  { code: 'COLD_CHAIN', nameEn: 'Cold Chain Handling', nameAr: 'سلسلة التبريد' },
  { code: 'CONTROLLED_MEDICINE', nameEn: 'Controlled Medicine Handling', nameAr: 'التعامل مع الأدوية الخاضعة للرقابة' },
  { code: 'SPECIAL_MEDICINE', nameEn: 'Special Medicine Handling', nameAr: 'التعامل مع الأدوية الخاصة' },
  { code: 'SAME_DAY_DELIVERY', nameEn: 'Same-Day Delivery', nameAr: 'التوصيل في نفس اليوم' },
];

export async function seedBranchCapabilities(prisma: PrismaClient): Promise<void> {
  for (const c of BRANCH_CAPABILITIES) {
    await prisma.branchCapability.upsert({ where: { code: c.code }, update: {}, create: c });
  }
  console.log(`✔ branch capabilities (Phase 6 §10): ${BRANCH_CAPABILITIES.length}`);
}
