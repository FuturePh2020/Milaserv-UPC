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
] as const satisfies readonly PermissionDef[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);
