/**
 * Ticketing configuration catalogs — seeded with the blueprint's exact values
 * (§9.1–§9.3, §9.6; spec §3/§5/A6). Upsert-only; admin edits are not overwritten.
 */
import type { PrismaClient, StatusKind } from '@prisma/client';

const TYPES = [
  { key: 'INTERNAL', nameAr: 'تذكرة داخلية', nameEn: 'Internal Ticket' },
  { key: 'BRANCH', nameAr: 'تذكرة فرع', nameEn: 'Branch Ticket' },
  // §13 Online Operation rides the universal engine (online spec F1)
  { key: 'ONLINE_ISSUE', nameAr: 'مشكلة طلب إلكتروني', nameEn: 'Order Issue' },
  { key: 'ONLINE_REQUEST', nameAr: 'طلب خدمة إلكتروني', nameEn: 'Order Request' },
];

const CATEGORIES: Record<string, { key: string; nameAr: string; nameEn: string }[]> = {
  INTERNAL: [
    { key: 'INQUIRY', nameAr: 'استفسار', nameEn: 'Inquiry' },
    { key: 'COMPLAINT', nameAr: 'شكوى', nameEn: 'Complaint' },
    { key: 'AVAILABILITY_CHECK', nameAr: 'فحص التوفر', nameEn: 'Availability Check' },
    { key: 'ORDER_FOLLOW_UP', nameAr: 'متابعة طلب', nameEn: 'Order Follow-Up' },
  ],
  BRANCH: [
    { key: 'PHARMACIST_BEHAVIOR', nameAr: 'سلوك الصيدلي', nameEn: 'Pharmacist Behavior' },
    { key: 'BRANCH_DUTY_HOURS', nameAr: 'ساعات عمل الفرع', nameEn: 'Branch Duty Hours' },
    { key: 'BRANCH_STRUCTURE', nameAr: 'هيكل الفرع', nameEn: 'Branch Structure' },
    { key: 'DISCOUNT', nameAr: 'الخصومات', nameEn: 'Discount' },
    { key: 'PRODUCTS', nameAr: 'المنتجات', nameEn: 'Products' },
    { key: 'RETURN_POLICY', nameAr: 'سياسة الاسترجاع', nameEn: 'Return Policy' },
    { key: 'PRICING', nameAr: 'التسعير', nameEn: 'Pricing' },
  ],
  // §13 gives no category list — one generic each; ops extend via catalog
  // config without deployments (online spec F2, ADR-008).
  ONLINE_ISSUE: [{ key: 'GENERAL', nameAr: 'مشكلة طلب', nameEn: 'General Issue' }],
  ONLINE_REQUEST: [{ key: 'GENERAL', nameAr: 'طلب خدمة', nameEn: 'General Request' }],
};

const URGENCIES = [
  { key: 'LOW', nameAr: 'منخفضة', nameEn: 'Low', color: '#10b981', order: 1 },
  { key: 'MODERATE', nameAr: 'متوسطة', nameEn: 'Moderate', color: '#f59e0b', order: 2 },
  { key: 'CRITICAL', nameAr: 'حرجة', nameEn: 'Critical', color: '#ef4444', order: 3 },
];

const STATUSES: {
  key: string;
  nameAr: string;
  nameEn: string;
  kind: StatusKind;
  color: string;
  order: number;
}[] = [
  { key: 'OPENED', nameAr: 'مفتوحة', nameEn: 'Opened', kind: 'OPEN', color: '#3b82f6', order: 1 },
  {
    key: 'PROCESSING',
    nameAr: 'قيد المعالجة',
    nameEn: 'Processing',
    kind: 'OPEN',
    color: '#8b5cf6',
    order: 2,
  },
  {
    key: 'ESCALATED',
    nameAr: 'مصعّدة',
    nameEn: 'Escalated',
    kind: 'OPEN',
    color: '#ef4444',
    order: 3,
  },
  {
    key: 'NEW_RESPONSE',
    nameAr: 'رد جديد',
    nameEn: 'New Response',
    kind: 'OPEN',
    color: '#eab308',
    order: 4,
  },
  {
    key: 'RE_OPENED',
    nameAr: 'معاد فتحها',
    nameEn: 'Re-opened',
    kind: 'OPEN',
    color: '#f97316',
    order: 5,
  },
  {
    key: 'COMPLETED',
    nameAr: 'مكتملة',
    nameEn: 'Completed',
    kind: 'RESOLVED',
    color: '#10b981',
    order: 6,
  },
  {
    key: 'CLOSED',
    nameAr: 'مغلقة',
    nameEn: 'Closed',
    kind: 'TERMINAL',
    color: '#6b7280',
    order: 7,
  },
];

/** Spec §5 transition matrix: [from, to, requiredPermissionKey?]. */
const TRANSITIONS: [string, string, string | null][] = [
  ['OPENED', 'PROCESSING', null], // auto on assign/take
  ['OPENED', 'ESCALATED', 'ticket.escalate'],
  ['OPENED', 'CLOSED', 'ticket.close'], // close-with-resolution
  ['PROCESSING', 'ESCALATED', 'ticket.escalate'],
  ['PROCESSING', 'COMPLETED', 'ticket.resolve'],
  ['ESCALATED', 'PROCESSING', null], // on assign/take
  ['ESCALATED', 'COMPLETED', 'ticket.resolve'],
  ['NEW_RESPONSE', 'PROCESSING', null],
  ['NEW_RESPONSE', 'ESCALATED', 'ticket.escalate'],
  ['NEW_RESPONSE', 'COMPLETED', 'ticket.resolve'],
  ['RE_OPENED', 'PROCESSING', null],
  ['RE_OPENED', 'ESCALATED', 'ticket.escalate'],
  ['RE_OPENED', 'COMPLETED', 'ticket.resolve'],
  ['COMPLETED', 'CLOSED', 'ticket.close'],
  ['COMPLETED', 'NEW_RESPONSE', null], // automatic on inbound response (A3)
  ['CLOSED', 'RE_OPENED', 'ticket.reopen'],
];

const UPDATE_TYPES = [
  { key: 'GENERAL_UPDATE', nameAr: 'تحديث عام', nameEn: 'General Update', order: 1 },
  { key: 'CUSTOMER_CONTACT', nameAr: 'تواصل مع العميل', nameEn: 'Customer Contact', order: 2 },
  { key: 'BRANCH_CONTACT', nameAr: 'تواصل مع الفرع', nameEn: 'Branch Contact', order: 3 },
  { key: 'INVESTIGATION', nameAr: 'تحقيق', nameEn: 'Investigation', order: 4 },
  { key: 'ORDER_REVIEW', nameAr: 'مراجعة الطلب', nameEn: 'Order Review', order: 5 },
  { key: 'PRODUCT_REVIEW', nameAr: 'مراجعة المنتج', nameEn: 'Product Review', order: 6 },
  { key: 'WAITING', nameAr: 'انتظار', nameEn: 'Waiting', order: 7, pausesSla: true },
  { key: 'ESCALATION', nameAr: 'تصعيد', nameEn: 'Escalation', order: 8 },
  { key: 'PROPOSED_SOLUTION', nameAr: 'حل مقترح', nameEn: 'Proposed Solution', order: 9 },
  { key: 'FINAL_RESOLUTION', nameAr: 'الحل النهائي', nameEn: 'Final Resolution', order: 10 },
];

/** Spec assumption A6 (approved). */
const RESOLUTION_CATEGORIES = [
  { key: 'RESOLVED_PRODUCT', nameAr: 'تم الحل — منتج', nameEn: 'Resolved – Product' },
  { key: 'RESOLVED_SERVICE', nameAr: 'تم الحل — خدمة', nameEn: 'Resolved – Service' },
  {
    key: 'RESOLVED_BRANCH_ACTION',
    nameAr: 'تم الحل — إجراء فرع',
    nameEn: 'Resolved – Branch Action',
  },
  { key: 'NOT_AN_ISSUE', nameAr: 'ليست مشكلة', nameEn: 'Not an Issue' },
  { key: 'DUPLICATE', nameAr: 'مكررة', nameEn: 'Duplicate' },
  {
    key: 'UNRESOLVABLE_EXTERNAL',
    nameAr: 'غير قابلة للحل — سبب خارجي',
    nameEn: 'Unresolvable – External',
  },
];

/** Default SLA minutes per urgency (first response / resolution). */
const SLA_DEFAULTS: Record<string, [number, number]> = {
  LOW: [240, 2880],
  MODERATE: [120, 1440],
  CRITICAL: [30, 240],
};

/** §9.9 directed-teams list — seeded as real teams under a system Routing department. */
const ROUTABLE_TEAMS = [
  { key: 'BRANCH_SUPERVISOR', nameAr: 'مشرف الفرع', nameEn: 'Branch Supervisor' },
  { key: 'OPERATION_LEADER', nameAr: 'قائد العمليات', nameEn: 'Operation Leader' },
  { key: 'OPERATION_SUPERVISOR', nameAr: 'مشرف العمليات', nameEn: 'Operation Supervisor' },
  { key: 'OPERATION_TEAM', nameAr: 'فريق العمليات', nameEn: 'Operation Team' },
  { key: 'CUSTOMER_CARE_LEADER', nameAr: 'قائد خدمة العملاء', nameEn: 'Customer Care Leader' },
  {
    key: 'CUSTOMER_CARE_SUPERVISOR',
    nameAr: 'مشرف خدمة العملاء',
    nameEn: 'Customer Care Supervisor',
  },
  { key: 'CUSTOMER_CARE_TEAM', nameAr: 'فريق خدمة العملاء', nameEn: 'Customer Care Team' },
  { key: 'CRM_LEADER', nameAr: 'قائد إدارة علاقات العملاء', nameEn: 'CRM Leader' },
  { key: 'CRM_SUPERVISOR', nameAr: 'مشرف إدارة علاقات العملاء', nameEn: 'CRM Supervisor' },
  { key: 'CRM_TEAM', nameAr: 'فريق إدارة علاقات العملاء', nameEn: 'CRM Team' },
  { key: 'MARKETING_LEADER', nameAr: 'قائد التسويق', nameEn: 'Marketing Leader' },
  { key: 'MARKETING_SUPERVISOR', nameAr: 'مشرف التسويق', nameEn: 'Marketing Supervisor' },
  { key: 'MARKETING_TEAM', nameAr: 'فريق التسويق', nameEn: 'Marketing Team' },
  { key: 'DELIVERY_SUPERVISOR', nameAr: 'مشرف التوصيل', nameEn: 'Delivery Supervisor' },
  { key: 'ONLINE_HUB', nameAr: 'المركز الإلكتروني', nameEn: 'Online Hub' },
];

async function seedRoutableTeams(prisma: PrismaClient) {
  const dept = await prisma.department.upsert({
    where: { code: 'ROUTING' },
    update: {},
    create: { code: 'ROUTING', nameAr: 'فرق التوجيه', nameEn: 'Routing Teams' },
  });
  for (const t of ROUTABLE_TEAMS) {
    const existing = await prisma.team.findFirst({
      where: { nameEn: t.nameEn, departmentId: dept.id },
    });
    if (!existing) {
      await prisma.team.create({
        data: { nameAr: t.nameAr, nameEn: t.nameEn, departmentId: dept.id },
      });
    }
  }
  console.log(`✔ routable teams (§9.9): ${ROUTABLE_TEAMS.length}`);
}

export async function seedTicketingCatalogs(prisma: PrismaClient) {
  await seedRoutableTeams(prisma);
  for (const t of TYPES) {
    await prisma.ticketType.upsert({
      where: { key: t.key },
      update: {},
      create: t,
    });
  }

  const types = new Map((await prisma.ticketType.findMany()).map((t) => [t.key, t.id] as const));

  for (const [typeKey, categories] of Object.entries(CATEGORIES)) {
    const typeId = types.get(typeKey);
    if (!typeId) continue;
    for (const [index, c] of categories.entries()) {
      await prisma.ticketCategory.upsert({
        where: { typeId_key: { typeId, key: c.key } },
        update: {},
        create: { ...c, typeId, order: index + 1 },
      });
    }
  }

  for (const u of URGENCIES) {
    await prisma.ticketUrgency.upsert({ where: { key: u.key }, update: {}, create: u });
  }
  for (const s of STATUSES) {
    await prisma.ticketStatus.upsert({ where: { key: s.key }, update: {}, create: s });
  }

  const statuses = new Map(
    (await prisma.ticketStatus.findMany()).map((s) => [s.key, s.id] as const),
  );
  for (const [from, to, permission] of TRANSITIONS) {
    const fromStatusId = statuses.get(from);
    const toStatusId = statuses.get(to);
    if (!fromStatusId || !toStatusId) continue;
    await prisma.statusTransition.upsert({
      where: { fromStatusId_toStatusId: { fromStatusId, toStatusId } },
      update: {},
      create: { fromStatusId, toStatusId, requiredPermissionKey: permission },
    });
  }

  for (const u of UPDATE_TYPES) {
    await prisma.updateType.upsert({ where: { key: u.key }, update: {}, create: u });
  }
  for (const r of RESOLUTION_CATEGORIES) {
    await prisma.resolutionCategory.upsert({ where: { key: r.key }, update: {}, create: r });
  }

  const urgencies = await prisma.ticketUrgency.findMany();
  for (const typeId of types.values()) {
    for (const urgency of urgencies) {
      const defaults = SLA_DEFAULTS[urgency.key];
      if (!defaults) continue;
      await prisma.slaPolicy.upsert({
        where: { typeId_urgencyId: { typeId, urgencyId: urgency.id } },
        update: {},
        create: {
          typeId,
          urgencyId: urgency.id,
          firstResponseMinutes: defaults[0],
          resolutionMinutes: defaults[1],
        },
      });
    }
  }

  console.log(
    '✔ ticketing catalogs: types, categories, urgencies, statuses, transitions, update types, resolution categories, SLA policies',
  );
}
