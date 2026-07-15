import { Module } from '@nestjs/common';
import { AppConfigModule } from './core/config/config.module';
import { PrismaModule } from './core/prisma/prisma.module';
import { RedisModule } from './core/redis/redis.module';
import { HealthController } from './core/health/health.controller';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { PermissionsModule } from './modules/permissions/permissions.module';

@Module({
  // AuthModule before PermissionsModule: JwtAuthGuard must run first.
  imports: [AppConfigModule, PrismaModule, RedisModule, AuditModule, AuthModule, PermissionsModule],
  controllers: [HealthController],
})
export class AppModule {}
