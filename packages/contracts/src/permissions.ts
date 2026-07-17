import type { BilingualText } from './locale';

/**
 * Permission catalog — Phase 1 (Core Platform) actions only.
 *
 * This is the single source of truth for permission keys (blueprint §19.2):
 * the API seeds the `Permission` table from it, guards reference keys from it,
 * and the web sidebar renders from it. Later phases (Ticketing, KB, …) append
 * their own keys here — existing keys are never renamed (audit history
 * references them).
 */
export interface PermissionDef {
  key: string;
  module: string;
  label: BilingualText;
}

export const PERMISSIONS = [
  // users
  { key: 'user.view', module: 'users', label: { en: 'View users', ar: 'عرض المستخدمين' } },
  { key: 'user.create', module: 'users', label: { en: 'Create users', ar: 'إنشاء المستخدمين' } },
  { key: 'user.edit', module: 'users', label: { en: 'Edit users', ar: 'تعديل المستخدمين' } },
  {
    key: 'user.deactivate',
    module: 'users',
    label: { en: 'Activate / deactivate users', ar: 'تفعيل / تعطيل المستخدمين' },
  },
  {
    key: 'user.assign_roles',
    module: 'users',
    label: { en: 'Assign roles to users', ar: 'إسناد الأدوار للمستخدمين' },
  },

  // departments
  {
    key: 'department.view',
    module: 'departments',
    label: { en: 'View departments', ar: 'عرض الإدارات' },
  },
  {
    key: 'department.manage',
    module: 'departments',
    label: { en: 'Create / edit / archive departments', ar: 'إدارة الإدارات' },
  },

  // teams
  { key: 'team.view', module: 'teams', label: { en: 'View teams', ar: 'عرض الفرق' } },
  {
    key: 'team.manage',
    module: 'teams',
    label: { en: 'Create / edit / archive teams', ar: 'إدارة الفرق' },
  },
  {
    key: 'team.manage_members',
    module: 'teams',
    label: { en: 'Manage team members', ar: 'إدارة أعضاء الفرق' },
  },

  // roles & permissions
  { key: 'role.view', module: 'roles', label: { en: 'View roles', ar: 'عرض الأدوار' } },
  {
    key: 'role.manage',
    module: 'roles',
    label: { en: 'Create / edit roles & permissions', ar: 'إدارة الأدوار والصلاحيات' },
  },

  // settings (Configuration Engine, ADR-008)
  { key: 'setting.view', module: 'settings', label: { en: 'View settings', ar: 'عرض الإعدادات' } },
  {
    key: 'setting.manage',
    module: 'settings',
    label: { en: 'Manage settings', ar: 'إدارة الإعدادات' },
  },

  // audit (blueprint §19.2 "View Audit")
  { key: 'audit.view', module: 'audit', label: { en: 'View audit log', ar: 'عرض سجل التدقيق' } },

  // branches (minimal directory — ticketing spec §2; Branch Center extends later)
  { key: 'branch.view', module: 'branches', label: { en: 'View branches', ar: 'عرض الفروع' } },
  {
    key: 'branch.manage',
    module: 'branches',
    label: { en: 'Manage branch directory', ar: 'إدارة دليل الفروع' },
  },

  // attachments (engine foundation, blueprint §8)
  {
    key: 'attachment.manage',
    module: 'attachments',
    label: { en: 'Manage attachments', ar: 'إدارة المرفقات' },
  },

  // ticketing (§19.2 actions; ticketing spec §8)
  { key: 'ticket.view', module: 'tickets', label: { en: 'View tickets', ar: 'عرض التذاكر' } },
  { key: 'ticket.create', module: 'tickets', label: { en: 'Create tickets', ar: 'إنشاء التذاكر' } },
  { key: 'ticket.edit', module: 'tickets', label: { en: 'Edit tickets', ar: 'تعديل التذاكر' } },
  { key: 'ticket.assign', module: 'tickets', label: { en: 'Assign tickets', ar: 'إسناد التذاكر' } },
  {
    key: 'ticket.take_responsibility',
    module: 'tickets',
    label: { en: 'Take responsibility', ar: 'تولّي المسؤولية' },
  },
  {
    key: 'ticket.redirect',
    module: 'tickets',
    label: { en: 'Redirect tickets', ar: 'إعادة توجيه التذاكر' },
  },
  {
    key: 'ticket.update_add',
    module: 'tickets',
    label: { en: 'Add ticket updates', ar: 'إضافة تحديثات التذكرة' },
  },
  { key: 'ticket.resolve', module: 'tickets', label: { en: 'Resolve tickets', ar: 'حل التذاكر' } },
  { key: 'ticket.close', module: 'tickets', label: { en: 'Close tickets', ar: 'إغلاق التذاكر' } },
  {
    key: 'ticket.reopen',
    module: 'tickets',
    label: { en: 'Re-open tickets', ar: 'إعادة فتح التذاكر' },
  },
  {
    key: 'ticket.escalate',
    module: 'tickets',
    label: { en: 'Escalate tickets', ar: 'تصعيد التذاكر' },
  },
  {
    key: 'ticket.export',
    module: 'tickets',
    label: { en: 'Export tickets', ar: 'تصدير التذاكر' },
  },
  {
    key: 'ticket.manage_config',
    module: 'tickets',
    label: { en: 'Manage ticketing configuration', ar: 'إدارة إعدادات التذاكر' },
  },

  // knowledge base (blueprint §10)
  {
    key: 'kb.view',
    module: 'knowledge_base',
    label: { en: 'View knowledge base', ar: 'عرض قاعدة المعرفة' },
  },
  {
    key: 'kb.manage',
    module: 'knowledge_base',
    label: { en: 'Manage content & courses', ar: 'إدارة المحتوى والكورسات' },
  },
  {
    key: 'kb.assign',
    module: 'knowledge_base',
    label: { en: 'Assign courses', ar: 'إسناد الكورسات' },
  },

  // break tracker & workforce (blueprint §11)
  {
    key: 'break.track',
    module: 'breaks',
    label: { en: 'Track own work sessions & breaks', ar: 'تسجيل جلسات العمل والبريكات الخاصة' },
  },
  {
    key: 'break.viewTeam',
    module: 'breaks',
    label: { en: 'View team live status & sessions', ar: 'عرض الحالة اللحظية وجلسات الفريق' },
  },

  // customer care performance (blueprint §12.1/§12.2)
  {
    key: 'performance.view',
    module: 'performance',
    label: { en: 'View performance dashboards', ar: 'عرض لوحات الأداء' },
  },
  {
    key: 'performance.manage',
    module: 'performance',
    label: { en: 'Manage performance targets', ar: 'إدارة أهداف الأداء' },
  },
  {
    key: 'performance.ingest',
    module: 'performance',
    label: { en: 'Ingest performance metrics', ar: 'إدخال مقاييس الأداء' },
  },

  // crm, leads & telesales (blueprint §14)
  {
    key: 'crm.view',
    module: 'crm',
    label: { en: 'View leads & orders', ar: 'عرض العملاء المحتملين والطلبات' },
  },
  {
    key: 'crm.work',
    module: 'crm',
    label: {
      en: 'Work leads (calls & orders)',
      ar: 'العمل على العملاء المحتملين (مكالمات وطلبات)',
    },
  },
  {
    key: 'crm.upload',
    module: 'crm',
    label: { en: 'Import lead files', ar: 'استيراد ملفات العملاء المحتملين' },
  },

  // online operation & ordering (blueprint §13)
  {
    key: 'online.view',
    module: 'online',
    label: { en: 'View online orders & stats', ar: 'عرض الطلبات الإلكترونية والإحصاءات' },
  },
  {
    key: 'online.ingest',
    module: 'online',
    label: { en: 'Ingest online orders', ar: 'إدخال الطلبات الإلكترونية' },
  },
  {
    key: 'integration.monitor',
    module: 'integrations',
    label: { en: 'Integration monitor & retry', ar: 'مراقبة التكاملات وإعادة المحاولة' },
  },

  // united pharmacy center — DIC (blueprint §15)
  {
    key: 'dic.view',
    module: 'dic',
    label: { en: 'Search & view drug information', ar: 'البحث وعرض معلومات الأدوية' },
  },
  {
    key: 'dic.manage',
    module: 'dic',
    label: { en: 'Import drug master & coverage', ar: 'استيراد ملفات الأدوية والتغطيات' },
  },
  {
    key: 'dic.approve',
    module: 'dic',
    label: { en: 'Approve drug master changes', ar: 'اعتماد تغييرات بيانات الأدوية' },
  },
] as const satisfies readonly PermissionDef[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);
