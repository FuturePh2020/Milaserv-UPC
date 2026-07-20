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
import { RetentionService } from "./retention.service";

@ApiTags("retention")
@ApiBearerAuth()
@Controller("retention")
@UseGuards(RolesGuard, PermissionsGuard)
export class RetentionController {
  constructor(
    private readonly retentionService: RetentionService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission(Permission.RETENTION_VIEW)
  list(@Query() query: any) {
    return this.retentionService.list({ ...query, isActive: query.isActive === undefined ? undefined : query.isActive === "true" });
  }

  @Get("due")
  @RequirePermission(Permission.RETENTION_VIEW)
  due(@Query("window") window: string, @Query("dateFrom") dateFrom?: string, @Query("dateTo") dateTo?: string) {
    return this.retentionService.findDue({
      window: window ?? "TODAY",
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    });
  }

  @Post()
  @RequirePermission(Permission.RETENTION_UPDATE)
  create(@Body() body: any, @CurrentUser() actor: AuthenticatedUser) {
    return this.retentionService.createManual(body, actor.userId);
  }

  @Put(":id")
  @RequirePermission(Permission.RETENTION_UPDATE)
  update(@Param("id") id: string, @Body() body: any, @CurrentUser() actor: AuthenticatedUser) {
    return this.retentionService.update(id, body, actor.userId);
  }

  @Get("export")
  @RequirePermission(Permission.RETENTION_EXPORT)
  async export(@Query() query: any, @Res() res: Response, @CurrentUser() actor: AuthenticatedUser) {
    const rows = await this.retentionService.list(query);
    const columns = [
      { header: "Customer Name", key: "name" },
      { header: "Phone", key: "phone" },
      { header: "Partner", key: "partner" },
      { header: "Cash/Insurance", key: "orderType" },
      { header: "Last Order Number", key: "lastOrderNumber" },
      { header: "Last Order Date", key: "lastOrderDate" },
      { header: "Last Dispensing Date", key: "lastDispensingDate" },
      { header: "Next Refill Date", key: "nextRefillDate" },
      { header: "Responsible Agent", key: "responsibleAgent" },
      { header: "Items", key: "items" },
      { header: "Notes", key: "notes" },
      { header: "Status", key: "status" },
    ];
    const data = rows.map((r: any) => ({
      name: r.name,
      phone: r.phone,
      partner: r.partner?.name ?? "",
      orderType: r.orderType ?? "",
      lastOrderNumber: r.lastOrderNumber ?? "",
      lastOrderDate: r.lastOrderDate?.toISOString?.() ?? "",
      lastDispensingDate: r.lastDispensingDate?.toISOString?.() ?? "",
      nextRefillDate: r.nextRefillDate?.toISOString?.() ?? "",
      responsibleAgent: r.responsibleAgent?.fullName ?? "",
      items: Array.isArray(r.lastItems) ? r.lastItems.map((i: any) => `${i.name} x${i.quantity}`).join(", ") : "",
      notes: r.notes ?? "",
      status: r.isActive ? "Active" : "Inactive",
    }));

    await this.audit.log({ action: "RETENTION_EXPORT", userId: actor.userId, entityType: "RetentionCustomer", metadata: { count: data.length } });

    if (query.format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="retention-customers.csv"`);
      res.send(buildCsv(columns, data));
      return;
    }
    const buffer = await buildExcelBuffer("retention-customers", columns, data);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="retention-customers.xlsx"`);
    res.send(buffer);
  }
}
