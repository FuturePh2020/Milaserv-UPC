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
  ],
  TEAM_MANAGER: [
    ['user.view', DataScope.DEPARTMENT],
    ['department.view', DataScope.DEPARTMENT],
    ['team.view', DataScope.DEPARTMENT],
    ['team.manage_members', DataScope.DEPARTMENT],
  ],
  TEAM_LEADER: [
    ['user.view', DataScope.MY_TEAM],
    ['team.view', DataScope.MY_TEAM],
  ],
  SUPERVISOR: [
    ['user.view', DataScope.MY_TEAM],
    ['team.view', DataScope.MY_TEAM],
  ],
  AGENT: [],
  READ_ONLY: [
    ['department.view', DataScope.DEPARTMENT],
    ['team.view', DataScope.DEPARTMENT],
  ],
  QUALITY_REVIEWER: [['audit.view', DataScope.DEPARTMENT]],
  INTEGRATION_SUPPORT: [],
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
  await seedSuperAdmin();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
