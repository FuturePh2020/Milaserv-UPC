import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionsController } from './permissions.controller';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsService } from './permissions.service';

/**
 * Global: every domain module gates endpoints with @RequirePermission.
 * Must be imported AFTER AuthModule so PermissionsGuard runs after
 * JwtAuthGuard (guard order follows provider registration order).
 */
@Global()
@Module({
  controllers: [PermissionsController],
  providers: [PermissionsService, { provide: APP_GUARD, useClass: PermissionsGuard }],
  exports: [PermissionsService],
})
export class PermissionsModule {}
