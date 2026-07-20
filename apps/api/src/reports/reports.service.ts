import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface DateRangeFilter {
  from?: Date;
  to?: Date;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async leadImportReport(filters: DateRangeFilter & { partnerId?: string }) {
    return this.prisma.leadImportBatch.findMany({
      where: {
        partnerId: filters.partnerId,
        createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
      },
      include: { partner: { select: { id: true, name: true, code: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async leadAssignmentReport(filters: DateRangeFilter & { partnerId?: string; taskId?: string; agentId?: string }) {
    return this.prisma.leadAssignment.findMany({
      where: {
        partnerId: filters.partnerId,
        taskId: filters.taskId,
        agentId: filters.agentId,
        assignedAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
      },
      include: {
        lead: { select: { id: true, customerName: true, primaryPhone: true, workflowStatus: true } },
        agent: { select: { id: true, fullName: true, username: true } },
        partner: { select: { id: true, name: true } },
        task: { select: { id: true, name: true } },
      },
      orderBy: { assignedAt: "desc" },
      take: 5000,
    });
  }

  /**
   * Untouched leads per the configurable definitions in spec section 10.
   * `type` selects which definition to apply; `ageMinutes` parameterizes
   * the "no activity within X minutes" and "never assigned" checks.
   */
  async untouchedLeadsReport(filters: {
    type: "NO_CALL_MADE" | "NO_STATUS_UPDATE" | "NO_ACTIVITY" | "NEVER_ASSIGNED" | "RETURNED_WITHOUT_ACTION";
    ageMinutes?: number;
    partnerId?: string;
    taskId?: string;
    categoryId?: string;
    agentId?: string;
    batchId?: string;
    from?: Date;
    to?: Date;
  }) {
    const ageMinutes = filters.ageMinutes ?? 60;
    const cutoff = new Date(Date.now() - ageMinutes * 60_000);

    const baseWhere = {
      partnerId: filters.partnerId,
      taskId: filters.taskId,
      categoryId: filters.categoryId,
      batchId: filters.batchId,
      createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
    };

    switch (filters.type) {
      case "NEVER_ASSIGNED":
        return this.prisma.lead.findMany({
          where: { ...baseWhere, assignmentStatus: "UNASSIGNED", createdAt: { lte: cutoff, ...(baseWhere.createdAt as any) } },
          include: { partner: true, category: true, task: true },
          take: 2000,
        });
      case "RETURNED_WITHOUT_ACTION":
        return this.prisma.lead.findMany({
          where: { ...baseWhere, workflowStatus: "RETURNED_TO_POOL" },
          include: { partner: true, category: true, task: true },
          take: 2000,
        });
      case "NO_CALL_MADE": {
        const assignedLeadIds = await this.prisma.lead.findMany({
          where: { ...baseWhere, assignmentStatus: { in: ["ASSIGNED", "RESERVED"] } },
          select: { id: true },
        });
        const withCalls = await this.prisma.callRecord.findMany({
          where: { leadId: { in: assignedLeadIds.map((l) => l.id) } },
          select: { leadId: true },
        });
        const calledIds = new Set(withCalls.map((c) => c.leadId));
        const untouchedIds = assignedLeadIds.map((l) => l.id).filter((id) => !calledIds.has(id));
        return this.prisma.lead.findMany({
          where: { id: { in: untouchedIds } },
          include: { partner: true, category: true, task: true },
          take: 2000,
        });
      }
      case "NO_STATUS_UPDATE": {
        const leads = await this.prisma.lead.findMany({
          where: { ...baseWhere, assignmentStatus: { in: ["ASSIGNED", "RESERVED"] } },
          include: { statusHistory: true, partner: true, category: true, task: true },
          take: 2000,
        });
        return leads.filter((l) => l.statusHistory.length <= 1);
      }
      case "NO_ACTIVITY":
      default: {
        const stale = await this.prisma.leadAssignment.findMany({
          where: {
            releasedAt: null,
            assignedAt: { lte: cutoff },
            OR: [{ lastActivityAt: null }, { lastActivityAt: { lte: cutoff } }],
            partnerId: filters.partnerId,
            taskId: filters.taskId,
            agentId: filters.agentId,
          },
          include: { lead: { include: { partner: true, category: true, task: true } } },
          take: 2000,
        });
        return stale.map((a) => a.lead);
      }
    }
  }
}
