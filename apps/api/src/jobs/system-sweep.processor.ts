import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { AssignmentStatus, LeadWorkflowStatus, StatusChangeSource } from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService } from "../settings/settings.service";

export const SYSTEM_SWEEP_QUEUE = "system-sweep";

@Processor(SYSTEM_SWEEP_QUEUE)
export class SystemSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(SystemSweepProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {
    super();
  }

  async process(job: Job) {
    if (job.name === "reservation-sweep") {
      return this.reservationSweep();
    }
    if (job.name === "inactivity-sweep") {
      return this.inactivitySweep();
    }
  }

  /** Auto-returns leads whose reservation timeout has elapsed without a status update (spec section 8/10). */
  private async reservationSweep() {
    const distSettings = await this.settings.getDistributionSettings();
    if (!distSettings.autoReturnUntouched) return;

    const expired = await this.prisma.lead.findMany({
      where: {
        assignmentStatus: AssignmentStatus.ASSIGNED,
        workflowStatus: LeadWorkflowStatus.ASSIGNED,
        reservedUntil: { lt: new Date() },
      },
      take: 200,
    });

    for (const lead of expired) {
      await this.prisma.$transaction(async (tx) => {
        await tx.lead.update({
          where: { id: lead.id },
          data: {
            assignmentStatus: AssignmentStatus.UNASSIGNED,
            workflowStatus: LeadWorkflowStatus.RETURNED_TO_POOL,
            assignedAgentId: null,
            reservedAt: null,
            reservedUntil: null,
          },
        });
        await tx.leadAssignment.updateMany({
          where: { leadId: lead.id, releasedAt: null },
          data: { releasedAt: new Date(), releaseReason: "Lead reservation timeout expired" },
        });
        await tx.leadStatusHistory.create({
          data: {
            leadId: lead.id,
            previousStatus: lead.workflowStatus,
            newStatus: LeadWorkflowStatus.RETURNED_TO_POOL,
            source: StatusChangeSource.SYSTEM,
            notes: "Automatic reservation timeout sweep",
          },
        });
      });
      await this.audit.log({
        action: "LEAD_RETURNED_TO_POOL",
        entityType: "Lead",
        entityId: lead.id,
        metadata: { reason: "reservation_timeout" },
      });
    }

    if (expired.length > 0) {
      this.logger.log(`Reservation sweep returned ${expired.length} untouched lead(s) to pool`);
    }
  }

  /** Detects agents idle past the configured threshold and moves them to Standby/Break (spec section 14). */
  private async inactivitySweep() {
    const inactivitySettings = await this.settings.getInactivitySettings();
    if (!inactivitySettings.enabled) return;

    const cutoff = new Date(
      Date.now() - (inactivitySettings.inactivityThresholdMinutes + inactivitySettings.gracePeriodMinutes) * 60_000,
    );

    const idleAgents = await this.prisma.user.findMany({
      where: {
        role: "AGENT",
        currentAgentStatus: "AVAILABLE",
        OR: [{ lastActivityAt: { lt: cutoff } }, { lastActivityAt: null }],
      },
    });

    for (const agent of idleAgents) {
      if (inactivitySettings.actionType === "BREAK" && inactivitySettings.autoBreakTypeId) {
        const session = await this.prisma.agentSession.findFirst({ where: { userId: agent.id, endedAt: null } });
        if (!session) continue;
        await this.prisma.breakRecord.create({
          data: {
            userId: agent.id,
            sessionId: session.id,
            breakTypeId: inactivitySettings.autoBreakTypeId,
            isAutomatic: true,
            source: "SYSTEM",
          },
        });
        await this.prisma.user.update({ where: { id: agent.id }, data: { currentAgentStatus: "ON_BREAK" } });
      } else {
        await this.prisma.user.update({ where: { id: agent.id }, data: { currentAgentStatus: "STANDBY" } });
      }

      const wentToBreak = inactivitySettings.actionType === "BREAK" && inactivitySettings.autoBreakTypeId;
      await this.audit.log({
        action: wentToBreak ? "BREAK_START" : "AGENT_AUTO_STANDBY",
        userId: agent.id,
        entityType: "User",
        entityId: agent.id,
        metadata: { reason: "inactivity_auto_standby", lastActivityAt: agent.lastActivityAt },
      });
    }
  }
}
