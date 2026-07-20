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
import { seedBranchTypes, seedBranchCapabilities } from './branches';
import { seedDicCatalogs } from './dic';
import { seedDicReferenceData } from './dic-reference';
import { seedLocationHierarchy } from './locations';

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
    // Phase 4 — DIC Drug Master & Normalization Foundation
    ['dic.pharmacist_review', DataScope.ALL_DATA],
    ['dic.approve_alias', DataScope.ALL_DATA],
    ['dic.approve_alternative', DataScope.ALL_DATA],
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
    ['location.view', DataScope.DEPARTMENT],
    ['inventory.view', DataScope.DEPARTMENT],
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
    // Phase 4 — DIC Drug Master & Normalization Foundation
    ['dic.edit', DataScope.DEPARTMENT],
    ['dic.approve_alias', DataScope.DEPARTMENT],
    ['dic.approve_alternative', DataScope.DEPARTMENT],
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
    ['location.view', DataScope.MY_TEAM],
    ['inventory.view', DataScope.MY_TEAM],
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
    ['location.view', DataScope.MY_TEAM],
    ['inventory.view', DataScope.MY_TEAM],
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
    ['location.view', DataScope.MY_RECORDS],
    ['inventory.view', DataScope.MY_RECORDS],
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
    // Phase 4 — DIC Drug Master & Normalization Foundation
    ['dic.import_staged', DataScope.ALL_DATA],
    ['ocr.view', DataScope.ALL_DATA],
    // Phase 6 — Location-Aware Branch Inventory & Fulfillment
    ['inventory.view', DataScope.ALL_DATA],
    ['inventory.sync', DataScope.ALL_DATA],
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
  // Phase 6 — Location-Aware Branch Inventory & Fulfillment
  {
    key: 'inventory.cache.ttl_seconds',
    category: 'inventory',
    valueType: 'NUMBER',
    value: 120,
    labelAr: 'مدة صلاحية ذاكرة التخزين المؤقت للمخزون (ثوانٍ)',
    labelEn: 'Inventory cache TTL (seconds)',
  },
  {
    key: 'inventory.freshness.fresh_minutes',
    category: 'inventory',
    valueType: 'NUMBER',
    value: 15,
    labelAr: 'الحد الأقصى (دقائق) لاعتبار المخزون "حديثًا"',
    labelEn: 'Maximum age (minutes) for inventory to count as FRESH',
  },
  {
    key: 'inventory.freshness.acceptable_minutes',
    category: 'inventory',
    valueType: 'NUMBER',
    value: 120,
    labelAr: 'الحد الأقصى (دقائق) لاعتبار المخزون "مقبولاً"',
    labelEn: 'Maximum age (minutes) for inventory to count as ACCEPTABLE (older is STALE)',
  },
  // Phase 6 §19/§21 — fulfillment ranking weights/thresholds. Weights
  // sum to 1.0 by design; businessWeight is neutral (always scores 50)
  // since no business-priority signal exists in this platform yet.
  {
    key: 'fulfillment.ranking.location_weight',
    category: 'fulfillment',
    valueType: 'NUMBER',
    value: 0.3,
    labelAr: 'وزن قرب الموقع في ترتيب الفروع',
    labelEn: 'Location proximity weight in branch ranking',
  },
  {
    key: 'fulfillment.ranking.inventory_weight',
    category: 'fulfillment',
    valueType: 'NUMBER',
    value: 0.4,
    labelAr: 'وزن اكتمال المخزون في ترتيب الفروع',
    labelEn: 'Inventory completeness weight in branch ranking',
  },
  {
    key: 'fulfillment.ranking.operational_weight',
    category: 'fulfillment',
    valueType: 'NUMBER',
    value: 0.15,
    labelAr: 'وزن الجاهزية التشغيلية في ترتيب الفروع',
    labelEn: 'Operational readiness weight in branch ranking',
  },
  {
    key: 'fulfillment.ranking.business_weight',
    category: 'fulfillment',
    valueType: 'NUMBER',
    value: 0.15,
    labelAr: 'الوزن التجاري (محايد حاليًا) في ترتيب الفروع',
    labelEn: 'Business-priority weight (neutral until a business signal exists)',
  },
  {
    key: 'fulfillment.ranking.stale_inventory_penalty',
    category: 'fulfillment',
    valueType: 'NUMBER',
    value: 15,
    labelAr: 'خصم النقاط عند وجود مخزون قديم',
    labelEn: 'Score penalty for stale inventory',
  },
  {
    key: 'fulfillment.ranking.unknown_inventory_penalty',
    category: 'fulfillment',
    valueType: 'NUMBER',
    value: 10,
    labelAr: 'خصم النقاط عند عدم معرفة حالة المخزون',
    labelEn: 'Score penalty for unknown inventory freshness',
  },
  {
    key: 'fulfillment.ranking.split_penalty_per_extra_branch',
    category: 'fulfillment',
    valueType: 'NUMBER',
    value: 8,
    labelAr: 'خصم النقاط لكل فرع إضافي في خطة التوزيع',
    labelEn: 'Score penalty per extra branch in a split plan',
  },
  {
    key: 'fulfillment.ranking.max_relevant_distance_km',
    category: 'fulfillment',
    valueType: 'NUMBER',
    value: 20,
    labelAr: 'أقصى مسافة (كم) تُحتسب في نقاط الموقع',
    labelEn: 'Distance (km) at which the location score decays to zero',
  },
  {
    key: 'fulfillment.ranking.complete_coverage_bonus',
    category: 'fulfillment',
    valueType: 'NUMBER',
    value: 10,
    labelAr: 'نقاط إضافية عند تغطية الوصفة بالكامل من فرع واحد',
    labelEn: 'Bonus score for a plan that fully covers the prescription',
  },
  {
    key: 'fulfillment.ranking.max_split_branches',
    category: 'fulfillment',
    valueType: 'NUMBER',
    value: 3,
    labelAr: 'أقصى عدد فروع في خطة التوزيع',
    labelEn: 'Maximum number of branches in a split fulfillment plan',
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
  // §21 connectors (integrations spec J1–J7)
  {
    key: 'integrations.yeastar.inbound_token',
    category: 'integrations',
    valueType: 'STRING',
    value: '',
    labelAr: 'رمز استقبال أحداث Yeastar (فارغ = معطل)',
    labelEn: 'Yeastar inbound webhook token (empty = disabled)',
  },
  {
    key: 'integrations.ordering.inbound_token',
    category: 'integrations',
    valueType: 'STRING',
    value: '',
    labelAr: 'رمز استقبال طلبات نظام الطلبات (فارغ = معطل)',
    labelEn: 'Ordering inbound webhook token (empty = disabled)',
  },
  {
    key: 'integrations.dbs.enabled',
    category: 'integrations',
    valueType: 'BOOLEAN',
    value: false,
    labelAr: 'تفعيل ربط DBS (عند اعتماد الربط)',
    labelEn: 'Enable DBS link (when approved)',
  },
  {
    key: 'integrations.dbs.endpoint',
    category: 'integrations',
    valueType: 'STRING',
    value: '',
    labelAr: 'رابط جسر DBS',
    labelEn: 'DBS bridge endpoint',
  },
  {
    key: 'integrations.email.endpoint',
    category: 'integrations',
    valueType: 'STRING',
    value: '',
    labelAr: 'رابط جسر البريد الإلكتروني (SMTP)',
    labelEn: 'Email (SMTP relay) endpoint',
  },
  {
    key: 'integrations.sms.enabled',
    category: 'integrations',
    valueType: 'BOOLEAN',
    value: false,
    labelAr: 'تفعيل رسائل SMS لدورة الشكوى',
    labelEn: 'Enable complaint-lifecycle SMS',
  },
  {
    key: 'integrations.sms.endpoint',
    category: 'integrations',
    valueType: 'STRING',
    value: '',
    labelAr: 'رابط بوابة SMS',
    labelEn: 'SMS gateway endpoint',
  },
  {
    key: 'integrations.maps.endpoint',
    category: 'integrations',
    valueType: 'STRING',
    value: '',
    labelAr: 'رابط خدمة المسافات (فارغ = خط مستقيم)',
    labelEn: 'Maps distance endpoint (empty = straight line)',
  },
  {
    key: 'sms.template.created',
    category: 'sms',
    valueType: 'STRING',
    value:
      'عزيزنا {name}، تم تسجيل شكواكم برقم {number} وسيتم التواصل معكم قريبًا. الصيدلية المتحدة',
    labelAr: 'نص رسالة تسجيل الشكوى',
    labelEn: 'SMS template: complaint created',
  },
  {
    key: 'sms.template.resolved',
    category: 'sms',
    valueType: 'STRING',
    value: 'عزيزنا {name}، تم حل شكواكم رقم {number}. شكرًا لتواصلكم مع الصيدلية المتحدة',
    labelAr: 'نص رسالة حل الشكوى',
    labelEn: 'SMS template: complaint resolved',
  },
  // AI readiness (blueprint §2.1, ai-readiness spec K2)
  {
    key: 'ai.policy.approved',
    category: 'ai',
    valueType: 'BOOLEAN',
    value: false,
    labelAr: 'اعتماد سياسة مشاركة البيانات مع الذكاء الاصطناعي',
    labelEn: 'AI data-sharing policy approved',
  },
  {
    key: 'integrations.ai.endpoint',
    category: 'integrations',
    valueType: 'STRING',
    value: '',
    labelAr: 'رابط جسر الذكاء الاصطناعي',
    labelEn: 'AI bridge endpoint',
  },
  {
    key: 'sms.template.csat',
    category: 'sms',
    valueType: 'STRING',
    value: 'نسعد بتقييمكم لخدمتنا في الشكوى رقم {number}: https://s.example.com/csat/{number}',
    labelAr: 'نص رسالة استبيان الرضا (CSAT)',
    labelEn: 'SMS template: CSAT survey',
  },
  // CR-001 Prescription Intelligence Engine — Sprint OCR-01
  // (docs/change-requests/CR-001-prescription-intelligence-engine.md)
  {
    key: 'prescriptions.upload.max_size_mb',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 15,
    labelAr: 'الحد الأقصى لحجم ملف الوصفة (ميجابايت)',
    labelEn: 'Max prescription file size (MB)',
  },
  {
    key: 'prescriptions.upload.allowed_mime',
    category: 'prescriptions',
    valueType: 'JSON',
    value: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    labelAr: 'أنواع الملفات المسموح بها للوصفات',
    labelEn: 'Allowed prescription file types',
  },
  {
    key: 'prescriptions.ocr_service.endpoint',
    category: 'prescriptions',
    valueType: 'STRING',
    value: '',
    labelAr: 'رابط خدمة التعرف الضوئي على الوصفات (Python)',
    labelEn: 'Prescription OCR service endpoint (Python)',
  },
  {
    // Naming note: design spec §8.1 names the full 5-threshold engine's
    // key `ocr.image.quality_minimum` — that engine ships in a later
    // sprint (OCR-07) and may consolidate this key under that scheme.
    key: 'prescriptions.ocr.quality_minimum',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 0.4,
    labelAr: 'الحد الأدنى لجودة صورة الوصفة قبل رفضها لإعادة الرفع',
    labelEn: 'Minimum prescription image quality before requiring re-upload',
  },
  // CR-001 Sprint OCR-02 — Image Processing & Quality Engine
  // (Milaserv360 OCR Phase 2). All thresholds configurable per ADR-008 —
  // none of the values below are hard-coded in the pipeline.
  {
    key: 'prescriptions.preprocessing.min_image_width',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 300,
    labelAr: 'الحد الأدنى لعرض صورة الوصفة (بكسل)',
    labelEn: 'MIN_IMAGE_WIDTH — minimum prescription image width (px)',
  },
  {
    key: 'prescriptions.preprocessing.min_image_height',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 300,
    labelAr: 'الحد الأدنى لارتفاع صورة الوصفة (بكسل)',
    labelEn: 'MIN_IMAGE_HEIGHT — minimum prescription image height (px)',
  },
  {
    key: 'prescriptions.preprocessing.min_quality_score',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 50,
    labelAr: 'الحد الأدنى لدرجة جودة الصورة (٠-١٠٠) قبل طلب إعادة الرفع',
    labelEn:
      'MIN_QUALITY_SCORE — minimum final quality score (0-100) before IMAGE_REUPLOAD_REQUIRED',
  },
  {
    key: 'prescriptions.preprocessing.max_rotation_degrees',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 45,
    labelAr: 'الحد الأقصى لزاوية الدوران المقبولة (درجة)',
    labelEn: 'MAX_ROTATION — maximum rotation angle tolerated (degrees)',
  },
  {
    key: 'prescriptions.preprocessing.min_contrast',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 20,
    labelAr: 'الحد الأدنى للتباين (انحراف معياري لشدة الرمادي ٠-٢٥٥)',
    labelEn: 'MIN_CONTRAST — minimum grayscale intensity std-dev (0-255)',
  },
  {
    key: 'prescriptions.preprocessing.max_noise',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 15,
    labelAr: 'الحد الأقصى لمستوى التشويش (٠-٢٥٥)',
    labelEn: 'MAX_NOISE — maximum estimated noise level (0-255)',
  },
  {
    key: 'prescriptions.preprocessing.enabled_processors',
    category: 'prescriptions',
    valueType: 'JSON',
    value: {
      validation: true,
      qualityScoring: true,
      blurDetection: true,
      brightnessAnalysis: true,
      contrastAnalysis: true,
      noiseEstimation: true,
      orientationDetection: true,
      autoRotation: true,
      perspectiveCorrection: true,
      edgeDetection: true,
      autoCrop: true,
      backgroundCleanup: true,
      shadowRemoval: true,
      contrastEnhancement: true,
      sharpening: true,
      grayscale: true,
      binarization: true,
    },
    labelAr: 'تفعيل/تعطيل كل معالج من معالجات تحسين الصورة على حدة',
    labelEn: 'Per-processor enable/disable flags for the image-preprocessing pipeline',
  },
  {
    key: 'prescriptions.preprocessing.version',
    category: 'prescriptions',
    valueType: 'STRING',
    value: '1.0.0',
    labelAr: 'إصدار خوارزمية تحسين الصورة',
    labelEn: 'Preprocessing pipeline/algorithm version tag',
  },
  // CR-001 Sprint OCR-02 Extension — Universal Image Intake & Drag-and-
  // Drop Upload. All thresholds configurable per ADR-008.
  {
    key: 'prescriptions.region_detection.enabled',
    category: 'prescriptions',
    valueType: 'BOOLEAN',
    value: true,
    labelAr: 'تفعيل كشف منطقة الوصفة داخل الصورة',
    labelEn: 'Enable prescription-region detection at upload time',
  },
  {
    key: 'prescriptions.region_detection.min_confidence',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 0.55,
    labelAr: 'الحد الأدنى للثقة قبل قبول المنطقة تلقائيًا (٠-١)',
    labelEn:
      'Minimum region-detection confidence (0-1) before auto-accepting a region; below this, manual crop is required',
  },
  {
    key: 'prescriptions.region_detection.min_region_area_ratio',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 0.08,
    labelAr: 'الحد الأدنى لنسبة مساحة المنطقة المرشحة من الصورة',
    labelEn: 'Minimum candidate-region area as a fraction of the full image',
  },
  {
    key: 'prescriptions.region_detection.max_candidates',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 5,
    labelAr: 'الحد الأقصى لعدد المناطق المرشحة المحفوظة لكل صفحة',
    labelEn: 'Maximum candidate regions stored per page',
  },
  {
    key: 'prescriptions.region_detection.screenshot_aspect_ratio_min',
    category: 'prescriptions',
    valueType: 'NUMBER',
    // 1.6, not 1.4: real phone screenshots run ~1.6-2.2 (iPhone ~2.17,
    // common Android ~2.0-2.22), while A4/Letter scans sit at 1.29-1.41 —
    // 1.4 collided with scanned documents and misclassified them as
    // screenshots (see the region-detection engine's docs).
    value: 1.6,
    labelAr: 'الحد الأدنى لنسبة الطول للعرض المعتبرة لقطة شاشة هاتف',
    labelEn: 'Minimum height/width ratio considered a plausible phone screenshot',
  },
  {
    key: 'prescriptions.region_detection.screenshot_aspect_ratio_max',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 2.6,
    labelAr: 'الحد الأقصى لنسبة الطول للعرض المعتبرة لقطة شاشة هاتف',
    labelEn: 'Maximum height/width ratio considered a plausible phone screenshot',
  },
  {
    key: 'prescriptions.region_detection.whatsapp_hint_enabled',
    category: 'prescriptions',
    valueType: 'BOOLEAN',
    value: true,
    labelAr: 'تفعيل الإشارة الثانوية لاكتشاف واتساب (مؤشر إضافي فقط)',
    labelEn:
      'Enable the secondary WhatsApp-specific detection hint (a secondary signal only, never the primary basis for cropping)',
  },
  // CR-001 Sprint OCR-03 — Real Text Detection & Recognition. Business-
  // level tunables only (ADR-008); infra-level model/device selection
  // (OCR_PROVIDER, OCR_DEVICE, etc.) lives in ocr-service's own env vars
  // — this service holds no Settings/DB access, matching every other
  // Python-side config split in this sprint set.
  {
    // Empty = let ocr-service's own OCR_PROVIDER env var decide (its
    // process-level default). Set to "paddleocr" or "mock" here to
    // override per-deployment without touching ocr-service's env.
    key: 'prescriptions.ocr.provider',
    category: 'prescriptions',
    valueType: 'STRING',
    value: '',
    labelAr: 'محرك التعرف الضوئي المستخدم للوصفات (فارغ = افتراضي الخدمة)',
    labelEn: 'OCR provider to request for prescriptions (empty = ocr-service default)',
  },
  {
    key: 'prescriptions.ocr.language_mode',
    category: 'prescriptions',
    valueType: 'STRING',
    value: 'AUTO',
    labelAr: 'وضع اللغة للتعرف الضوئي (تلقائي/عربي فقط/إنجليزي فقط)',
    labelEn: 'OCR language mode (AUTO / ARABIC_ONLY / ENGLISH_ONLY)',
  },
  {
    // 0-100, matches PrescriptionPage.ocrPageConfidence's scale.
    key: 'prescriptions.ocr.review_confidence_threshold',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 60,
    labelAr: 'الحد الأدنى لثقة صفحة التعرف الضوئي قبل تعليمها للمراجعة',
    labelEn: 'Minimum OCR page confidence (0-100) before flagging requiresOcrReview',
  },
  {
    key: 'prescriptions.ocr.return_bounding_boxes',
    category: 'prescriptions',
    valueType: 'BOOLEAN',
    value: true,
    labelAr: 'إرجاع إحداثيات مربعات النص المكتشف',
    labelEn: 'Return per-block bounding polygons in the OCR response',
  },
  {
    key: 'prescriptions.ocr.return_alternatives',
    category: 'prescriptions',
    valueType: 'BOOLEAN',
    value: true,
    labelAr: 'إرجاع القراءات البديلة عند تقارب درجات الثقة بين اللغتين',
    labelEn: 'Return alternative-language readings when two passes score closely',
  },
  {
    key: 'prescriptions.ocr.max_pages_per_job',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 1,
    labelAr: 'الحد الأقصى لعدد الصفحات لكل مهمة تعرف ضوئي',
    labelEn: 'Maximum pages processed per OCR job (design brief §17)',
  },
  // CR-001 Phase 5 — Intelligent OCR-to-Drug Matching Engine. Every
  // weight/threshold configurable per ADR-008; snapshotted onto each
  // DrugMatchRun.configurationSnapshotJson so a run stays reproducible
  // even after these change. Weights (name/ingredient/strength/
  // dosageForm/context/dataQuality) sum to 1.0 by design.
  {
    key: 'prescriptions.matching.name_weight',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 0.4,
    labelAr: 'وزن تطابق اسم الدواء في درجة المطابقة الإجمالية',
    labelEn: 'Drug-name match weight in the total candidate score',
  },
  {
    key: 'prescriptions.matching.ingredient_weight',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 0.15,
    labelAr: 'وزن تطابق المكون الفعال في درجة المطابقة الإجمالية',
    labelEn: 'Active-ingredient match weight in the total candidate score',
  },
  {
    key: 'prescriptions.matching.strength_weight',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 0.2,
    labelAr: 'وزن تطابق التركيز في درجة المطابقة الإجمالية',
    labelEn: 'Strength match weight in the total candidate score',
  },
  {
    key: 'prescriptions.matching.dosage_form_weight',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 0.1,
    labelAr: 'وزن تطابق الشكل الصيدلاني في درجة المطابقة الإجمالية',
    labelEn: 'Dosage-form match weight in the total candidate score',
  },
  {
    key: 'prescriptions.matching.context_weight',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 0.05,
    labelAr: 'وزن أدلة السياق الداعمة (الشركة المصنعة والتعبئة والسطور المجاورة)',
    labelEn: 'Supporting-context (manufacturer/package/adjacent lines) weight',
  },
  {
    key: 'prescriptions.matching.data_quality_weight',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 0.1,
    labelAr: 'وزن جودة بيانات السجل المرشح في قاعدة بيانات الأدوية',
    labelEn: 'DIC record data-quality weight (verification/approval/completeness)',
  },
  {
    key: 'prescriptions.matching.ocr_reliability_adjustment_max',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 5,
    labelAr: 'أقصى تعديل (+/-) حسب موثوقية التعرف الضوئي — ليس وزنًا مضافًا',
    labelEn:
      'Max +/- points from OCR/page confidence — a small nudge, never a weighted share of the score',
  },
  {
    key: 'prescriptions.matching.strength_conflict_penalty',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 30,
    labelAr: 'خصم عند تعارض التركيز المستخرج مع تركيز السجل المرشح',
    labelEn: 'Score penalty when extracted strength conflicts with the candidate DIC strength',
  },
  {
    key: 'prescriptions.matching.dosage_form_conflict_penalty',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 20,
    labelAr: 'خصم عند تعارض الشكل الصيدلاني المستخرج مع السجل المرشح',
    labelEn: 'Score penalty when extracted dosage form conflicts with the candidate',
  },
  {
    key: 'prescriptions.matching.discontinued_drug_penalty',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 25,
    labelAr: 'خصم عندما يكون الدواء المرشح متوقفًا',
    labelEn: 'Score penalty when the candidate drug is discontinued',
  },
  {
    key: 'prescriptions.matching.inactive_drug_penalty',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 40,
    labelAr: 'خصم عندما يكون الدواء المرشح غير فعال',
    labelEn: 'Score penalty when the candidate drug is inactive',
  },
  {
    key: 'prescriptions.matching.unapproved_alias_penalty',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 10,
    labelAr: 'خصم عند الاعتماد على اسم بديل غير معتمد',
    labelEn: 'Score penalty when the match relied on an unapproved alias',
  },
  {
    key: 'prescriptions.matching.minimum_top_score',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 30,
    labelAr: 'أدنى درجة إجمالية قبل اعتبار السطر بلا مرشح آمن',
    labelEn: 'Minimum top-candidate score before a line is classified UNRESOLVED',
  },
  {
    key: 'prescriptions.matching.minimum_candidate_margin',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 12,
    labelAr: 'أدنى فارق بين أعلى مرشحين لاعتبار الترتيب غير ملتبس (HIGH فأعلى)',
    labelEn: 'Minimum margin over the runner-up required for HIGH and above',
  },
  {
    key: 'prescriptions.matching.very_high_margin_threshold',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 20,
    labelAr: 'أدنى فارق بين أعلى مرشحين لتصنيف VERY_HIGH',
    labelEn: 'Minimum margin over the runner-up required for VERY_HIGH',
  },
  {
    key: 'prescriptions.matching.very_high_min_score',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 85,
    labelAr: 'أدنى درجة إجمالية لتصنيف الثقة VERY_HIGH',
    labelEn: 'Minimum total score for the VERY_HIGH confidence band',
  },
  {
    key: 'prescriptions.matching.high_min_score',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 70,
    labelAr: 'أدنى درجة إجمالية لتصنيف الثقة HIGH',
    labelEn: 'Minimum total score for the HIGH confidence band',
  },
  {
    key: 'prescriptions.matching.medium_min_score',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 50,
    labelAr: 'أدنى درجة إجمالية لتصنيف الثقة MEDIUM',
    labelEn: 'Minimum total score for the MEDIUM confidence band',
  },
  {
    key: 'prescriptions.matching.minimum_ocr_confidence',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 0.5,
    labelAr: 'أدنى ثقة تعرف ضوئي؛ دون ذلك لا يتجاوز التصنيف MEDIUM مهما ارتفعت الدرجة',
    labelEn: 'Below this OCR confidence (0-1), a line is capped at MEDIUM regardless of score',
  },
  {
    key: 'prescriptions.matching.max_candidates_per_line',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 5,
    labelAr: 'الحد الأقصى لعدد المرشحين المحفوظين لكل سطر دواء',
    labelEn: 'Final candidate cap persisted per medication line',
  },
  {
    key: 'prescriptions.matching.max_candidates_per_strategy',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 10,
    labelAr: 'الحد الأقصى لعدد المرشحين من كل استراتيجية توليد على حدة',
    labelEn: 'Maximum candidates returned per individual generation strategy',
  },
  {
    key: 'prescriptions.matching.min_trigram_similarity',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 0.3,
    labelAr: 'أدنى تشابه (pg_trgm) قبل اعتبار سجل مرشحًا غامضًا',
    labelEn: 'Minimum pg_trgm similarity before a fuzzy candidate is even considered',
  },
  {
    key: 'prescriptions.matching.max_input_text_length',
    category: 'prescriptions',
    valueType: 'NUMBER',
    value: 200,
    labelAr: 'الحد الأقصى لطول النص المقارَن لكل سطر (حماية من الأداء)',
    labelEn: 'Maximum characters considered per line before candidate generation (perf guard)',
  },
  {
    key: 'prescriptions.matching.engine_version',
    category: 'prescriptions',
    valueType: 'STRING',
    value: '1.0.0',
    labelAr: 'إصدار محرك مطابقة الأدوية',
    labelEn: 'Drug-matching engine version tag (recorded on every DrugMatchRun)',
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
  await seedBranchCapabilities(prisma);
  await seedDicCatalogs(prisma);
  await seedDicReferenceData(prisma);
  await seedLocationHierarchy(prisma);
  await seedSuperAdmin();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
