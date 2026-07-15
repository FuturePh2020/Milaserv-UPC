/**
 * Data visibility scopes — blueprint §6.1.
 * Effective permission = Role + Data Scope (+ Partner/Branch/Department scope,
 * Field Permissions, Feature Flags — blueprint §19.1). PARTNER and BRANCH are
 * modeled now but remain inactive until their master-data modules exist.
 */
export const DATA_SCOPES = [
  'MY_RECORDS',
  'MY_TEAM',
  'DEPARTMENT',
  'MULTIPLE_TEAMS',
  'PARTNER',
  'BRANCH',
  'ALL_DATA',
] as const;
export type DataScope = (typeof DATA_SCOPES)[number];
