import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { LeadImportService } from "./lead-import.service";
import { LeadImportController } from "./lead-import.controller";
import { LeadImportProcessor } from "./lead-import.processor";
import { LEAD_IMPORT_QUEUE } from "./lead-import.service";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [BullModule.registerQueue({ name: LEAD_IMPORT_QUEUE }), AuditModule],
  providers: [LeadImportService, LeadImportProcessor],
  controllers: [LeadImportController],
  exports: [LeadImportService],
})
export class LeadImportModule {}
