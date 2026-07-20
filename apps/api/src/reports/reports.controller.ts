import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { Response } from "express";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ReportsService } from "./reports.service";
import { buildExcelBuffer, buildCsv } from "./report-export.util";

function parseDates(query: any) {
  return { from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined };
}

@ApiTags("reports")
@ApiBearerAuth()
@Controller("reports")
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get("lead-imports")
  leadImports(@Query() query: any) {
    return this.reportsService.leadImportReport({ ...parseDates(query), partnerId: query.partnerId });
  }

  @Get("lead-imports/export")
  async leadImportsExport(@Query() query: any, @Res() res: Response) {
    const rows = await this.reportsService.leadImportReport({ ...parseDates(query), partnerId: query.partnerId });
    await this.sendExport(
      res,
      query.format,
      "lead-import-report",
      [
        { header: "Partner", key: "partner" },
        { header: "File Name", key: "fileName" },
        { header: "Status", key: "status" },
        { header: "Total Rows", key: "totalRows" },
        { header: "Success", key: "successRows" },
        { header: "Failed", key: "failedRows" },
        { header: "Duplicates", key: "duplicateRows" },
        { header: "Created At", key: "createdAt" },
      ],
      rows.map((r) => ({
        partner: r.partner?.name,
        fileName: r.fileName,
        status: r.status,
        totalRows: r.totalRows,
        successRows: r.successRows,
        failedRows: r.failedRows,
        duplicateRows: r.duplicateRows,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  }

  @Get("lead-assignments")
  leadAssignments(@Query() query: any) {
    return this.reportsService.leadAssignmentReport({
      ...parseDates(query),
      partnerId: query.partnerId,
      taskId: query.taskId,
      agentId: query.agentId,
    });
  }

  @Get("lead-assignments/export")
  async leadAssignmentsExport(@Query() query: any, @Res() res: Response) {
    const rows = await this.reportsService.leadAssignmentReport({
      ...parseDates(query),
      partnerId: query.partnerId,
      taskId: query.taskId,
      agentId: query.agentId,
    });
    await this.sendExport(
      res,
      query.format,
      "lead-assignment-report",
      [
        { header: "Lead", key: "customerName" },
        { header: "Phone", key: "phone" },
        { header: "Agent", key: "agent" },
        { header: "Partner", key: "partner" },
        { header: "Task", key: "task" },
        { header: "Workflow Status", key: "workflowStatus" },
        { header: "Task Completion", key: "taskCompletionStatus" },
        { header: "Assigned At", key: "assignedAt" },
      ],
      rows.map((r) => ({
        customerName: r.lead.customerName,
        phone: r.lead.primaryPhone,
        agent: r.agent.fullName,
        partner: r.partner.name,
        task: r.task?.name ?? "",
        workflowStatus: r.lead.workflowStatus,
        taskCompletionStatus: r.taskCompletionStatus,
        assignedAt: r.assignedAt.toISOString(),
      })),
    );
  }

  @Get("untouched-leads")
  untouchedLeads(@Query() query: any) {
    return this.reportsService.untouchedLeadsReport({
      type: query.type ?? "NO_ACTIVITY",
      ageMinutes: query.ageMinutes ? Number(query.ageMinutes) : undefined,
      partnerId: query.partnerId,
      taskId: query.taskId,
      categoryId: query.categoryId,
      agentId: query.agentId,
      batchId: query.batchId,
      ...parseDates(query),
    });
  }

  @Get("untouched-leads/export")
  async untouchedLeadsExport(@Query() query: any, @Res() res: Response) {
    const rows = await this.reportsService.untouchedLeadsReport({
      type: query.type ?? "NO_ACTIVITY",
      ageMinutes: query.ageMinutes ? Number(query.ageMinutes) : undefined,
      partnerId: query.partnerId,
      taskId: query.taskId,
      categoryId: query.categoryId,
      agentId: query.agentId,
      batchId: query.batchId,
      ...parseDates(query),
    });
    await this.sendExport(
      res,
      query.format,
      "untouched-leads-report",
      [
        { header: "Lead", key: "customerName" },
        { header: "Phone", key: "phone" },
        { header: "Partner", key: "partner" },
        { header: "Category", key: "category" },
        { header: "Task", key: "task" },
        { header: "Workflow Status", key: "workflowStatus" },
        { header: "Assignment Status", key: "assignmentStatus" },
        { header: "Imported At", key: "importedAt" },
      ],
      rows.map((r: any) => ({
        customerName: r.customerName,
        phone: r.primaryPhone,
        partner: r.partner?.name,
        category: r.category?.name,
        task: r.task?.name ?? "",
        workflowStatus: r.workflowStatus,
        assignmentStatus: r.assignmentStatus,
        importedAt: r.importedAt?.toISOString?.() ?? "",
      })),
    );
  }

  private async sendExport(
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
}
