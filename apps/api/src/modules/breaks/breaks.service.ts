import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma, WorkPeriod, WorkSession } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { skipTake, toPage } from '../../core/pagination';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { RequestScope } from '../permissions/scope';
import type { HeartbeatDto, ListSessionsQueryDto } from './breaks.dto';

const ENTITY = 'work_session';

interface Meta {
  ip?: string;
}

export interface BreakConfig {
  idleThresholdSeconds: number;
  dailyAllowanceMinutes: number;
  maxConcurrentPerTeam: number;
  offlineThresholdSeconds: number;
  notifyOnOverage: boolean;
  heartbeatIntervalSeconds: number;
  sessionAutoEndHours: number;
}

export type LiveState = 'AVAILABLE' | 'ON_BREAK' | 'IDLE' | 'OFFLINE';

type SessionWithOpenPeriod = WorkSession & { periods: WorkPeriod[] };

const seconds = (from: Date, to: Date) =>
  Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const COUNTER_BY_TYPE = {
  WORK: 'activeSeconds',
  IDLE: 'idleSeconds',
  BREAK: 'breakSeconds',
} as const;

/**
 * Break Tracker & Workforce (blueprint §11, spec docs/specs/break-tracker-spec-v1.0.md).
 * A session is partitioned into WORK/BREAK/IDLE periods; exactly one period is
 * open while the session is ACTIVE. Counters are rollups of closed periods;
 * the open period is added at read time.
 */
@Injectable()
export class BreaksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  // ── Configuration (ADR-008: TEAM → DEPARTMENT → SYSTEM fallback) ──

  async config(ctx?: { departmentId?: string | null; teamId?: string | null }) {
    const num = async (key: string) => Number(await this.settings.resolve(key, ctx));
    return {
      idleThresholdSeconds: await num('break.idle_threshold_seconds'),
      dailyAllowanceMinutes: await num('break.daily_allowance_minutes'),
      maxConcurrentPerTeam: await num('break.max_concurrent_per_team'),
      offlineThresholdSeconds: await num('break.offline_threshold_seconds'),
      notifyOnOverage: Boolean(await this.settings.resolve('break.notify_on_overage', ctx)),
      heartbeatIntervalSeconds: await num('break.heartbeat_interval_seconds'),
      sessionAutoEndHours: await num('break.session_auto_end_hours'),
    } satisfies BreakConfig;
  }

  // ── Session lifecycle (§11.1) ──────────────────────────────────────

  async startSession(user: AuthUser, meta: Meta) {
    // Primary-team snapshot at start (spec §2).
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: user.userId, team: { deletedAt: null } },
      orderBy: { joinedAt: 'asc' },
    });

    const now = new Date();
    let session: WorkSession;
    try {
      session = await this.prisma.workSession.create({
        data: {
          userId: user.userId,
          teamId: membership?.teamId ?? null,
          startedAt: now,
          lastHeartbeatAt: now,
          lastActivityAt: now,
          periods: { create: { type: 'WORK', startedAt: now } },
        },
      });
    } catch (e) {
      // Partial unique index: one ACTIVE session per user (spec §2).
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('An active session already exists');
      }
      throw e;
    }

    await this.timeline.record({
      entityType: ENTITY,
      entityId: session.id,
      eventType: 'session_started',
      actorId: user.userId,
      payload: { teamId: session.teamId },
    });
    await this.audit.record({
      actorId: user.userId,
      actorEmail: user.email,
      action: 'break.session_start',
      entityType: ENTITY,
      entityId: session.id,
      ...meta,
    });
    return this.me(user);
  }

  async endSession(user: AuthUser, meta: Meta) {
    const session = await this.activeSession(user.userId);
    const summary = await this.finalizeSession(session, 'MANUAL', new Date(), user.userId);
    await this.audit.record({
      actorId: user.userId,
      actorEmail: user.email,
      action: 'break.session_end',
      entityType: ENTITY,
      entityId: session.id,
      after: summary,
      ...meta,
    });
    return summary;
  }

  /** Shared by manual end and the sweeper's auto-end (spec C4). */
  async finalizeSession(
    session: SessionWithOpenPeriod,
    endReason: 'MANUAL' | 'AUTO',
    now: Date,
    actorId?: string,
  ) {
    const open = session.periods[0];
    const closed = await this.prisma.$transaction(async (tx) => {
      if (open) await this.closePeriod(tx, session, open, now);
      return tx.workSession.update({
        where: { id: session.id },
        data: { status: 'ENDED', endedAt: now, endReason },
      });
    });
    await this.timeline.record({
      entityType: ENTITY,
      entityId: session.id,
      eventType: 'session_ended',
      actorId: actorId ?? null,
      payload: {
        endReason,
        activeSeconds: closed.activeSeconds,
        idleSeconds: closed.idleSeconds,
        breakSeconds: closed.breakSeconds,
      },
    });
    return {
      id: closed.id,
      startedAt: closed.startedAt,
      endedAt: closed.endedAt,
      endReason: closed.endReason,
      activeSeconds: closed.activeSeconds,
      idleSeconds: closed.idleSeconds,
      breakSeconds: closed.breakSeconds,
    };
  }

  // ── Heartbeat & idle detection (§11.2) ─────────────────────────────

  async heartbeat(user: AuthUser, dto: HeartbeatDto) {
    const session = await this.activeSession(user.userId);
    const now = new Date();

    // Clamp client timestamps to [previous activity, now] — a client can
    // never fabricate activity outside its own session window (spec §4).
    let activityAt = session.lastActivityAt;
    if (dto.lastActivityAt) {
      const provided = new Date(dto.lastActivityAt);
      if (provided > activityAt) activityAt = provided > now ? now : provided;
    }

    await this.prisma.workSession.update({
      where: { id: session.id },
      data: { lastHeartbeatAt: now, lastActivityAt: activityAt },
    });
    session.lastHeartbeatAt = now;
    session.lastActivityAt = activityAt;

    await this.applyIdleRules(session, now);
    return this.me(user);
  }

  /**
   * WORK + inactivity ≥ threshold → IDLE backdated to the start of
   * inactivity (§11.2); IDLE + fresh activity → WORK from the activity time.
   */
  async applyIdleRules(session: SessionWithOpenPeriod, now: Date) {
    const open = session.periods[0];
    if (!open) return;
    const cfg = await this.config({ teamId: session.teamId });

    if (open.type === 'WORK') {
      const idleFor = seconds(session.lastActivityAt, now);
      if (idleFor >= cfg.idleThresholdSeconds) {
        const idleStart =
          session.lastActivityAt > open.startedAt ? session.lastActivityAt : open.startedAt;
        await this.prisma.$transaction(async (tx) => {
          await this.closePeriod(tx, session, open, idleStart);
          await tx.workPeriod.create({
            data: { sessionId: session.id, type: 'IDLE', startedAt: idleStart },
          });
        });
        await this.timeline.record({
          entityType: ENTITY,
          entityId: session.id,
          eventType: 'idle_started',
          payload: { since: idleStart.toISOString() },
        });
        // §11.2: تنبيه الموظف
        await this.notifications.notify({
          userId: session.userId,
          type: 'break.idle_started',
          titleAr: 'تم رصد خمول — هل ما زلت تعمل؟',
          titleEn: 'Idle detected — are you still working?',
          payload: { entityType: ENTITY, entityId: session.id },
        });
      }
    } else if (open.type === 'IDLE' && session.lastActivityAt > open.startedAt) {
      const resumeAt = session.lastActivityAt > now ? now : session.lastActivityAt;
      await this.prisma.$transaction(async (tx) => {
        await this.closePeriod(tx, session, open, resumeAt);
        await tx.workPeriod.create({
          data: { sessionId: session.id, type: 'WORK', startedAt: resumeAt },
        });
      });
      await this.timeline.record({
        entityType: ENTITY,
        entityId: session.id,
        eventType: 'idle_ended',
        payload: { resumedAt: resumeAt.toISOString() },
      });
    }
  }

  // ── Manual breaks (§11.3) ──────────────────────────────────────────

  async startBreak(user: AuthUser, meta: Meta) {
    const session = await this.activeSession(user.userId);
    const open = session.periods[0];
    if (!open || open.type === 'BREAK') {
      throw new UnprocessableEntityException('Already on a break');
    }
    const cfg = await this.config({ teamId: session.teamId });
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Concurrency cap inside the same team (§11.3; per-Team per spec C2).
      if (session.teamId && cfg.maxConcurrentPerTeam > 0) {
        const onBreak = await tx.workPeriod.count({
          where: {
            type: 'BREAK',
            endedAt: null,
            session: { status: 'ACTIVE', teamId: session.teamId },
          },
        });
        if (onBreak >= cfg.maxConcurrentPerTeam) {
          throw new ConflictException(
            `Break limit reached for the team (${cfg.maxConcurrentPerTeam} concurrent)`,
          );
        }
      }
      await this.closePeriod(tx, session, open, now);
      await tx.workPeriod.create({
        data: { sessionId: session.id, type: 'BREAK', startedAt: now },
      });
    });

    await this.timeline.record({
      entityType: ENTITY,
      entityId: session.id,
      eventType: 'break_started',
      actorId: user.userId,
    });
    await this.audit.record({
      actorId: user.userId,
      actorEmail: user.email,
      action: 'break.break_start',
      entityType: ENTITY,
      entityId: session.id,
      ...meta,
    });
    return this.me(user);
  }

  async endBreak(user: AuthUser, meta: Meta) {
    const session = await this.activeSession(user.userId);
    const open = session.periods[0];
    if (!open || open.type !== 'BREAK') {
      throw new UnprocessableEntityException('No break in progress');
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.closePeriod(tx, session, open, now);
      await tx.workPeriod.create({
        data: { sessionId: session.id, type: 'WORK', startedAt: now },
      });
      // Pressing the button is activity.
      await tx.workSession.update({
        where: { id: session.id },
        data: { lastActivityAt: now, lastHeartbeatAt: now },
      });
    });

    await this.timeline.record({
      entityType: ENTITY,
      entityId: session.id,
      eventType: 'break_ended',
      actorId: user.userId,
      payload: { minutes: Math.round(seconds(open.startedAt, now) / 60) },
    });
    await this.audit.record({
      actorId: user.userId,
      actorEmail: user.email,
      action: 'break.break_end',
      entityType: ENTITY,
      entityId: session.id,
      ...meta,
    });
    await this.checkOverage(session, now);
    return this.me(user);
  }

  /** §11.3: notify employee + team supervisor on allowance overage (once/day). */
  async checkOverage(session: WorkSession, now: Date) {
    const cfg = await this.config({ teamId: session.teamId });
    if (!cfg.notifyOnOverage) return;

    const usedMinutes = await this.breakMinutesToday(session.userId, now);
    if (usedMinutes <= cfg.dailyAllowanceMinutes) return;

    const alreadyNotified = await this.prisma.notification.findFirst({
      where: { userId: session.userId, type: 'break.overage', createdAt: { gte: startOfToday() } },
    });
    if (alreadyNotified) return;

    const overBy = usedMinutes - cfg.dailyAllowanceMinutes;
    const leads = session.teamId
      ? await this.prisma.teamMember.findMany({
          where: { teamId: session.teamId, role: { in: ['LEADER', 'MANAGER'] } },
          select: { userId: true },
        })
      : [];
    const userIds = [...new Set([session.userId, ...leads.map((l) => l.userId)])];
    await this.notifications.notifyMany(userIds, {
      type: 'break.overage',
      titleAr: `تجاوز رصيد البريك اليومي بمقدار ${overBy} دقيقة`,
      titleEn: `Daily break allowance exceeded by ${overBy} minutes`,
      payload: { entityType: ENTITY, entityId: session.id, userId: session.userId },
    });
    await this.timeline.record({
      entityType: ENTITY,
      entityId: session.id,
      eventType: 'break_overage',
      payload: { usedMinutes, allowanceMinutes: cfg.dailyAllowanceMinutes },
    });
  }

  // ── Read models ────────────────────────────────────────────────────

  /** Own live summary: session, open period, counters, allowance (§11.1/§11.3). */
  async me(user: AuthUser) {
    const session = await this.prisma.workSession.findFirst({
      where: { userId: user.userId, status: 'ACTIVE' },
      include: { periods: { where: { endedAt: null } } },
    });
    const cfg = await this.config({ teamId: session?.teamId ?? null });
    const now = new Date();
    const usedMinutes = await this.breakMinutesToday(user.userId, now);

    if (!session) {
      return {
        session: null,
        breakAllowance: this.allowance(cfg, usedMinutes),
        config: this.clientConfig(cfg),
      };
    }

    const open = session.periods[0] ?? null;
    const live = {
      activeSeconds: session.activeSeconds,
      idleSeconds: session.idleSeconds,
      breakSeconds: session.breakSeconds,
    };
    if (open) live[COUNTER_BY_TYPE[open.type]] += seconds(open.startedAt, now);

    return {
      session: {
        id: session.id,
        teamId: session.teamId,
        startedAt: session.startedAt,
        currentPeriod: open ? { type: open.type, startedAt: open.startedAt } : null,
        ...live,
      },
      breakAllowance: this.allowance(cfg, usedMinutes),
      config: this.clientConfig(cfg),
    };
  }

  /** Live Team View (§11.3): Available / On Break / Idle / Offline per member. */
  async live(scope: RequestScope) {
    const users = await this.prisma.user.findMany({
      where: { AND: [{ deletedAt: null, status: 'ACTIVE' }, this.usersInScope(scope)] },
      select: {
        id: true,
        nameAr: true,
        nameEn: true,
        teams: {
          select: { team: { select: { id: true, nameAr: true, nameEn: true } } },
          orderBy: { joinedAt: 'asc' },
          take: 1,
        },
        workSessions: {
          where: { status: 'ACTIVE' },
          include: { periods: { where: { endedAt: null } } },
        },
      },
      orderBy: { nameEn: 'asc' },
    });

    const now = new Date();
    const cfg = await this.config();
    const members = [];
    for (const u of users) {
      const session = u.workSessions[0] ?? null;
      const open = session?.periods[0] ?? null;
      let state: LiveState = 'OFFLINE';
      if (session && open) {
        const stale = seconds(session.lastHeartbeatAt, now) > cfg.offlineThresholdSeconds;
        state =
          open.type === 'BREAK'
            ? 'ON_BREAK'
            : stale
              ? 'OFFLINE'
              : open.type === 'IDLE'
                ? 'IDLE'
                : 'AVAILABLE';
      }
      const usedMinutes = await this.breakMinutesToday(u.id, now);
      const teamCfg = session?.teamId ? await this.config({ teamId: session.teamId }) : cfg;
      members.push({
        user: { id: u.id, nameAr: u.nameAr, nameEn: u.nameEn },
        team: u.teams[0]?.team ?? null,
        state,
        since: open?.startedAt ?? null,
        breakAllowance: this.allowance(teamCfg, usedMinutes),
      });
    }
    return { asOf: now, members };
  }

  /** Session history with periods (§11.1 records), scope-filtered. */
  async sessions(scope: RequestScope, q: ListSessionsQueryDto) {
    const where: Prisma.WorkSessionWhereInput = {
      AND: [
        { user: this.usersInScope(scope) },
        ...(q.userId ? [{ userId: q.userId }] : []),
        ...(q.from ? [{ startedAt: { gte: new Date(q.from) } }] : []),
        ...(q.to ? [{ startedAt: { lte: new Date(q.to) } }] : []),
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workSession.findMany({
        where,
        include: {
          user: { select: { id: true, nameAr: true, nameEn: true } },
          team: { select: { id: true, nameAr: true, nameEn: true } },
          periods: { orderBy: { startedAt: 'asc' } },
        },
        orderBy: { startedAt: 'desc' },
        ...skipTake(q),
      }),
      this.prisma.workSession.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  // ── Internals ──────────────────────────────────────────────────────

  private async activeSession(userId: string): Promise<SessionWithOpenPeriod> {
    const session = await this.prisma.workSession.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { periods: { where: { endedAt: null } } },
    });
    if (!session) throw new NotFoundException('No active session');
    return session;
  }

  /** Close a period and roll its duration into the session counter. */
  private async closePeriod(
    tx: Prisma.TransactionClient,
    session: WorkSession,
    period: WorkPeriod,
    at: Date,
  ) {
    const endAt = at > period.startedAt ? at : period.startedAt;
    await tx.workPeriod.update({ where: { id: period.id }, data: { endedAt: endAt } });
    await tx.workSession.update({
      where: { id: session.id },
      data: { [COUNTER_BY_TYPE[period.type]]: { increment: seconds(period.startedAt, endAt) } },
    });
  }

  /** Minutes of manual break consumed today (open break counted live, C6). */
  private async breakMinutesToday(userId: string, now: Date): Promise<number> {
    const periods = await this.prisma.workPeriod.findMany({
      where: { type: 'BREAK', startedAt: { gte: startOfToday() }, session: { userId } },
    });
    const total = periods.reduce((sum, p) => sum + seconds(p.startedAt, p.endedAt ?? now), 0);
    return Math.round(total / 60);
  }

  private allowance(cfg: BreakConfig, usedMinutes: number) {
    return {
      allowanceMinutes: cfg.dailyAllowanceMinutes,
      usedMinutes,
      remainingMinutes: cfg.dailyAllowanceMinutes - usedMinutes,
    };
  }

  private clientConfig(cfg: BreakConfig) {
    return {
      heartbeatIntervalSeconds: cfg.heartbeatIntervalSeconds,
      idleThresholdSeconds: cfg.idleThresholdSeconds,
    };
  }

  /** Data-scope filter over users (§19.1), same semantics as tickets. */
  private usersInScope(scope: RequestScope): Prisma.UserWhereInput {
    const self: Prisma.UserWhereInput = { id: scope.context.userId };
    switch (scope.scope) {
      case 'ALL_DATA':
        return {};
      case 'DEPARTMENT':
        return scope.context.departmentId
          ? { OR: [self, { departmentId: scope.context.departmentId }] }
          : self;
      case 'MULTIPLE_TEAMS':
        return { OR: [self, { teams: { some: { teamId: { in: scope.teamIds ?? [] } } } }] };
      case 'MY_TEAM':
        return scope.context.teamIds.length
          ? { OR: [self, { teams: { some: { teamId: { in: scope.context.teamIds } } } }] }
          : self;
      case 'MY_RECORDS':
      case 'BRANCH':
      case 'PARTNER':
        return self;
    }
  }
}
