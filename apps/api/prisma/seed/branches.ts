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
