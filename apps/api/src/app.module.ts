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
import { SettingsModule } from './modules/settings/settings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NumberingModule } from './modules/numbering/numbering.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { BranchesModule } from './modules/branches/branches.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { KbModule } from './modules/kb/kb.module';
import { BreaksModule } from './modules/breaks/breaks.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { CrmModule } from './modules/crm/crm.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { OnlineModule } from './modules/online/online.module';
import { DicModule } from './modules/dic/dic.module';
import { OcrModule } from './modules/ocr/ocr.module';
import { AiModule } from './modules/ai/ai.module';

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
    SettingsModule,
    NotificationsModule,
    NumberingModule,
    AttachmentsModule,
    BranchesModule,
    TicketsModule,
    KbModule,
    BreaksModule,
    PerformanceModule,
    CrmModule,
    IntegrationsModule,
    OnlineModule,
    DicModule,
    OcrModule,
    AiModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
