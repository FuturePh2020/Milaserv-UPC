import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { RequestScope } from './scope';

/** Injects the scope resolved by PermissionsGuard for the endpoint's permission. */
export const PermissionScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestScope | undefined => {
    const req = ctx.switchToHttp().getRequest<{ permissionScope?: RequestScope }>();
    return req.permissionScope;
  },
);
