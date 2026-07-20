import { Module } from "@nestjs/common";
import { RetentionService } from "./retention.service";
import { RetentionController } from "./retention.controller";
import { TimelineModule } from "../timeline/timeline.module";
import { AuditModule } from "../audit/audit.module";
import { PermissionsModule } from "../permissions/permissions.module";
import { CustomersModule } from "../customers/customers.module";

@Module({
  imports: [TimelineModule, AuditModule, PermissionsModule, CustomersModule],
  providers: [RetentionService],
  controllers: [RetentionController],
  exports: [RetentionService],
})
export class RetentionModule {}
