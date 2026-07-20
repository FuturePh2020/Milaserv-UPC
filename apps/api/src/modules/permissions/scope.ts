import type { DataScope } from '@prisma/client';

/** Widest-wins ordering when merging grants from multiple roles (§19.1).
 *  BRANCH/PARTNER ranks are provisional until those modules activate (Phase 2+). */
export const SCOPE_RANK: Record<DataScope, number> = {
  MY_RECORDS: 0,
  MY_TEAM: 1,
  MULTIPLE_TEAMS: 2,
  DEPARTMENT: 3,
  BRANCH: 4,
  PARTNER: 5,
  ALL_DATA: 6,
};

export interface ResolvedScope {
  scope: DataScope;
  /** Populated when scope = MULTIPLE_TEAMS. */
  teamIds?: string[];
}

/** Effective permissions payload: permission key → widest resolved scope. */
export interface EffectivePermissions {
  userId: string;
  departmentId: string | null;
  /** Teams the user belongs to (for MY_TEAM filtering). */
  teamIds: string[];
  permissions: Record<string, ResolvedScope>;
}

/** Attached to the request by PermissionsGuard for the matched permission. */
export interface RequestScope extends ResolvedScope {
  context: EffectivePermissions;
}
