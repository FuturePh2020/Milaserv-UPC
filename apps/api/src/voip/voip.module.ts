import { Module } from "@nestjs/common";
import { VoipService } from "./voip.service";
import { VoipSettingsService } from "./voip-settings.service";
import { VoipController } from "./voip.controller";
import { MockVoipProvider } from "./adapters/mock-voip.provider";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  providers: [VoipService, VoipSettingsService, MockVoipProvider],
  controllers: [VoipController],
  exports: [VoipService, VoipSettingsService],
})
export class VoipModule {}
