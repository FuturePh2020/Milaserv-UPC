import { Module } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { SettingsController } from "./settings.controller";
import { WorkflowSettingsController } from "./workflow-settings.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  providers: [SettingsService],
  controllers: [SettingsController, WorkflowSettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
