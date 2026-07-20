import { Module } from "@nestjs/common";
import { PermissionsService } from "./permissions.service";
import { PermissionsGuard } from "./permissions.guard";
import { PermissionsController } from "./permissions.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  providers: [PermissionsService, PermissionsGuard],
  controllers: [PermissionsController],
  exports: [PermissionsService, PermissionsGuard],
})
export class PermissionsModule {}
