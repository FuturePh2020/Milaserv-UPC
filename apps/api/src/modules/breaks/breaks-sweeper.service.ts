import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BreaksService } from './breaks.service';

/**
 * Break Tracker periodic sweep (spec §6) — same in-process pattern as the SLA
 * sweeper (BullMQ remains the documented upgrade slot):
 *   1. WORK periods past the idle threshold → IDLE (server-side guarantee
 *      even when the client stops sending heartbeats, §11.2)
 *   2. Sessions with heartbeat silence past break.session_auto_end_hours →
 *      auto-end with endReason AUTO (spec C4)
 *   3. Running breaks that crossed today's allowance → overage notification
 *
 * BREAK_SWEEP_INTERVAL_SECONDS, 0 = disabled (tests call sweep() directly).
 */
@Injectable()
export class BreaksSweeperService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BreaksSweeperService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly breaks: BreaksService,
  ) {}

  onApplicationBootstrap() {
    const seconds = Number(process.env.BREAK_SWEEP_INTERVAL_SECONDS ?? 60);
    if (seconds > 0) {
      this.timer = setInterval(() => {
        void this.sweep().catch((e) => this.logger.error(`Break sweep failed: ${e}`));
      }, seconds * 1000);
      this.timer.unref();
    }
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now = new Date()): Promise<{ idled: number; autoEnded: number; overages: number }> {
    const sessions = await this.prisma.workSession.findMany({
      where: { status: 'ACTIVE' },
      include: { periods: { where: { endedAt: null } } },
    });

    let idled = 0;
    let autoEnded = 0;
    let overages = 0;

    for (const session of sessions) {
      const cfg = await this.breaks.config({ teamId: session.teamId });

      const silentSeconds = (now.getTime() - session.lastHeartbeatAt.getTime()) / 1000;
      if (silentSeconds >= cfg.sessionAutoEndHours * 3600) {
        await this.breaks.finalizeSession(session, 'AUTO', now);
        autoEnded++;
        continue;
      }

      const open = session.periods[0];
      if (open?.type === 'WORK') {
        const before = open.id;
        await this.breaks.applyIdleRules(session, now);
        const reloaded = await this.prisma.workPeriod.findFirst({
          where: { sessionId: session.id, endedAt: null },
        });
        if (reloaded && reloaded.id !== before) idled++;
      } else if (open?.type === 'BREAK') {
        const notified = await this.prisma.notification.count({
          where: {
            userId: session.userId,
            type: 'break.overage',
            createdAt: { gte: startOfToday() },
          },
        });
        await this.breaks.checkOverage(session, now);
        const after = await this.prisma.notification.count({
          where: {
            userId: session.userId,
            type: 'break.overage',
            createdAt: { gte: startOfToday() },
          },
        });
        if (after > notified) overages++;
      }
    }
    return { idled, autoEnded, overages };
  }
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
