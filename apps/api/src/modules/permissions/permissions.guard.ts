import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';
import { PermissionsService } from './permissions.service';
import type { RequestScope } from './scope';

/**
 * Global guard (runs after JwtAuthGuard): enforces @RequirePermission and
 * attaches the resolved data scope to the request so services filter their
 * queries from the SAME resolution that authorized the call (§19.1, ADR-010).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser; permissionScope?: RequestScope }>();
    if (!req.user) throw new ForbiddenException('Unauthenticated');

    const effective = await this.permissions.getEffectivePermissions(req.user.userId);
    const resolved = effective.permissions[required];
    if (!resolved) {
      throw new ForbiddenException(`Missing permission: ${required}`);
    }

    req.permissionScope = { ...resolved, context: effective };
    return true;
  }
}
