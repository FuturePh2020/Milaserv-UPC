import { Module } from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import { SessionsController } from "./sessions.controller";
import { AuditModule } from "../audit/audit.module";
import { SettingsModule } from "../settings/settings.module";

@Module({
  imports: [AuditModule, SettingsModule],
  providers: [SessionsService],
  controllers: [SessionsController],
  exports: [SessionsService],
})
export class SessionsModule {}
