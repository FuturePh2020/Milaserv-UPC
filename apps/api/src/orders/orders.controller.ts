import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { Response } from "express";
import { UserRole, Permission } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { RequirePermission } from "../permissions/require-permission.decorator";
import { PermissionsGuard } from "../permissions/permissions.guard";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { RequestMeta, RequestMeta as RequestMetaType } from "../common/decorators/request-meta.decorator";
import { OrdersService } from "./orders.service";
import { OrdersPerformanceService } from "./orders-performance.service";
import { buildExcelBuffer, buildCsv } from "../reports/report-export.util";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("orders")
@ApiBearerAuth()
@Controller("orders")
@UseGuards(RolesGuard, PermissionsGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly performance: OrdersPerformanceService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @RequirePermission(Permission.ORDERS_CREATE)
  create(@Body() body: any, @CurrentUser() actor: AuthenticatedUser, @RequestMeta() meta: RequestMetaType) {
    return this.ordersService.createManual(body, actor.userId, meta);
  }

  @Get("my")
  @Roles(UserRole.AGENT)
  @RequirePermission(Permission.ORDERS_VIEW_OWN)
  myOrders(@Query() query: any, @CurrentUser() actor: AuthenticatedUser) {
    return this.ordersService.myOrders(actor.userId, parseFilters(query));
  }

  @Get("my/performance")
  @Roles(UserRole.AGENT)
  myPerformance(@Query("month") month: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.agentPerformance(actor.userId, month);
  }

  @Get("team")
  @Roles(UserRole.ADMIN)
  @RequirePermission(Permission.ORDERS_VIEW_TEAM)
  async teamOrders(@Query() query: any) {
    return this.ordersService.teamOrders(query.teamId, parseFilters(query));
  }

  @Get("team/performance")
  @Roles(UserRole.ADMIN)
  teamPerformance(@Query() query: any) {
    const useFilters = query.mode === "filtered";
    return this.performance.teamPerformance(query.teamId, query.month, {
      useFilters,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      status: query.status,
      orderType: query.orderType,
      responsibleUserId: query.responsibleUserId,
      partnerId: query.partnerId,
      source: query.source,
    });
  }

  @Get("targets")
  @Roles(UserRole.ADMIN)
  @RequirePermission(Permission.TARGETS_MANAGE)
  listTargets(@Query() query: any) {
    return this.performance.listTargets(query);
  }

  @Post("targets")
  @Roles(UserRole.ADMIN)
  @RequirePermission(Permission.TARGETS_MANAGE)
  upsertTarget(@Body() body: any, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.upsertTarget(body, actor.userId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.ordersService.findOne(id);
  }

  @Post(":id/items")
  addItem(@Param("id") id: string, @Body() body: any, @CurrentUser() actor: AuthenticatedUser) {
    return this.ordersService.addItem(id, body, actor.userId);
  }

  @Put(":id/items/:itemId")
  updateItem(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body("quantity") quantity: number,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ordersService.updateItemQuantity(id, itemId, quantity, actor.userId);
  }

  @Delete(":id/items/:itemId")
  removeItem(@Param("id") id: string, @Param("itemId") itemId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.ordersService.removeItem(id, itemId, actor.userId);
  }

  @Put(":id/status")
  updateStatus(
    @Param("id") id: string,
    @Body() body: any,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestMetaType,
  ) {
    return this.ordersService.updateStatus(id, body, actor.userId, meta);
  }

  @Put(":id/expected-value")
  setExpectedValue(
    @Param("id") id: string,
    @Body("expectedValue") expectedValue: number,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ordersService.setExpectedValue(id, expectedValue, actor.userId);
  }

  @Post(":id/notes")
  addNote(
    @Param("id") id: string,
    @Body("text") text: string,
    @Body("visibility") visibility: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ordersService.addNote(id, text, visibility, actor.userId, actor.role);
  }

  @Put(":id/next-refill")
  updateNextRefill(@Param("id") id: string, @Body() body: any, @CurrentUser() actor: AuthenticatedUser) {
    return this.ordersService.updateNextRefill(id, body, actor.userId);
  }

  @Get("export/summary")
  @Roles(UserRole.ADMIN)
  @RequirePermission(Permission.ORDERS_EXPORT)
  async exportSummary(@Query() query: any, @Res() res: Response, @CurrentUser() actor: AuthenticatedUser) {
    const orders = await this.prisma.order.findMany({
      where: buildExportWhere(query),
      include: {
        responsibleUser: { select: { fullName: true } },
        team: { select: { name: true } },
        partner: { select: { name: true } },
        lead: { select: { id: true } },
        callRecord: { select: { id: true } },
        orderNotes: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const columns = [
      { header: "External Order Number", key: "externalOrderNumber" },
      { header: "Customer Name", key: "customerName" },
      { header: "Customer Phone", key: "customerPhone" },
      { header: "Order Type", key: "orderType" },
      { header: "Source", key: "source" },
      { header: "Partner", key: "partner" },
      { header: "Responsible Agent", key: "responsibleAgent" },
      { header: "Team", key: "team" },
      { header: "Status", key: "status" },
      { header: "Expected Value", key: "expectedValue" },
      { header: "Completed Value", key: "completedValue" },
      { header: "Created Date", key: "createdDate" },
      { header: "Completion Date", key: "completionDate" },
      { header: "Cancellation Reason", key: "cancellationReason" },
      { header: "Next Refill Date", key: "nextRefillDate" },
      { header: "Lead Reference", key: "leadRef" },
      { header: "Call Reference", key: "callRef" },
      { header: "Notes", key: "notes" },
    ];
    const rows = orders.map((o) => ({
      externalOrderNumber: o.externalOrderNumber,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      orderType: o.orderType,
      source: o.source,
      partner: o.partner?.name ?? "",
      responsibleAgent: o.responsibleUser.fullName,
      team: o.team?.name ?? "",
      status: o.status,
      expectedValue: o.expectedValue ?? "",
      completedValue: o.completedValue ?? "",
      createdDate: o.createdAt.toISOString(),
      completionDate: o.completedAt?.toISOString() ?? "",
      cancellationReason: o.cancellationReason ?? "",
      nextRefillDate: o.nextRefillDate?.toISOString() ?? "",
      leadRef: o.leadId ?? "",
      callRef: o.callRecordId ?? "",
      notes: o.orderNotes.map((n) => n.text).join(" | "),
    }));

    await this.audit.log({ action: "ORDER_EXPORT", userId: actor.userId, entityType: "Order", metadata: { count: rows.length, type: "summary" } });
    await sendExport(res, query.format, "orders-summary", columns, rows);
  }

  @Get("export/with-items")
  @Roles(UserRole.ADMIN)
  @RequirePermission(Permission.ORDERS_EXPORT)
  async exportWithItems(@Query() query: any, @Res() res: Response, @CurrentUser() actor: AuthenticatedUser) {
    const orders = await this.prisma.order.findMany({
      where: buildExportWhere(query),
      include: {
        responsibleUser: { select: { fullName: true } },
        partner: { select: { name: true } },
        items: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const columns = [
      { header: "External Order Number", key: "externalOrderNumber" },
      { header: "Customer Name", key: "customerName" },
      { header: "Customer Phone", key: "customerPhone" },
      { header: "Order Type", key: "orderType" },
      { header: "Partner", key: "partner" },
      { header: "Responsible Agent", key: "responsibleAgent" },
      { header: "Order Status", key: "status" },
      { header: "Item Code", key: "itemCode" },
      { header: "Arabic Item Name", key: "arabicName" },
      { header: "English Item Name", key: "englishName" },
      { header: "Quantity", key: "quantity" },
      { header: "Unit Price", key: "unitPrice" },
      { header: "Line Value", key: "lineValue" },
      { header: "Order Expected Value", key: "expectedValue" },
      { header: "Order Completed Value", key: "completedValue" },
      { header: "Created Date", key: "createdDate" },
      { header: "Completion Date", key: "completionDate" },
      { header: "Next Refill Date", key: "nextRefillDate" },
    ];

    const rows: Record<string, unknown>[] = [];
    for (const o of orders) {
      const base = {
        externalOrderNumber: o.externalOrderNumber,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        orderType: o.orderType,
        partner: o.partner?.name ?? "",
        responsibleAgent: o.responsibleUser.fullName,
        status: o.status,
        expectedValue: o.expectedValue ?? "",
        completedValue: o.completedValue ?? "",
        createdDate: o.createdAt.toISOString(),
        completionDate: o.completedAt?.toISOString() ?? "",
        nextRefillDate: o.nextRefillDate?.toISOString() ?? "",
      };
      if (o.items.length === 0) {
        rows.push({ ...base, itemCode: "", arabicName: "", englishName: "", quantity: "", unitPrice: "", lineValue: "" });
      } else {
        for (const item of o.items) {
          rows.push({
            ...base,
            itemCode: item.itemCodeSnapshot ?? "",
            arabicName: item.arabicNameSnapshot ?? "",
            englishName: item.englishNameSnapshot ?? "",
            quantity: item.quantity,
            unitPrice: item.unitPrice ?? "",
            lineValue: item.lineValue ?? "",
          });
        }
      }
    }

    await this.audit.log({ action: "ORDER_EXPORT", userId: actor.userId, entityType: "Order", metadata: { count: rows.length, type: "with-items" } });
    await sendExport(res, query.format, "orders-with-items", columns, rows);
  }
}

function parseFilters(query: any) {
  return {
    dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
    dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    status: query.status,
    orderType: query.orderType,
    source: query.source,
    partnerId: query.partnerId,
    responsibleUserIdFilter: query.responsibleUserId,
    customerPhone: query.customerPhone,
    customerName: query.customerName,
    externalOrderNumber: query.externalOrderNumber,
    itemSearch: query.itemSearch,
    page: query.page ? Number(query.page) : undefined,
    pageSize: query.pageSize ? Number(query.pageSize) : undefined,
  };
}

function buildExportWhere(query: any) {
  const where: Record<string, unknown> = {
    status: query.status,
    orderType: query.orderType,
    source: query.source,
    partnerId: query.partnerId,
    teamId: query.teamId,
    responsibleUserId: query.responsibleUserId,
  };
  if (query.dateFrom || query.dateTo) {
    where.createdAt = { gte: query.dateFrom ? new Date(query.dateFrom) : undefined, lte: query.dateTo ? new Date(query.dateTo) : undefined };
  }
  return where;
}

async function sendExport(
  res: Response,
  format: string | undefined,
  fileBaseName: string,
  columns: { header: string; key: string }[],
  rows: Record<string, unknown>[],
) {
  if (format === "csv") {
    const csv = buildCsv(columns, rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileBaseName}.csv"`);
    res.send(csv);
    return;
  }
  const buffer = await buildExcelBuffer(fileBaseName, columns, rows);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fileBaseName}.xlsx"`);
  res.send(buffer);
}
