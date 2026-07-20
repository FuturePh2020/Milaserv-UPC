import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  AssignmentSource,
  AssignmentStatus,
  DistributionStrategy,
  LeadWorkflowStatus,
  StatusChangeSource,
} from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService } from "../settings/settings.service";
import { RedisLockService } from "../redis/redis-lock.service";

function orderByClause(strategy: string): Prisma.Sql {
  switch (strategy) {
    case DistributionStrategy.HIGHEST_PRIORITY:
      return Prisma.sql`l.priority DESC, l."importedAt" ASC`;
    case DistributionStrategy.PARTNER_PRIORITY:
      return Prisma.sql`p.priority DESC, l."importedAt" ASC`;
    case DistributionStrategy.TASK_PRIORITY:
      return Prisma.sql`t.priority DESC, l."importedAt" ASC`;
    case DistributionStrategy.OLDEST_FIRST:
      return Prisma.sql`l."createdAt" ASC`;
    // ROUND_ROBIN / WEIGHTED / REGION_MATCH / CATEGORY_MATCH: agent-balancing
    // strategies that don't have a well-defined meaning in a pull-based
    // ("Generate Lead" button) model. Deferred — see docs/ROADMAP.md.
    // Falls back to FIFO ordering, same as the FIFO case below.
    case DistributionStrategy.FIFO:
    default:
      return Prisma.sql`l."importedAt" ASC`;
  }
}

@Injectable()
export class DistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly redisLock: RedisLockService,
  ) {}

  /**
   * The core atomic lead distribution operation (spec section 7).
   * Eligibility is re-validated inside the DB transaction where it matters
   * (active leads count, hourly rate) to avoid race conditions; cheap
   * checks (session/status/break/permissions) happen first to fail fast.
   */
  async generateLead(agentId: string, requestedTaskId: string | undefined, meta: { ipAddress: string; userAgent: string }) {
    const lockKey = `lead-distribution:agent:${agentId}`;

    let lockToken: string | null;
    try {
      lockToken = await this.redisLock.acquire(lockKey, 15_000);
    } catch {
      lockToken = null;
    }
    if (!lockToken) {
      throw new BadRequestException("A lead request is already in progress for this agent");
    }

    try {
      return await this.doGenerateLead(agentId, requestedTaskId, meta);
    } finally {
      if (lockToken) {
        await this.redisLock.release(lockKey, lockToken).catch(() => undefined);
      }
    }
  }

  private async doGenerateLead(
    agentId: string,
    requestedTaskId: string | undefined,
    meta: { ipAddress: string; userAgent: string },
  ) {
    const agent = await this.prisma.user.findUnique({
      where: { id: agentId },
      include: {
        sessions: { where: { endedAt: null }, take: 1 },
        breakRecords: { where: { status: "ACTIVE" }, take: 1 },
        agentTaskPermissions: { select: { taskId: true } },
        agentPartnerRestrictions: { select: { partnerId: true } },
        agentCategoryRestrictions: { select: { categoryId: true } },
      },
    });
    if (!agent) throw new BadRequestException("Agent not found");

    const activeSession = agent.sessions[0];
    if (!activeSession) {
      throw new ForbiddenException("You must start a work session before requesting a lead");
    }
    if (agent.breakRecords.length > 0) {
      throw new ForbiddenException("You are currently on a break");
    }
    if (agent.currentAgentStatus !== "AVAILABLE") {
      throw new ForbiddenException(`You must be Available to request a lead (current status: ${agent.currentAgentStatus})`);
    }

    const permittedTaskIds = agent.agentTaskPermissions.map((p) => p.taskId);
    if (permittedTaskIds.length === 0) {
      throw new ForbiddenException("You are not authorized to perform any task yet. Contact your admin.");
    }
    if (requestedTaskId && !permittedTaskIds.includes(requestedTaskId)) {
      throw new ForbiddenException("You are not authorized to perform this task");
    }
    const eligibleTaskIds = requestedTaskId ? [requestedTaskId] : permittedTaskIds;

    const partnerRestrictions = agent.agentPartnerRestrictions.map((r) => r.partnerId);
    const categoryRestrictions = agent.agentCategoryRestrictions.map((r) => r.categoryId);

    const distSettings = await this.settings.getDistributionSettings();

    if (distSettings.strategy === DistributionStrategy.MANUAL) {
      throw new BadRequestException("Lead distribution is set to manual mode. Ask an admin to assign a lead.");
    }

    if (distSettings.maxLeadsPerHour > 0) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentCount = await this.prisma.leadAssignment.count({
        where: { agentId, assignedAt: { gte: oneHourAgo } },
      });
      if (recentCount >= distSettings.maxLeadsPerHour) {
        throw new ForbiddenException("You have reached your hourly lead generation limit");
      }
    }

    const activeAssignmentsCount = await this.prisma.leadAssignment.count({
      where: { agentId, releasedAt: null, taskCompletionStatus: { in: ["PENDING", "IN_PROGRESS"] } },
    });

    if (!distSettings.allowNextBeforeCompletion && activeAssignmentsCount > 0) {
      throw new ForbiddenException("Complete your current lead before requesting another");
    }
    if (distSettings.allowNextBeforeCompletion && activeAssignmentsCount >= distSettings.maxActiveLeadsPerAgent) {
      throw new ForbiddenException("You have reached the maximum number of active leads allowed");
    }

    const reservedUntil = new Date(Date.now() + distSettings.reservationTimeoutMinutes * 60_000);

    const result = await this.prisma.$transaction(async (tx) => {
      const whereFragments: Prisma.Sql[] = [
        Prisma.sql`l."assignmentStatus" = 'UNASSIGNED'`,
        Prisma.sql`l."isDuplicate" = false`,
        Prisma.sql`l."workflowStatus" IN ('NEW', 'RETURNED_TO_POOL')`,
        Prisma.sql`l."taskId" IN (${Prisma.join(eligibleTaskIds)})`,
      ];
      if (partnerRestrictions.length > 0) {
        whereFragments.push(Prisma.sql`l."partnerId" IN (${Prisma.join(partnerRestrictions)})`);
      }
      if (categoryRestrictions.length > 0) {
        whereFragments.push(Prisma.sql`l."categoryId" IN (${Prisma.join(categoryRestrictions)})`);
      }
      const where = Prisma.join(whereFragments, " AND ");
      const order = orderByClause(distSettings.strategy);

      const rows = await tx.$queryRaw<
        { id: string; partnerId: string; taskId: string | null; workflowStatus: string }[]
      >(
        Prisma.sql`
          SELECT l.id, l."partnerId", l."taskId", l."workflowStatus"
          FROM "Lead" l
          LEFT JOIN "Partner" p ON p.id = l."partnerId"
          LEFT JOIN "Task" t ON t.id = l."taskId"
          WHERE ${where}
          ORDER BY ${order}
          LIMIT 1
          FOR UPDATE OF l SKIP LOCKED
        `,
      );

      const picked = rows[0];
      if (!picked) {
        return null;
      }

      await tx.lead.update({
        where: { id: picked.id },
        data: {
          assignmentStatus: AssignmentStatus.ASSIGNED,
          workflowStatus: LeadWorkflowStatus.ASSIGNED,
          reservedAt: new Date(),
          reservedUntil,
          assignedAgentId: agentId,
        },
      });

      const assignment = await tx.leadAssignment.create({
        data: {
          leadId: picked.id,
          agentId,
          taskId: picked.taskId,
          partnerId: picked.partnerId,
          source: AssignmentSource.AUTO_DISTRIBUTION,
        },
      });

      await tx.leadStatusHistory.create({
        data: {
          leadId: picked.id,
          previousStatus: picked.workflowStatus as LeadWorkflowStatus,
          newStatus: LeadWorkflowStatus.ASSIGNED,
          changedByUserId: agentId,
          source: StatusChangeSource.SYSTEM,
          notes: "Auto-distributed via Generate Lead",
        },
      });

      await tx.user.update({ where: { id: agentId }, data: { currentAgentStatus: "WORKING_ON_LEAD" } });

      await tx.auditLog.create({
        data: {
          action: "LEAD_ASSIGNED",
          userId: agentId,
          entityType: "Lead",
          entityId: picked.id,
          metadata: { assignmentId: assignment.id, source: "AUTO_DISTRIBUTION", strategy: distSettings.strategy },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      });

      return tx.lead.findUnique({ where: { id: picked.id }, include: { partner: true, category: true, task: true } });
    });

    if (!result) {
      throw new BadRequestException("No eligible leads are currently available");
    }

    return result;
  }
}
