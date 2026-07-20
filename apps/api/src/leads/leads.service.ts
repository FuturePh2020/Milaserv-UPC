import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AssignmentStatus, LeadWorkflowStatus, StatusChangeSource, TaskCompletionStatus } from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

const TERMINAL_STATUSES: string[] = [
  LeadWorkflowStatus.COMPLETED,
  LeadWorkflowStatus.CONVERTED,
  LeadWorkflowStatus.INVALID_NUMBER,
  LeadWorkflowStatus.NOT_INTERESTED,
  LeadWorkflowStatus.DUPLICATE,
];

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAllForAdmin(params: {
    partnerId?: string;
    categoryId?: string;
    taskId?: string;
    workflowStatus?: string;
    assignmentStatus?: string;
    batchId?: string;
    agentId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = params.page ?? 1;
    const pageSize = Math.min(params.pageSize ?? 50, 200);
    const where = {
      partnerId: params.partnerId,
      categoryId: params.categoryId,
      taskId: params.taskId,
      workflowStatus: params.workflowStatus as any,
      assignmentStatus: params.assignmentStatus as any,
      batchId: params.batchId,
      assignedAgentId: params.agentId,
      OR: params.search
        ? [
            { customerName: { contains: params.search, mode: "insensitive" as const } },
            { primaryPhone: { contains: params.search } },
            { externalReference: { contains: params.search, mode: "insensitive" as const } },
          ]
        : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: { partner: true, category: true, task: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findMyActive(agentId: string) {
    return this.prisma.leadAssignment.findMany({
      where: { agentId, releasedAt: null },
      include: { lead: { include: { partner: true, category: true, task: true } } },
      orderBy: { assignedAt: "desc" },
    });
  }

  async findMyStatsToday(agentId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [completedToday, totalAssigned, activeAssignments] = await Promise.all([
      this.prisma.leadAssignment.count({
        where: { agentId, taskCompletionStatus: TaskCompletionStatus.COMPLETED, assignedAt: { gte: startOfDay } },
      }),
      this.prisma.leadAssignment.count({ where: { agentId } }),
      this.prisma.leadAssignment.count({ where: { agentId, releasedAt: null } }),
    ]);

    return { completedToday, totalAssigned, activeAssignments };
  }

  async updateOutcome(
    leadId: string,
    agentId: string,
    dto: { workflowStatus: string; businessOutcome?: string; notes?: string; callbackAt?: string },
  ) {
    const assignment = await this.prisma.leadAssignment.findFirst({
      where: { leadId, agentId, releasedAt: null },
      include: { lead: true },
    });
    if (!assignment) {
      throw new ForbiddenException("This lead is not currently assigned to you");
    }

    const previousStatus = assignment.lead.workflowStatus;
    const isTerminal = TERMINAL_STATUSES.includes(dto.workflowStatus);
    const isReturnToPool = dto.workflowStatus === LeadWorkflowStatus.RETURNED_TO_POOL;

    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: leadId },
        data: {
          workflowStatus: dto.workflowStatus as any,
          assignmentStatus: isReturnToPool ? AssignmentStatus.UNASSIGNED : undefined,
          assignedAgentId: isReturnToPool ? null : undefined,
        },
      });

      await tx.leadAssignment.update({
        where: { id: assignment.id },
        data: {
          businessOutcome: (dto.businessOutcome as any) ?? undefined,
          callbackAt: dto.callbackAt ? new Date(dto.callbackAt) : undefined,
          lastActivityAt: new Date(),
          taskCompletionStatus: isTerminal
            ? TaskCompletionStatus.COMPLETED
            : TaskCompletionStatus.IN_PROGRESS,
          releasedAt: isTerminal || isReturnToPool ? new Date() : undefined,
          releaseReason: isReturnToPool ? "Returned to pool by agent" : undefined,
        },
      });

      await tx.leadStatusHistory.create({
        data: {
          leadId,
          previousStatus,
          newStatus: dto.workflowStatus as any,
          changedByUserId: agentId,
          source: StatusChangeSource.AGENT,
          notes: dto.notes,
        },
      });

      if (isTerminal || isReturnToPool) {
        const remainingActive = await tx.leadAssignment.count({
          where: { agentId, releasedAt: null, taskCompletionStatus: { in: ["PENDING", "IN_PROGRESS"] } },
        });
        if (remainingActive === 0) {
          const agent = await tx.user.findUnique({ where: { id: agentId } });
          if (agent?.currentAgentStatus === "WORKING_ON_LEAD") {
            await tx.user.update({ where: { id: agentId }, data: { currentAgentStatus: "AVAILABLE" } });
          }
        }
      }
    });

    await this.audit.log({
      action: "LEAD_STATUS_UPDATE",
      userId: agentId,
      entityType: "Lead",
      entityId: leadId,
      metadata: { previousStatus, newStatus: dto.workflowStatus, businessOutcome: dto.businessOutcome },
    });

    return this.prisma.lead.findUnique({ where: { id: leadId }, include: { partner: true, category: true, task: true } });
  }

  async adminReassign(leadId: string, newAgentId: string, actorId: string, reason: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead not found");

    await this.prisma.$transaction(async (tx) => {
      await tx.leadAssignment.updateMany({
        where: { leadId, releasedAt: null },
        data: { releasedAt: new Date(), releaseReason: reason || "Reassigned by admin" },
      });
      await tx.leadAssignment.create({
        data: { leadId, agentId: newAgentId, taskId: lead.taskId, partnerId: lead.partnerId, source: "REASSIGNMENT" },
      });
      await tx.lead.update({
        where: { id: leadId },
        data: { assignmentStatus: AssignmentStatus.ASSIGNED, assignedAgentId: newAgentId },
      });
      await tx.leadStatusHistory.create({
        data: {
          leadId,
          previousStatus: lead.workflowStatus,
          newStatus: lead.workflowStatus,
          changedByUserId: actorId,
          source: StatusChangeSource.ADMIN,
          notes: `Reassigned: ${reason || "no reason given"}`,
        },
      });
    });

    await this.audit.log({
      action: "LEAD_REASSIGNED",
      userId: actorId,
      entityType: "Lead",
      entityId: leadId,
      metadata: { newAgentId, reason },
    });

    return this.prisma.lead.findUnique({ where: { id: leadId } });
  }

  async adminReturnToPool(leadId: string, actorId: string, reason: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead not found");

    await this.prisma.$transaction(async (tx) => {
      await tx.leadAssignment.updateMany({
        where: { leadId, releasedAt: null },
        data: { releasedAt: new Date(), releaseReason: reason || "Returned to pool by admin" },
      });
      await tx.lead.update({
        where: { id: leadId },
        data: {
          assignmentStatus: AssignmentStatus.UNASSIGNED,
          workflowStatus: LeadWorkflowStatus.RETURNED_TO_POOL,
          assignedAgentId: null,
          reservedAt: null,
          reservedUntil: null,
        },
      });
      await tx.leadStatusHistory.create({
        data: {
          leadId,
          previousStatus: lead.workflowStatus,
          newStatus: LeadWorkflowStatus.RETURNED_TO_POOL,
          changedByUserId: actorId,
          source: StatusChangeSource.ADMIN,
          notes: reason,
        },
      });
    });

    await this.audit.log({
      action: "LEAD_RETURNED_TO_POOL",
      userId: actorId,
      entityType: "Lead",
      entityId: leadId,
      metadata: { reason },
    });

    return this.prisma.lead.findUnique({ where: { id: leadId } });
  }

  async adminMarkStatus(leadId: string, status: string, actorId: string, notes?: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead not found");

    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id: leadId }, data: { workflowStatus: status as any } });
      await tx.leadStatusHistory.create({
        data: {
          leadId,
          previousStatus: lead.workflowStatus,
          newStatus: status as any,
          changedByUserId: actorId,
          source: StatusChangeSource.ADMIN,
          notes,
        },
      });
    });

    await this.audit.log({
      action: "LEAD_STATUS_UPDATE",
      userId: actorId,
      entityType: "Lead",
      entityId: leadId,
      metadata: { newStatus: status, notes },
    });

    return this.prisma.lead.findUnique({ where: { id: leadId } });
  }
}
