import { Module } from "@nestjs/common";
import { ProductsService } from "./products.service";
import { ProductLookupsService } from "./product-lookups.service";
import { ProductImportService } from "./product-import.service";
import { ProductsController } from "./products.controller";
import { ProductImportController } from "./product-import.controller";
import { TimelineModule } from "../timeline/timeline.module";
import { AuditModule } from "../audit/audit.module";
import { PermissionsModule } from "../permissions/permissions.module";

@Module({
  imports: [TimelineModule, AuditModule, PermissionsModule],
  providers: [ProductsService, ProductLookupsService, ProductImportService],
  controllers: [ProductsController, ProductImportController],
  exports: [ProductsService, ProductLookupsService],
})
export class ProductsModule {}
