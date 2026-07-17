/**
 * Idempotent seed — safe to run repeatedly (upserts only).
 *
 * Seeds:
 *  1. Permission catalog from @milaserv/contracts (single source of truth).
 *  2. The 10 system roles (blueprint §6) with conservative default grants —
 *     editable later through the Roles admin screen; never deleted here.
 *  3. Default business settings (Configuration over Code, ADR-008).
 *  4. First Super Admin from SEED_ADMIN_EMAIL/PASSWORD (forced password change).
 */
import { PrismaClient, DataScope } from '@prisma/client';
import * as argon2 from 'argon2';
import { PERMISSIONS, PERMISSION_KEYS, SYSTEM_ROLES } from '@milaserv/contracts';
import type { PermissionKey, SystemRoleKey } from '@milaserv/contracts';
import { seedTicketingCatalogs } from './ticketing';
import { seedPerformanceCatalog } from './performance';
import { seedCrmCatalogs } from './crm';
import { seedOnlineCatalogs } from './online';
import { seedBranchTypes } from './branches';
import { seedDicCatalogs } from './dic';

const prisma = new PrismaClient();

const ROLE_NAMES: Record<SystemRoleKey, { ar: string; en: string }> = {
  SUPER_ADMIN: { ar: 'مدير النظام الأعلى', en: 'Super Admin' },
  PLATFORM_ADMIN: { ar: 'مدير المنصة', en: 'Platform Admin' },
  BUSINESS_EXCELLENCE_MANAGER: { ar: 'مدير التميز المؤسسي', en: 'Business Excellence Manager' },
  TEAM_MANAGER: { ar: 'مدير فريق', en: 'Team Manager' },
  TEAM_LEADER: { ar: 'قائد فريق', en: 'Team Leader' },
  SUPERVISOR: { ar: 'مشرف', en: 'Supervisor' },
  AGENT: { ar: 'موظف', en: 'Agent / Employee' },
  READ_ONLY: { ar: 'مستخدم قراءة فقط', en: 'Read-Only User' },
  QUALITY_REVIEWER: { ar: 'مراجع جودة', en: 'Quality Reviewer' },
  INTEGRATION_SUPPORT: { ar: 'دعم التكاملات', en: 'Integration Support User' },
};

/** Default grants: [permissionKey, dataScope]. Conservative; adjustable in the UI. */
const ROLE_GRANTS: Record<SystemRoleKey, [PermissionKey, DataScope][]> = {
  SUPER_ADMIN: PERMISSION_KEYS.map((k) => [k, DataScope.ALL_DATA]),
  PLATFORM_ADMIN: PERMISSION_KEYS.map((k) => [k, DataScope.ALL_DATA]),
  BUSINESS_EXCELLENCE_MANAGER: [
    ['user.view', DataScope.ALL_DATA],
    ['department.view', DataScope.ALL_DATA],
    ['team.view', DataScope.ALL_DATA],
    ['audit.view', DataScope.ALL_DATA],
    ['setting.view', DataScope.ALL_DATA],
    ['integration.monitor', DataScope.ALL_DATA],
    ['dic.view', DataScope.ALL_DATA],
    ['dic.approve', DataScope.ALL_DATA],
    ['ocr.view', DataScope.ALL_DATA],
    ['ocr.review', DataScope.ALL_DATA],
  ],
  TEAM_MANAGER: [
    ['user.view', DataScope.DEPARTMENT],
    ['department.view', DataScope.DEPARTMENT],
    ['team.view', DataScope.DEPARTMENT],
    ['team.manage_members', DataScope.DEPARTMENT],
    // ticketing (spec §8 defaults)
    ['ticket.view', DataScope.DEPARTMENT],
    ['ticket.create', DataScope.DEPARTMENT],
    ['ticket.edit', DataScope.DEPARTMENT],
    ['ticket.assign', DataScope.DEPARTMENT],
    ['ticket.take_responsibility', DataScope.DEPARTMENT],
    ['ticket.redirect', DataScope.DEPARTMENT],
    ['ticket.update_add', DataScope.DEPARTMENT],
    ['ticket.resolve', DataScope.DEPARTMENT],
    ['ticket.close', DataScope.DEPARTMENT],
    ['ticket.reopen', DataScope.DEPARTMENT],
    ['ticket.escalate', DataScope.DEPARTMENT],
    ['ticket.export', DataScope.DEPARTMENT],
    ['branch.view', DataScope.DEPARTMENT],
    ['kb.view', DataScope.DEPARTMENT],
    ['kb.assign', DataScope.DEPARTMENT],
    ['break.track', DataScope.MY_RECORDS],
    ['break.viewTeam', DataScope.DEPARTMENT],
    ['performance.view', DataScope.DEPARTMENT],
    ['performance.manage', DataScope.DEPARTMENT],
    ['crm.view', DataScope.DEPARTMENT],
    ['crm.work', DataScope.DEPARTMENT],
    ['crm.upload', DataScope.DEPARTMENT],
    ['online.view', DataScope.DEPARTMENT],
    ['dic.view', DataScope.DEPARTMENT],
    ['dic.manage', DataScope.DEPARTMENT],
    ['dic.approve', DataScope.DEPARTMENT],
    ['ocr.view', DataScope.DEPARTMENT],
    ['ocr.upload', DataScope.MY_RECORDS],
    ['ocr.review', DataScope.DEPARTMENT],
  ],
  TEAM_LEADER: [
    ['user.view', DataScope.MY_TEAM],
    ['team.view', DataScope.MY_TEAM],
    ['ticket.view', DataScope.MY_TEAM],
    ['ticket.create', DataScope.MY_TEAM],
    ['ticket.assign', DataScope.MY_TEAM],
    ['ticket.take_responsibility', DataScope.MY_TEAM],
    ['ticket.redirect', DataScope.MY_TEAM],
    ['ticket.update_add', DataScope.MY_TEAM],
    ['ticket.resolve', DataScope.MY_TEAM],
    ['ticket.escalate', DataScope.MY_TEAM],
    ['branch.view', DataScope.MY_TEAM],
    ['kb.view', DataScope.MY_TEAM],
    ['break.track', DataScope.MY_RECORDS],
    ['break.viewTeam', DataScope.MY_TEAM],
    ['performance.view', DataScope.MY_TEAM],
    ['crm.view', DataScope.MY_TEAM],
    ['crm.work', DataScope.MY_TEAM],
    ['online.view', DataScope.MY_TEAM],
    ['dic.view', DataScope.MY_TEAM],
  ],
  SUPERVISOR: [
    ['user.view', DataScope.MY_TEAM],
    ['team.view', DataScope.MY_TEAM],
    ['ticket.view', DataScope.MY_TEAM],
    ['ticket.create', DataScope.MY_TEAM],
    ['ticket.assign', DataScope.MY_TEAM],
    ['ticket.take_responsibility', DataScope.MY_TEAM],
    ['ticket.update_add', DataScope.MY_TEAM],
    ['ticket.resolve', DataScope.MY_TEAM],
    ['ticket.escalate', DataScope.MY_TEAM],
    ['branch.view', DataScope.MY_TEAM],
    ['kb.view', DataScope.MY_TEAM],
    ['break.track', DataScope.MY_RECORDS],
    ['break.viewTeam', DataScope.MY_TEAM],
    ['performance.view', DataScope.MY_TEAM],
    ['crm.view', DataScope.MY_TEAM],
    ['crm.work', DataScope.MY_TEAM],
    ['online.view', DataScope.MY_TEAM],
    ['dic.view', DataScope.MY_TEAM],
    ['ocr.view', DataScope.MY_TEAM],
    ['ocr.upload', DataScope.MY_RECORDS],
  ],
  AGENT: [
    ['ticket.view', DataScope.MY_RECORDS],
    ['ticket.create', DataScope.MY_RECORDS],
    ['ticket.take_responsibility', DataScope.MY_RECORDS],
    ['ticket.update_add', DataScope.MY_RECORDS],
    ['branch.view', DataScope.MY_RECORDS],
    ['kb.view', DataScope.MY_RECORDS],
    ['break.track', DataScope.MY_RECORDS],
    ['performance.view', DataScope.MY_RECORDS],
    ['crm.view', DataScope.MY_RECORDS],
    ['crm.work', DataScope.MY_RECORDS],
    ['online.view', DataScope.MY_TEAM],
    ['dic.view', DataScope.MY_RECORDS],
    ['ocr.view', DataScope.MY_RECORDS],
    ['ocr.upload', DataScope.MY_RECORDS],
  ],
  READ_ONLY: [
    ['department.view', DataScope.DEPARTMENT],
    ['team.view', DataScope.DEPARTMENT],
    ['ticket.view', DataScope.DEPARTMENT],
    ['kb.view', DataScope.DEPARTMENT],
  ],
  QUALITY_REVIEWER: [
    ['audit.view', DataScope.DEPARTMENT],
    ['ticket.view', DataScope.DEPARTMENT],
  ],
  INTEGRATION_SUPPORT: [
    ['performance.ingest', DataScope.ALL_DATA],
    ['online.ingest', DataScope.ALL_DATA],
    ['online.view', DataScope.ALL_DATA],
    ['integration.monitor', DataScope.ALL_DATA],
    ['dic.manage', DataScope.ALL_DATA],
    ['dic.view', DataScope.ALL_DATA],
    ['ocr.view', DataScope.ALL_DATA],
  ],
};

interface DefaultSetting {
  key: string;
  category: string;
  valueType: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON';
  value: unknown;
  labelAr: string;
  labelEn: string;
}

const DEFAULT_SETTINGS: DefaultSetting[] = [
  {
    key: 'general.platform_name',
    category: 'general',
    valueType: 'JSON',
    value: { ar: 'ميلاسيرف 360', en: 'Milaserv360' },
    labelAr: 'اسم المنصة',
    labelEn: 'Platform name',
  },
  {
    key: 'general.default_locale',
    category: 'general',
    valueType: 'STRING',
    value: 'ar',
    labelAr: 'اللغة الافتراضية',
    labelEn: 'Default locale',
  },
  {
    key: 'notifications.in_app_enabled',
    category: 'notifications',
    valueType: 'BOOLEAN',
    value: true,
    labelAr: 'تفعيل الإشعارات داخل التطبيق',
    labelEn: 'Enable in-app notifications',
  },
  {
    key: 'notifications.email_enabled',
    category: 'notifications',
    valueType: 'BOOLEAN',
    value: false,
    labelAr: 'تفعيل إشعارات البريد الإلكتروني',
    labelEn: 'Enable email notifications',
  },
  // Ticketing spec §2 — number generator formats (ADR-008)
  {
    key: 'ticketing.number.internal_format',
    category: 'ticketing',
    valueType: 'STRING',
    value: 'TKT-{YYYY}-{SEQ:6}',
    labelAr: 'صيغة الرقم الداخلي للتذكرة',
    labelEn: 'Internal ticket number format',
  },
  {
    key: 'ticketing.number.customer_format',
    category: 'ticketing',
    valueType: 'STRING',
    value: 'CC-{YYYY}-{SEQ:6}',
    labelAr: 'صيغة رقم شكوى العميل',
    labelEn: 'Customer complaint number format',
  },
  // Branch routing fallback (spec §9.8)
  {
    key: 'ticketing.branch.no_supervisor_route',
    category: 'ticketing',
    valueType: 'STRING',
    value: 'UNASSIGNED_QUEUE',
    labelAr: 'مسار التوجيه عند غياب مشرف الفرع',
    labelEn: 'Routing when branch has no supervisor',
  },
  // Attachment engine (spec A7)
  {
    key: 'attachments.max_size_mb',
    category: 'attachments',
    valueType: 'NUMBER',
    value: 10,
    labelAr: 'الحد الأقصى لحجم المرفق (ميجابايت)',
    labelEn: 'Maximum attachment size (MB)',
  },
  {
    key: 'attachments.allowed_mime',
    category: 'attachments',
    valueType: 'JSON',
    value: [
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
    ],
    labelAr: 'أنواع الملفات المسموح بها',
    labelEn: 'Allowed attachment types',
  },
  // Break Tracker (blueprint §11, spec §10 — assumptions C1–C6)
  {
    key: 'break.idle_threshold_seconds',
    category: 'breaks',
    valueType: 'NUMBER',
    value: 300,
    labelAr: 'عتبة الخمول (ثوانٍ)',
    labelEn: 'Idle threshold (seconds)',
  },
  {
    key: 'break.daily_allowance_minutes',
    category: 'breaks',
    valueType: 'NUMBER',
    value: 60,
    labelAr: 'رصيد البريك اليومي (دقائق)',
    labelEn: 'Daily break allowance (minutes)',
  },
  {
    key: 'break.max_concurrent_per_team',
    category: 'breaks',
    valueType: 'NUMBER',
    value: 2,
    labelAr: 'الحد الأقصى للموظفين في بريك بنفس الفريق (0 = بلا حد)',
    labelEn: 'Max concurrent employees on break per team (0 = unlimited)',
  },
  {
    key: 'break.offline_threshold_seconds',
    category: 'breaks',
    valueType: 'NUMBER',
    value: 180,
    labelAr: 'عتبة اعتبار الموظف Offline (ثوانٍ بدون heartbeat)',
    labelEn: 'Offline threshold (seconds without heartbeat)',
  },
  {
    key: 'break.notify_on_overage',
    category: 'breaks',
    valueType: 'BOOLEAN',
    value: true,
    labelAr: 'إشعار الموظف والمشرف عند تجاوز رصيد البريك',
    labelEn: 'Notify employee & supervisor on break overage',
  },
  {
    key: 'break.heartbeat_interval_seconds',
    category: 'breaks',
    valueType: 'NUMBER',
    value: 60,
    labelAr: 'فاصل إرسال نبضات النشاط من المتصفح (ثوانٍ)',
    labelEn: 'Client activity heartbeat interval (seconds)',
  },
  {
    key: 'break.session_auto_end_hours',
    category: 'breaks',
    valueType: 'NUMBER',
    value: 12,
    labelAr: 'إنهاء الجلسة تلقائيًا بعد انقطاع النبضات (ساعات)',
    labelEn: 'Auto-end session after heartbeat silence (hours)',
  },
  // Customer Care performance (blueprint §12.2, spec D4/D5)
  {
    key: 'performance.green_from_pct',
    category: 'performance',
    valueType: 'NUMBER',
    value: 100,
    labelAr: 'نسبة الإنجاز التي تبدأ عندها الحالة الخضراء (%)',
    labelEn: 'Achievement % from which state is green',
  },
  {
    key: 'performance.amber_from_pct',
    category: 'performance',
    valueType: 'NUMBER',
    value: 80,
    labelAr: 'نسبة الإنجاز التي تبدأ عندها الحالة الكهرمانية (%)',
    labelEn: 'Achievement % from which state is amber',
  },
  {
    key: 'performance.trend_flat_pct',
    category: 'performance',
    valueType: 'NUMBER',
    value: 2,
    labelAr: 'هامش اعتبار الاتجاه ثابتًا (%)',
    labelEn: 'Tolerance for flat trend (%)',
  },
  // CRM & Telesales (blueprint §14, spec E7)
  {
    key: 'crm.order.number_format',
    category: 'crm',
    valueType: 'STRING',
    value: 'ORD-{YYYY}-{SEQ:6}',
    labelAr: 'صيغة رقم طلب التيليسيلز',
    labelEn: 'Telesales order number format',
  },
  // Integration Layer (blueprint §13 note, §21.1 — online spec F5)
  {
    key: 'integrations.ordering.endpoint',
    category: 'integrations',
    valueType: 'STRING',
    value: '',
    labelAr: 'عنوان تكامل نظام الطلبات (يملؤه الموصّل)',
    labelEn: 'Ordering System integration endpoint (set by the connector)',
  },
  {
    key: 'integrations.ordering.outbound_enabled',
    category: 'integrations',
    valueType: 'BOOLEAN',
    value: false,
    labelAr: 'تفعيل المزامنة الصادرة لنظام الطلبات',
    labelEn: 'Enable outbound sync to the Ordering System',
  },
  {
    key: 'integrations.retry.max_attempts',
    category: 'integrations',
    valueType: 'NUMBER',
    value: 5,
    labelAr: 'الحد الأقصى لمحاولات إعادة التكامل',
    labelEn: 'Max integration retry attempts',
  },
  {
    key: 'integrations.retry.base_delay_seconds',
    category: 'integrations',
    valueType: 'NUMBER',
    value: 60,
    labelAr: 'التأخير الأساسي بين المحاولات (ثوانٍ، يتضاعف)',
    labelEn: 'Base retry delay (seconds, doubles per attempt)',
  },
  // Branch Center (blueprint §16.3, branch-center spec G5)
  {
    key: 'branch.locator.max_results',
    category: 'branches',
    valueType: 'NUMBER',
    value: 5,
    labelAr: 'عدد الفروع في نتائج تحديد الأقرب',
    labelEn: 'Locator result count',
  },
  {
    key: 'branch.delivery.base_minutes',
    category: 'branches',
    valueType: 'NUMBER',
    value: 15,
    labelAr: 'زمن التجهيز الأساسي للتوصيل (دقائق)',
    labelEn: 'Delivery base preparation time (minutes)',
  },
  {
    key: 'branch.delivery.minutes_per_km',
    category: 'branches',
    valueType: 'NUMBER',
    value: 3,
    labelAr: 'دقائق التوصيل لكل كيلومتر',
    labelEn: 'Delivery minutes per kilometre',
  },
  {
    key: 'branch.delivery.max_km',
    category: 'branches',
    valueType: 'NUMBER',
    value: 15,
    labelAr: 'أقصى مسافة توصيل (كم)',
    labelEn: 'Maximum delivery distance (km)',
  },
  // DIC (blueprint §15, spec H2)
  {
    key: 'dic.import.chunk_size',
    category: 'dic',
    valueType: 'NUMBER',
    value: 2000,
    labelAr: 'حجم دفعة استيراد الأدوية (صفوف)',
    labelEn: 'Drug import chunk size (rows)',
  },
  // OCR spec §5 (blueprint §17 + §21)
  {
    key: 'integrations.ocr.endpoint',
    category: 'integrations',
    valueType: 'STRING',
    value: '',
    labelAr: 'رابط محرك التعرف الضوئي على الوصفات',
    labelEn: 'OCR engine endpoint',
  },
  {
    key: 'ocr.number.format',
    category: 'ocr',
    valueType: 'STRING',
    value: 'PRX-{YYYY}-{SEQ:6}',
    labelAr: 'صيغة رقم الوصفة',
    labelEn: 'Prescription number format',
  },
  {
    key: 'ocr.review.min_confidence',
    category: 'ocr',
    valueType: 'NUMBER',
    value: 0.6,
    labelAr: 'الحد الأدنى للثقة قبل تنبيه المراجع',
    labelEn: 'Minimum confidence before flagging for review',
  },
];

async function seedPermissions() {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, labelAr: p.label.ar, labelEn: p.label.en },
      create: { key: p.key, module: p.module, labelAr: p.label.ar, labelEn: p.label.en },
    });
  }
  console.log(`✔ permissions: ${PERMISSIONS.length}`);
}

async function seedRoles() {
  const permsByKey = new Map(
    (await prisma.permission.findMany()).map((p) => [p.key, p.id] as const),
  );

  for (const key of SYSTEM_ROLES) {
    const names = ROLE_NAMES[key];
    const role = await prisma.role.upsert({
      where: { key },
      update: { nameAr: names.ar, nameEn: names.en, isSystem: true },
      create: { key, nameAr: names.ar, nameEn: names.en, isSystem: true },
    });

    for (const [permKey, dataScope] of ROLE_GRANTS[key]) {
      const permissionId = permsByKey.get(permKey);
      if (!permissionId) throw new Error(`Unknown permission key in seed: ${permKey}`);
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        // Do not overwrite scopes an admin may have changed in the UI.
        update: {},
        create: { roleId: role.id, permissionId, dataScope },
      });
    }
  }
  console.log(`✔ system roles: ${SYSTEM_ROLES.length}`);
}

async function seedSettings() {
  for (const s of DEFAULT_SETTINGS) {
    await prisma.setting.upsert({
      where: { key_scopeLevel_scopeId: { key: s.key, scopeLevel: 'SYSTEM', scopeId: '' } },
      // Do not overwrite values an admin may have changed.
      update: { labelAr: s.labelAr, labelEn: s.labelEn },
      create: {
        key: s.key,
        category: s.category,
        valueType: s.valueType,
        value: s.value as never,
        scopeLevel: 'SYSTEM',
        labelAr: s.labelAr,
        labelEn: s.labelEn,
      },
    });
  }
  console.log(`✔ default settings: ${DEFAULT_SETTINGS.length}`);
}

async function seedSuperAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('… SEED_ADMIN_EMAIL/PASSWORD not set — skipping admin creation');
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`✔ super admin exists: ${email}`);
    return;
  }

  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash(password),
      nameAr: 'مدير النظام',
      nameEn: 'System Administrator',
      mustChangePassword: true,
      roles: { create: { roleId: role.id } },
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'user.seed',
      entityType: 'user',
      entityId: user.id,
      after: { email, roles: ['SUPER_ADMIN'] },
    },
  });
  console.log(`✔ super admin created: ${email} (must change password on first login)`);
}

async function main() {
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  await seedTicketingCatalogs(prisma);
  await seedPerformanceCatalog(prisma);
  await seedCrmCatalogs(prisma);
  await seedOnlineCatalogs(prisma);
  await seedBranchTypes(prisma);
  await seedDicCatalogs(prisma);
  await seedSuperAdmin();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
