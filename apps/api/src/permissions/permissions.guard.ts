import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Permission } from "@lcrm/shared";
import { PermissionsService } from "./permissions.service";
import { REQUIRE_PERMISSION_KEY } from "./require-permission.decorator";

/**
 * Checked in addition to the existing role-based @Roles/RolesGuard from
 * Phase 1 — this guard adds granular per-permission checks for the new
 * Orders/Retention/Products endpoints without touching the Phase 1 guard.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) throw new ForbiddenException("Not authenticated");

    for (const permission of required) {
      const allowed = await this.permissionsService.can(user, permission);
      if (!allowed) {
        throw new ForbiddenException(`Missing required permission: ${permission}`);
      }
    }
    return true;
  }
}
