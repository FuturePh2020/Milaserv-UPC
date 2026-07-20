import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { OrdersPerformanceService } from "./orders-performance.service";
import { OrdersController } from "./orders.controller";
import { AuditModule } from "../audit/audit.module";
import { TimelineModule } from "../timeline/timeline.module";
import { CustomersModule } from "../customers/customers.module";
import { SettingsModule } from "../settings/settings.module";
import { PermissionsModule } from "../permissions/permissions.module";
import { RetentionModule } from "../retention/retention.module";

@Module({
  imports: [AuditModule, TimelineModule, CustomersModule, SettingsModule, PermissionsModule, RetentionModule],
  providers: [OrdersService, OrdersPerformanceService],
  controllers: [OrdersController],
  exports: [OrdersService, OrdersPerformanceService],
})
export class OrdersModule {}
