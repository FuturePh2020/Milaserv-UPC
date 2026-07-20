import type { PrismaClient } from '@prisma/client';

/** §13 source catalogs — starter values, editable (online spec F3). */
const SOURCES = [
  { key: 'APP', nameAr: 'التطبيق', nameEn: 'App' },
  { key: 'WEBSITE', nameAr: 'الموقع الإلكتروني', nameEn: 'Website' },
  { key: 'CALL_CENTER', nameAr: 'مركز الاتصال', nameEn: 'Call Center' },
];

export async function seedOnlineCatalogs(prisma: PrismaClient): Promise<void> {
  for (const s of SOURCES) {
    await prisma.orderSource.upsert({ where: { key: s.key }, update: {}, create: s });
    await prisma.requestSource.upsert({ where: { key: s.key }, update: {}, create: s });
  }
  console.log(`✔ online source catalogs (§13): ${SOURCES.length} order + request sources`);
}
