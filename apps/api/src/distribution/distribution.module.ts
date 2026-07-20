import { Module } from "@nestjs/common";
import { DistributionService } from "./distribution.service";
import { DistributionController } from "./distribution.controller";
import { AuditModule } from "../audit/audit.module";
import { SettingsModule } from "../settings/settings.module";

@Module({
  imports: [AuditModule, SettingsModule],
  providers: [DistributionService],
  controllers: [DistributionController],
  exports: [DistributionService],
})
export class DistributionModule {}
