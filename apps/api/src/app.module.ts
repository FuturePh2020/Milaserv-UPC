import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { BullmqRootModule } from "./jobs/bullmq.module";
import { JobsModule } from "./jobs/jobs.module";

import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard";
import { UsersModule } from "./users/users.module";
import { PartnersModule } from "./partners/partners.module";
import { TasksModule } from "./tasks/tasks.module";
import { LeadCategoriesModule } from "./lead-categories/lead-categories.module";
import { LeadImportModule } from "./lead-import/lead-import.module";
import { DistributionModule } from "./distribution/distribution.module";
import { LeadsModule } from "./leads/leads.module";
import { SessionsModule } from "./sessions/sessions.module";
import { BreaksModule } from "./breaks/breaks.module";
import { VoipModule } from "./voip/voip.module";
import { AuditModule } from "./audit/audit.module";
import { SettingsModule } from "./settings/settings.module";
import { ReportsModule } from "./reports/reports.module";
import { DashboardModule } from "./dashboard/dashboard.module";

import { TimelineModule } from "./timeline/timeline.module";
import { PermissionsModule } from "./permissions/permissions.module";
import { CustomersModule } from "./customers/customers.module";
import { CallOutcomesModule } from "./call-outcomes/call-outcomes.module";
import { OrdersModule } from "./orders/orders.module";
import { RetentionModule } from "./retention/retention.module";
import { ProductsModule } from "./products/products.module";
import { TeamsModule } from "./teams/teams.module";

import { AllExceptionsFilter } from "./common/filters/http-exception.filter";
import { CsrfGuard } from "./common/guards/csrf.guard";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    RedisModule,
    BullmqRootModule,
    JobsModule,
    AuditModule,
    SettingsModule,
    AuthModule,
    UsersModule,
    PartnersModule,
    TasksModule,
    LeadCategoriesModule,
    LeadImportModule,
    DistributionModule,
    LeadsModule,
    SessionsModule,
    BreaksModule,
    VoipModule,
    ReportsModule,
    DashboardModule,
    TimelineModule,
    PermissionsModule,
    CustomersModule,
    RetentionModule,
    OrdersModule,
    ProductsModule,
    CallOutcomesModule,
    TeamsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
