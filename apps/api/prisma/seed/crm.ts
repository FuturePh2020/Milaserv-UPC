import type { PrismaClient } from '@prisma/client';

/** §14.2 — verbatim. */
const CALL_STATUSES = [
  { key: 'ANSWERED', nameAr: 'تم الرد', nameEn: 'Answered' },
  { key: 'BUSY', nameAr: 'مشغول', nameEn: 'Busy' },
  { key: 'NO_ANSWER', nameAr: 'لا يوجد رد', nameEn: 'No Answer' },
  { key: 'ABANDONED', nameAr: 'مهجورة', nameEn: 'Abandoned' },
];

/** §14.3 — verbatim, with behavior flags (spec E3). */
const DISPOSITIONS = [
  {
    key: 'ORDER_CREATED',
    nameAr: 'تم إنشاء طلب',
    nameEn: 'Order Created',
    closesLead: true,
    createsOrder: true,
    requiresReschedule: false,
  },
  {
    key: 'REFUSED',
    nameAr: 'رفض',
    nameEn: 'Refused',
    closesLead: true,
    createsOrder: false,
    requiresReschedule: false,
  },
  {
    key: 'CALL_BACK_LATER',
    nameAr: 'معاودة الاتصال لاحقًا',
    nameEn: 'Call Back Later',
    closesLead: false,
    createsOrder: false,
    requiresReschedule: true,
  },
  {
    key: 'INVALID_NUMBER',
    nameAr: 'رقم غير صحيح',
    nameEn: 'Invalid Number',
    closesLead: true,
    createsOrder: false,
    requiresReschedule: false,
  },
  {
    key: 'NOT_INTERESTED',
    nameAr: 'غير مهتم',
    nameEn: 'Not Interested',
    closesLead: true,
    createsOrder: false,
    requiresReschedule: false,
  },
  {
    key: 'FOLLOW_UP_REQUIRED',
    nameAr: 'متابعة مطلوبة',
    nameEn: 'Follow-up Required',
    closesLead: false,
    createsOrder: false,
    requiresReschedule: true,
  },
];

/** §14.4 — verbatim. */
const ORDER_TYPES = [
  { key: 'CASH', nameAr: 'نقدي', nameEn: 'Cash' },
  { key: 'INSURANCE', nameAr: 'تأمين', nameEn: 'Insurance' },
  { key: 'WASFATY', nameAr: 'وصفتي', nameEn: 'Wasfaty' },
  { key: 'INSURANCE_PARTNER', nameAr: 'شريك تأمين', nameEn: 'Insurance Partner' },
];

/** §14.5 — the computable KPIs, live from CRM data (spec E5). */
const TELESALES_METRICS = [
  { key: 'ts_calls', nameAr: 'المكالمات', nameEn: 'Calls', unit: 'count', higherIsBetter: true },
  {
    key: 'ts_leads_called',
    nameAr: 'العملاء المحتملون المتصل بهم',
    nameEn: 'Leads Called',
    unit: 'count',
    higherIsBetter: true,
  },
  {
    key: 'ts_orders_created',
    nameAr: 'الطلبات المنشأة',
    nameEn: 'Orders Created',
    unit: 'count',
    higherIsBetter: true,
  },
  {
    key: 'ts_completed_orders',
    nameAr: 'الطلبات المكتملة',
    nameEn: 'Completed Orders',
    unit: 'count',
    higherIsBetter: true,
  },
  {
    key: 'ts_open_orders',
    nameAr: 'الطلبات المفتوحة',
    nameEn: 'Open Orders',
    unit: 'count',
    higherIsBetter: false,
  },
  {
    key: 'ts_sales_value',
    nameAr: 'قيمة المبيعات',
    nameEn: 'Sales Value',
    unit: 'count',
    higherIsBetter: true,
  },
  {
    key: 'ts_aht',
    nameAr: 'متوسط زمن المعالجة (تيليسيلز)',
    nameEn: 'AHT (Telesales)',
    unit: 'seconds',
    higherIsBetter: false,
  },
  {
    key: 'ts_talk_time',
    nameAr: 'إجمالي زمن التحدث (تيليسيلز)',
    nameEn: 'Total Talking Time (Telesales)',
    unit: 'seconds',
    higherIsBetter: true,
  },
  {
    key: 'ts_conversion_rate',
    nameAr: 'معدل التحويل',
    nameEn: 'Conversion Rate',
    unit: 'percent',
    higherIsBetter: true,
  },
];

export async function seedCrmCatalogs(prisma: PrismaClient): Promise<void> {
  let order = 0;
  for (const s of CALL_STATUSES) {
    order += 10;
    await prisma.callStatus.upsert({
      where: { key: s.key },
      update: { ...s, sortOrder: order },
      create: { ...s, sortOrder: order },
    });
  }
  order = 0;
  for (const d of DISPOSITIONS) {
    order += 10;
    await prisma.leadDisposition.upsert({
      where: { key: d.key },
      update: { ...d, sortOrder: order },
      create: { ...d, sortOrder: order },
    });
  }
  order = 0;
  for (const t of ORDER_TYPES) {
    order += 10;
    await prisma.telesalesOrderType.upsert({
      where: { key: t.key },
      update: { ...t, sortOrder: order },
      create: { ...t, sortOrder: order },
    });
  }

  // Telesales KPIs live in the §12 performance catalog (spec E5).
  // Live-computed KPIs aggregate per period at computation time, so the
  // stored aggregation only matters for ingested rows — none exist for these.
  let sort = 1000;
  for (const m of TELESALES_METRICS) {
    sort += 10;
    await prisma.performanceMetricDef.upsert({
      where: { key: m.key },
      update: { ...m, aggregation: 'SUM', source: 'TELESALES', sortOrder: sort },
      create: { ...m, aggregation: 'SUM', source: 'TELESALES', sortOrder: sort },
    });
  }
  console.log(
    `✔ crm catalogs (§14): ${CALL_STATUSES.length} call statuses, ${DISPOSITIONS.length} dispositions, ${ORDER_TYPES.length} order types, ${TELESALES_METRICS.length} telesales KPIs`,
  );
}
