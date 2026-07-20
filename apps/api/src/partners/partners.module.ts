import { Module } from "@nestjs/common";
import { PartnersService } from "./partners.service";
import { PartnersController } from "./partners.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  providers: [PartnersService],
  controllers: [PartnersController],
  exports: [PartnersService],
})
export class PartnersModule {}
