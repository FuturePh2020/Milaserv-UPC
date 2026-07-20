import { Module } from "@nestjs/common";
import { CallOutcomesService } from "./call-outcomes.service";
import { CallOutcomesController } from "./call-outcomes.controller";
import { TimelineModule } from "../timeline/timeline.module";
import { AuditModule } from "../audit/audit.module";
import { SettingsModule } from "../settings/settings.module";
import { LeadsModule } from "../leads/leads.module";
import { OrdersModule } from "../orders/orders.module";
import { RetentionModule } from "../retention/retention.module";

@Module({
  imports: [TimelineModule, AuditModule, SettingsModule, LeadsModule, OrdersModule, RetentionModule],
  providers: [CallOutcomesService],
  controllers: [CallOutcomesController],
  exports: [CallOutcomesService],
})
export class CallOutcomesModule {}
