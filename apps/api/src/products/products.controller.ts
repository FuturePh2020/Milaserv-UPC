import { Body, Controller, Get, Param, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { Response } from "express";
import { Permission } from "@lcrm/shared";
import { RolesGuard } from "../common/guards/roles.guard";
import { PermissionsGuard } from "../permissions/permissions.guard";
import { RequirePermission } from "../permissions/require-permission.decorator";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { AuditService } from "../audit/audit.service";
import { buildExcelBuffer, buildCsv } from "../reports/report-export.util";
import { ProductsService } from "./products.service";
import { ProductLookupsService } from "./product-lookups.service";

const CATALOG_COLUMNS = [
  { header: "Item Code", key: "itemCode" },
  { header: "Barcode", key: "barcode" },
  { header: "Arabic Name", key: "arabicName" },
  { header: "English Name", key: "englishName" },
  { header: "Scientific Name", key: "scientificName" },
  { header: "Active Ingredient", key: "activeIngredient" },
  { header: "Category", key: "category" },
  { header: "Subcategory", key: "subcategory" },
  { header: "Dosage Form", key: "dosageForm" },
  { header: "Strength", key: "strength" },
  { header: "Unit", key: "unit" },
  { header: "Pack Size", key: "packSize" },
  { header: "Manufacturer", key: "manufacturer" },
  { header: "Default Price", key: "defaultPrice" },
  { header: "Currency", key: "currency" },
  { header: "Cash Available", key: "cashAvailable" },
  { header: "Insurance Available", key: "insuranceAvailable" },
  { header: "Active Status", key: "isActive" },
  { header: "Archived Status", key: "isArchived" },
  { header: "Created At", key: "createdAt" },
  { header: "Updated At", key: "updatedAt" },
];

@ApiTags("products")
@ApiBearerAuth()
@Controller("products")
@UseGuards(RolesGuard, PermissionsGuard)
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly lookups: ProductLookupsService,
    private readonly audit: AuditService,
  ) {}

  @Get("search")
  @RequirePermission(Permission.PRODUCTS_VIEW)
  search(@Query("q") q: string, @Query("orderType") orderType?: string, @Query("partnerId") partnerId?: string) {
    return this.productsService.searchForAgents({ query: q, orderType, partnerId });
  }

  @Get()
  @RequirePermission(Permission.PRODUCTS_VIEW)
  findAll(@Query() query: any) {
    return this.productsService.findAll({
      search: query.search,
      categoryId: query.categoryId,
      isActive: query.isActive === undefined ? undefined : query.isActive === "true",
      isArchived: query.isArchived === undefined ? undefined : query.isArchived === "true",
    });
  }

  @Get("export")
  @RequirePermission(Permission.PRODUCTS_EXPORT)
  async export(@Query() query: any, @Res() res: Response, @CurrentUser() actor: AuthenticatedUser) {
    const products = await this.productsService.findAll(query);
    const rows = products.map((p: any) => ({
      itemCode: p.itemCode,
      barcode: p.barcode ?? "",
      arabicName: p.arabicName ?? "",
      englishName: p.englishName ?? "",
      scientificName: p.scientificName ?? "",
      activeIngredient: p.activeIngredient ?? "",
      category: p.category?.name ?? "",
      subcategory: p.subcategory?.name ?? "",
      dosageForm: p.dosageForm?.name ?? "",
      strength: p.strength ?? "",
      unit: p.unit?.name ?? "",
      packSize: p.packSize ?? "",
      manufacturer: p.manufacturer?.name ?? "",
      defaultPrice: p.defaultPrice ?? "",
      currency: p.currency,
      cashAvailable: p.cashAvailable,
      insuranceAvailable: p.insuranceAvailable,
      isActive: p.isActive,
      isArchived: p.isArchived,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
    await this.audit.log({ action: "PRODUCT_EXPORT", userId: actor.userId, entityType: "Product", metadata: { count: rows.length } });
    if (query.format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="products.csv"`);
      res.send(buildCsv(CATALOG_COLUMNS, rows));
      return;
    }
    const buffer = await buildExcelBuffer("products", CATALOG_COLUMNS, rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="products.xlsx"`);
    res.send(buffer);
  }

  @Get(":id")
  @RequirePermission(Permission.PRODUCTS_VIEW)
  findOne(@Param("id") id: string) {
    return this.productsService.findOne(id);
  }

  @Post()
  @RequirePermission(Permission.PRODUCTS_CREATE)
  create(@Body() body: any, @CurrentUser() actor: AuthenticatedUser) {
    return this.productsService.create(body, actor.userId);
  }

  @Put(":id")
  @RequirePermission(Permission.PRODUCTS_UPDATE)
  update(@Param("id") id: string, @Body() body: any, @CurrentUser() actor: AuthenticatedUser) {
    return this.productsService.update(id, body, actor.userId);
  }

  @Put(":id/status")
  @RequirePermission(Permission.PRODUCTS_ACTIVATE)
  setStatus(@Param("id") id: string, @Body("isActive") isActive: boolean, @CurrentUser() actor: AuthenticatedUser) {
    return this.productsService.setStatus(id, isActive, actor.userId);
  }

  @Post(":id/archive")
  @RequirePermission(Permission.PRODUCTS_ARCHIVE)
  archive(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.productsService.archive(id, actor.userId);
  }

  @Post(":id/restore")
  @RequirePermission(Permission.PRODUCTS_RESTORE)
  restore(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.productsService.restore(id, actor.userId);
  }

  @Put(":id/partners/:partnerId")
  @RequirePermission(Permission.PRODUCTS_MANAGE_PARTNER_AVAILABILITY)
  setPartnerAvailability(
    @Param("id") id: string,
    @Param("partnerId") partnerId: string,
    @Body() body: any,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.productsService.setPartnerAvailability(id, partnerId, body, actor.userId);
  }

  @Get("lookups/:kind")
  @RequirePermission(Permission.PRODUCTS_VIEW)
  listLookups(@Param("kind") kind: any, @Query("activeOnly") activeOnly?: string) {
    return this.lookups.list(kind, activeOnly === "true");
  }

  @Post("lookups/:kind")
  @RequirePermission(Permission.PRODUCTS_UPDATE)
  createLookup(@Param("kind") kind: any, @Body() body: any) {
    return this.lookups.create(kind, body);
  }

  @Put("lookups/:kind/:id")
  @RequirePermission(Permission.PRODUCTS_UPDATE)
  updateLookup(@Param("kind") kind: any, @Param("id") id: string, @Body() body: any) {
    return this.lookups.update(kind, id, body);
  }
}
