import { SetMetadata } from "@nestjs/common";
import { Permission } from "@lcrm/shared";

export const REQUIRE_PERMISSION_KEY = "requirePermission";
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(REQUIRE_PERMISSION_KEY, permissions);
