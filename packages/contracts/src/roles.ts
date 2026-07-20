/**
 * System roles — blueprint §6. Seeded as non-deletable records; custom roles
 * can be added at runtime through the Roles admin screen.
 */
export const SYSTEM_ROLES = [
  'SUPER_ADMIN',
  'PLATFORM_ADMIN',
  'BUSINESS_EXCELLENCE_MANAGER',
  'TEAM_MANAGER',
  'TEAM_LEADER',
  'SUPERVISOR',
  'AGENT',
  'READ_ONLY',
  'QUALITY_REVIEWER',
  'INTEGRATION_SUPPORT',
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLES)[number];
