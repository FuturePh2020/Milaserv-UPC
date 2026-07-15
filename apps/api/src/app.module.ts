import { Module } from '@nestjs/common';
import { AppConfigModule } from './core/config/config.module';
import { PrismaModule } from './core/prisma/prisma.module';
import { RedisModule } from './core/redis/redis.module';
import { HealthController } from './core/health/health.controller';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { TimelineModule } from './modules/timeline/timeline.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { TeamsModule } from './modules/teams/teams.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    AuditModule,
    TimelineModule,
    // AuthModule before PermissionsModule: JwtAuthGuard must run first.
    AuthModule,
    PermissionsModule,
    DepartmentsModule,
    TeamsModule,
    UsersModule,
    RolesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
