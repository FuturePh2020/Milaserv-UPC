import { Controller, Get } from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionsService } from './permissions.service';

@Controller('me')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  /** Drives the web sidebar and action visibility — one payload, one truth. */
  @Get('permissions')
  myPermissions(@CurrentUser() user: AuthUser) {
    return this.permissions.getEffectivePermissions(user.userId);
  }
}
