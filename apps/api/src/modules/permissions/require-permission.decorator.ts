import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@milaserv/contracts';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/**
 * Declares the permission an endpoint requires (blueprint §19.2).
 * Enforced by the global PermissionsGuard; the resolved data scope is
 * attached to the request for downstream query filtering.
 */
export const RequirePermission = (permission: PermissionKey) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);
