import { Module } from "@nestjs/common";
import { BreaksService } from "./breaks.service";
import { BreaksController } from "./breaks.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  providers: [BreaksService],
  controllers: [BreaksController],
  exports: [BreaksService],
})
export class BreaksModule {}
