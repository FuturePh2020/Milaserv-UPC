import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * SLA Engine timers (spec US-8). Periodic sweep:
 *   ON_TRACK → WARNING  at the policy's warning threshold
 *   ON_TRACK/WARNING → BREACHED past resolutionDueAt (+ auto-escalation)
 * First-response breaches notify without changing state.
 *
 * Runs in-process on an interval (SLA_SWEEP_INTERVAL_SECONDS, 0 = disabled —
 * tests call sweep() directly). Upgrade slot: move to a BullMQ worker when
 * ticket volume justifies a dedicated process.
 */
@Injectable()
export class SlaSweeperService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SlaSweeperService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: TimelineService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap() {
    const seconds = Number(process.env.SLA_SWEEP_INTERVAL_SECONDS ?? 60);
    if (seconds > 0) {
      this.timer = setInterval(() => {
        void this.sweep().catch((e) => this.logger.error(`SLA sweep failed: ${e}`));
      }, seconds * 1000);
      this.timer.unref();
    }
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now = new Date()): Promise<{ warned: number; breached: number }> {
    const candidates = await this.prisma.ticket.findMany({
      where: {
        deletedAt: null,
        slaState: { in: ['ON_TRACK', 'WARNING'] },
        status: { kind: 'OPEN' },
        slaPolicyId: { not: null },
      },
      include: { slaPolicy: true, status: true, teams: true },
    });

    let warned = 0;
    let breached = 0;
    for (const ticket of candidates) {
      const policy = ticket.slaPolicy;
      if (!policy || !ticket.resolutionDueAt) continue;

      if (now > ticket.resolutionDueAt) {
        breached++;
        await this.markBreached(ticket.id, ticket.internalNumber, ticket.status.key, {
          responsibleId: ticket.responsibleId,
          teamIds: ticket.teams.map((t) => t.teamId),
        });
        continue;
      }

      if (ticket.slaState === 'ON_TRACK') {
        const totalMs = policy.resolutionMinutes * 60_000;
        const warnAt = new Date(
          ticket.resolutionDueAt.getTime() - totalMs * (1 - policy.warningThresholdPct / 100),
        );
        if (now >= warnAt) {
          warned++;
          await this.prisma.ticket.update({
            where: { id: ticket.id },
            data: { slaState: 'WARNING' },
          });
          await this.timeline.record({
            entityType: 'ticket',
            entityId: ticket.id,
            eventType: 'sla_warning',
            payload: { dueAt: ticket.resolutionDueAt.toISOString() },
          });
          if (ticket.responsibleId) {
            await this.notifications.notify({
              userId: ticket.responsibleId,
              type: 'ticket.sla_warning',
              titleAr: `تحذير SLA للتذكرة: ${ticket.internalNumber}`,
              titleEn: `SLA warning for ticket: ${ticket.internalNumber}`,
              payload: { entityType: 'ticket', entityId: ticket.id },
            });
          }
        }
      }

      // First-response breach: notify once (state unchanged, spec US-8).
      if (
        !ticket.firstRespondedAt &&
        ticket.firstResponseDueAt &&
        now > ticket.firstResponseDueAt &&
        ticket.responsibleId
      ) {
        const alreadyNotified = await this.prisma.timelineEvent.findFirst({
          where: {
            entityType: 'ticket',
            entityId: ticket.id,
            eventType: 'sla_first_response_breach',
          },
        });
        if (!alreadyNotified) {
          await this.timeline.record({
            entityType: 'ticket',
            entityId: ticket.id,
            eventType: 'sla_first_response_breach',
          });
          await this.notifications.notify({
            userId: ticket.responsibleId,
            type: 'ticket.sla_first_response_breach',
            titleAr: `تجاوز زمن الاستجابة الأولى: ${ticket.internalNumber}`,
            titleEn: `First-response SLA breached: ${ticket.internalNumber}`,
            payload: { entityType: 'ticket', entityId: ticket.id },
          });
        }
      }
    }
    return { warned, breached };
  }

  private async markBreached(
    ticketId: string,
    internalNumber: string,
    currentStatusKey: string,
    notify: { responsibleId: string | null; teamIds: string[] },
  ) {
    // Auto-escalation per policy (system actor — matrix transition when defined).
    const escalated = await this.prisma.ticketStatus.findFirst({ where: { key: 'ESCALATED' } });
    const current = await this.prisma.ticketStatus.findFirst({
      where: { key: currentStatusKey },
    });
    const transitionExists =
      escalated &&
      current &&
      (await this.prisma.statusTransition.findUnique({
        where: {
          fromStatusId_toStatusId: { fromStatusId: current.id, toStatusId: escalated.id },
        },
      }));

    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        slaState: 'BREACHED',
        ...(transitionExists && escalated ? { statusId: escalated.id } : {}),
      },
    });
    await this.timeline.record({
      entityType: 'ticket',
      entityId: ticketId,
      eventType: 'sla_breached',
      payload: { autoEscalated: Boolean(transitionExists) },
    });

    const leads = await this.prisma.teamMember.findMany({
      where: { teamId: { in: notify.teamIds }, role: { in: ['LEADER', 'MANAGER'] } },
      select: { userId: true },
    });
    const userIds = [
      ...new Set([notify.responsibleId, ...leads.map((l) => l.userId)].filter(Boolean)),
    ] as string[];
    await this.notifications.notifyMany(userIds, {
      type: 'ticket.sla_breached',
      titleAr: `خرق SLA للتذكرة: ${internalNumber}`,
      titleEn: `SLA breached for ticket: ${internalNumber}`,
      payload: { entityType: 'ticket', entityId: ticketId },
    });
  }
}
