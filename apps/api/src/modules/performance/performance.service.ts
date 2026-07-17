import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PerformanceMetricDef, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { skipTake, toPage } from '../../core/pagination';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import { SettingsService } from '../settings/settings.service';
import { TelesalesKpiService } from '../crm/telesales-kpi.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { RequestScope } from '../permissions/scope';
import type {
  DashboardQueryDto,
  IngestMetricsDto,
  ListMetricsQueryDto,
  UpsertTargetDto,
} from './performance.dto';

interface Meta {
  ip?: string;
}

type Period = 'DAILY' | 'MONTHLY' | 'YEARLY';
type Color = 'GREEN' | 'AMBER' | 'RED' | 'GRAY';
type Trend = 'UP' | 'DOWN' | 'FLAT' | null;

interface Range {
  from: Date;
  to: Date;
}

/** UTC period boundaries — metricDate is a plain @db.Date (UTC midnight). */
function periodRange(period: Period, anchor: string): { current: Range; previous: Range } {
  const y = Number(anchor.slice(0, 4));
  const m = Number(anchor.slice(5, 7));
  const d = Number(anchor.slice(8, 10));
  const utc = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd));
  switch (period) {
    case 'DAILY':
      return {
        current: { from: utc(y, m - 1, d), to: utc(y, m - 1, d + 1) },
        previous: { from: utc(y, m - 1, d - 1), to: utc(y, m - 1, d) },
      };
    case 'MONTHLY':
      return {
        current: { from: utc(y, m - 1, 1), to: utc(y, m, 1) },
        previous: { from: utc(y, m - 2, 1), to: utc(y, m - 1, 1) },
      };
    case 'YEARLY':
      return {
        current: { from: utc(y, 0, 1), to: utc(y + 1, 0, 1) },
        previous: { from: utc(y - 1, 0, 1), to: utc(y, 0, 1) },
      };
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Customer Care performance (blueprint §12.1/§12.2, Sprint 7).
 * Call KPIs arrive through the integration-ready ingest endpoint (spec D1);
 * Team/Agent SLA are computed live from the ticketing engine (spec D3).
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly settings: SettingsService,
    private readonly telesalesKpis: TelesalesKpiService,
  ) {}

  metricDefs() {
    return this.prisma.performanceMetricDef.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  // ── Ingestion (spec D1/D7, §21.1) ──────────────────────────────────

  async ingest(actor: AuthUser, dto: IngestMetricsDto, meta: Meta) {
    const defs = new Map(
      (await this.prisma.performanceMetricDef.findMany()).map((x) => [x.key, x] as const),
    );
    let accepted = 0;
    const rejected: { index: number; reason: string }[] = [];

    for (const [index, row] of dto.rows.entries()) {
      const def = defs.get(row.metricKey);
      if (!def) {
        rejected.push({ index, reason: `Unknown metric: ${row.metricKey}` });
        continue;
      }
      if (def.source === 'TICKETING') {
        rejected.push({ index, reason: `${row.metricKey} is computed from ticketing (D3)` });
        continue;
      }
      if ((row.userEmail ? 1 : 0) + (row.teamId ? 1 : 0) !== 1) {
        rejected.push({ index, reason: 'Exactly one of userEmail/teamId is required' });
        continue;
      }

      let scopeType: 'USER' | 'TEAM';
      let scopeId: string;
      if (row.userEmail) {
        const user = await this.prisma.user.findFirst({
          where: { email: row.userEmail, deletedAt: null },
        });
        if (!user) {
          rejected.push({ index, reason: `Unknown user: ${row.userEmail}` });
          continue;
        }
        scopeType = 'USER';
        scopeId = user.id;
      } else {
        const team = await this.prisma.team.findFirst({
          where: { id: row.teamId, deletedAt: null },
        });
        if (!team) {
          rejected.push({ index, reason: `Unknown team: ${row.teamId}` });
          continue;
        }
        scopeType = 'TEAM';
        scopeId = team.id;
      }

      const metricDate = new Date(row.date);
      // Idempotent upsert (§21.1): re-sending a day replaces, never duplicates.
      await this.prisma.metricValue.upsert({
        where: {
          metricDate_scopeType_scopeId_metricKey: {
            metricDate,
            scopeType,
            scopeId,
            metricKey: row.metricKey,
          },
        },
        update: { value: row.value },
        create: { metricDate, scopeType, scopeId, metricKey: row.metricKey, value: row.value },
      });
      accepted++;
    }

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'performance.ingest',
      entityType: 'metric_value',
      after: { accepted, rejected: rejected.length },
      ...meta,
    });
    return { accepted, rejected };
  }

  // ── Raw metrics (scoped) ───────────────────────────────────────────

  async metrics(scope: RequestScope, q: ListMetricsQueryDto) {
    const { userIds, teamIds } = await this.entitiesInScope(scope, q.teamId);
    const where: Prisma.MetricValueWhereInput = {
      AND: [
        {
          OR: [
            { scopeType: 'USER', scopeId: { in: q.userId ? [q.userId] : userIds } },
            { scopeType: 'TEAM', scopeId: { in: teamIds } },
          ],
        },
        ...(q.userId && !userIds.includes(q.userId) ? [{ id: 'none' }] : []),
        ...(q.metricKey ? [{ metricKey: q.metricKey }] : []),
        ...(q.from ? [{ metricDate: { gte: new Date(q.from) } }] : []),
        ...(q.to ? [{ metricDate: { lte: new Date(q.to) } }] : []),
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.metricValue.findMany({
        where,
        include: { metric: true },
        orderBy: [{ metricDate: 'desc' }, { metricKey: 'asc' }],
        ...skipTake(q),
      }),
      this.prisma.metricValue.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  // ── Dashboard (§12.2: Actual, Target, Achievement %, Trend, color) ─

  async dashboard(scope: RequestScope, q: DashboardQueryDto) {
    const anchor = q.date ?? new Date().toISOString().slice(0, 10);
    const { current, previous } = periodRange(q.period, anchor);

    const defs = (await this.metricDefs()).filter((x) => !q.metricKey || x.key === q.metricKey);
    if (q.metricKey && defs.length === 0) throw new NotFoundException('Unknown metric');

    const { userIds, teamIds } = await this.entitiesInScope(scope, q.teamId);
    const [users, teams] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, nameAr: true, nameEn: true },
        orderBy: { nameEn: 'asc' },
      }),
      this.prisma.team.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, nameAr: true, nameEn: true },
        orderBy: { nameEn: 'asc' },
      }),
    ]);

    const [curAgg, prevAgg, targets, thresholds] = await Promise.all([
      this.aggregateValues(userIds, teamIds, current),
      this.aggregateValues(userIds, teamIds, previous),
      this.prisma.performanceTarget.findMany({
        where: {
          active: true,
          period: q.period,
          OR: [
            { scopeType: 'USER', scopeId: { in: userIds } },
            { scopeType: 'TEAM', scopeId: { in: teamIds } },
          ],
        },
      }),
      this.thresholds(),
    ]);
    await Promise.all([
      this.addTicketSla(curAgg, userIds, teamIds, current),
      this.addTicketSla(prevAgg, userIds, teamIds, previous),
      // §14.5 telesales KPIs, live from CRM data (crm spec E5).
      this.telesalesKpis.add(curAgg, userIds, teamIds, current),
      this.telesalesKpis.add(prevAgg, userIds, teamIds, previous),
    ]);

    const targetOf = new Map(
      targets.map((t) => [`${t.scopeType}:${t.scopeId}:${t.metricKey}`, Number(t.targetValue)]),
    );
    const rows = [];
    const entities = [
      ...users.map((u) => ({ scopeType: 'USER' as const, entity: u })),
      ...teams.map((t) => ({ scopeType: 'TEAM' as const, entity: t })),
    ];
    for (const { scopeType, entity } of entities) {
      for (const def of defs) {
        const key = `${scopeType}:${entity.id}:${def.key}`;
        const actual = curAgg.get(key) ?? null;
        const target = targetOf.get(key) ?? null;
        if (actual === null && target === null) continue;
        rows.push({
          scopeType,
          scope: entity,
          metric: {
            key: def.key,
            nameAr: def.nameAr,
            nameEn: def.nameEn,
            unit: def.unit,
            higherIsBetter: def.higherIsBetter,
          },
          actual: actual === null ? null : round1(actual),
          target,
          ...this.assess(def, actual, target, prevAgg.get(key) ?? null, thresholds),
        });
      }
    }
    return { period: q.period, from: current.from, to: current.to, rows };
  }

  private assess(
    def: PerformanceMetricDef,
    actual: number | null,
    target: number | null,
    prev: number | null,
    th: { green: number; amber: number; flat: number },
  ): { achievementPct: number | null; trend: Trend; color: Color } {
    // Achievement (spec D6): invert the ratio for lower-is-better metrics.
    let achievementPct: number | null = null;
    if (actual !== null && target !== null && target > 0) {
      const ratio = def.higherIsBetter ? actual / target : actual > 0 ? target / actual : 9.99;
      achievementPct = Math.min(999, round1(ratio * 100));
    }

    // Trend (spec D5): raw value direction vs the previous period.
    let trend: Trend = null;
    if (actual !== null && prev !== null) {
      const tolerance = (Math.abs(prev) * th.flat) / 100;
      trend = actual > prev + tolerance ? 'UP' : actual < prev - tolerance ? 'DOWN' : 'FLAT';
    }

    // Color state (spec D4): thresholds from settings; no target → GRAY.
    const color: Color =
      achievementPct === null
        ? 'GRAY'
        : achievementPct >= th.green
          ? 'GREEN'
          : achievementPct >= th.amber
            ? 'AMBER'
            : 'RED';
    return { achievementPct, trend, color };
  }

  private async thresholds() {
    return {
      green: Number(await this.settings.resolve('performance.green_from_pct')),
      amber: Number(await this.settings.resolve('performance.amber_from_pct')),
      flat: Number(await this.settings.resolve('performance.trend_flat_pct')),
    };
  }

  /** Aggregate ingested daily rows into period actuals (SUM or AVG per def). */
  private async aggregateValues(userIds: string[], teamIds: string[], range: Range) {
    const values = await this.prisma.metricValue.findMany({
      where: {
        metricDate: { gte: range.from, lt: range.to },
        OR: [
          { scopeType: 'USER', scopeId: { in: userIds } },
          { scopeType: 'TEAM', scopeId: { in: teamIds } },
        ],
      },
      include: { metric: { select: { aggregation: true } } },
    });
    const sums = new Map<string, { sum: number; n: number; avg: boolean }>();
    for (const v of values) {
      const key = `${v.scopeType}:${v.scopeId}:${v.metricKey}`;
      const acc = sums.get(key) ?? { sum: 0, n: 0, avg: v.metric.aggregation === 'AVG' };
      acc.sum += Number(v.value);
      acc.n += 1;
      sums.set(key, acc);
    }
    const out = new Map<string, number>();
    for (const [key, acc] of sums) out.set(key, acc.avg ? acc.sum / acc.n : acc.sum);
    return out;
  }

  /** Spec D3: agent_sla / team_sla live from tickets resolved in the range. */
  private async addTicketSla(
    into: Map<string, number>,
    userIds: string[],
    teamIds: string[],
    range: Range,
  ) {
    const tickets = await this.prisma.ticket.findMany({
      where: {
        deletedAt: null,
        resolvedAt: { gte: range.from, lt: range.to },
        OR: [{ resolvedById: { in: userIds } }, { teams: { some: { teamId: { in: teamIds } } } }],
      },
      select: {
        resolvedById: true,
        slaState: true,
        teams: { select: { teamId: true } },
      },
    });
    const tally = new Map<string, { ok: number; total: number }>();
    const bump = (key: string, ok: boolean) => {
      const t = tally.get(key) ?? { ok: 0, total: 0 };
      t.total += 1;
      if (ok) t.ok += 1;
      tally.set(key, t);
    };
    for (const t of tickets) {
      const ok = t.slaState !== 'BREACHED';
      if (t.resolvedById && userIds.includes(t.resolvedById)) {
        bump(`USER:${t.resolvedById}:agent_sla`, ok);
      }
      for (const tt of t.teams) {
        if (teamIds.includes(tt.teamId)) bump(`TEAM:${tt.teamId}:team_sla`, ok);
      }
    }
    for (const [key, t] of tally) into.set(key, (t.ok / t.total) * 100);
  }

  // ── Targets (§12.2) ────────────────────────────────────────────────

  async listTargets(scope: RequestScope, teamId?: string) {
    const { userIds, teamIds } = await this.entitiesInScope(scope, teamId);
    return this.prisma.performanceTarget.findMany({
      where: {
        OR: [
          { scopeType: 'USER', scopeId: { in: userIds } },
          { scopeType: 'TEAM', scopeId: { in: teamIds } },
        ],
      },
      include: { metric: { select: { key: true, nameAr: true, nameEn: true, unit: true } } },
      orderBy: [{ scopeType: 'asc' }, { metricKey: 'asc' }, { period: 'asc' }],
    });
  }

  async upsertTarget(actor: AuthUser, dto: UpsertTargetDto, meta: Meta) {
    const def = await this.prisma.performanceMetricDef.findUnique({
      where: { key: dto.metricKey },
    });
    if (!def) throw new BadRequestException(`Unknown metric: ${dto.metricKey}`);
    const entity =
      dto.scopeType === 'USER'
        ? await this.prisma.user.findFirst({ where: { id: dto.scopeId, deletedAt: null } })
        : await this.prisma.team.findFirst({ where: { id: dto.scopeId, deletedAt: null } });
    if (!entity) throw new BadRequestException(`Unknown ${dto.scopeType.toLowerCase()}`);

    const where = {
      scopeType_scopeId_metricKey_period: {
        scopeType: dto.scopeType,
        scopeId: dto.scopeId,
        metricKey: dto.metricKey,
        period: dto.period,
      },
    };
    const before = await this.prisma.performanceTarget.findUnique({ where });
    const target = await this.prisma.performanceTarget.upsert({
      where,
      update: { targetValue: dto.targetValue, active: dto.active ?? true },
      create: {
        scopeType: dto.scopeType,
        scopeId: dto.scopeId,
        metricKey: dto.metricKey,
        period: dto.period,
        targetValue: dto.targetValue,
        active: dto.active ?? true,
      },
    });

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: before ? 'performance.target_update' : 'performance.target_create',
      entityType: 'performance_target',
      entityId: target.id,
      before: before ? { targetValue: Number(before.targetValue), active: before.active } : null,
      after: { ...dto },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'performance_target',
      entityId: target.id,
      eventType: before ? 'updated' : 'created',
      actorId: actor.userId,
      payload: { ...dto },
    });
    return target;
  }

  async deleteTarget(actor: AuthUser, id: string, meta: Meta) {
    const target = await this.prisma.performanceTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Target not found');
    await this.prisma.performanceTarget.delete({ where: { id } });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'performance.target_delete',
      entityType: 'performance_target',
      entityId: id,
      before: {
        scopeType: target.scopeType,
        scopeId: target.scopeId,
        metricKey: target.metricKey,
        period: target.period,
        targetValue: Number(target.targetValue),
      },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'performance_target',
      entityId: id,
      eventType: 'deleted',
      actorId: actor.userId,
    });
  }

  // ── Scope resolution (§19.1, same semantics as the other modules) ──

  private async entitiesInScope(
    scope: RequestScope,
    filterTeamId?: string,
  ): Promise<{ userIds: string[]; teamIds: string[] }> {
    let teamIds: string[];
    let userIds: string[];

    switch (scope.scope) {
      case 'ALL_DATA': {
        teamIds = (await this.prisma.team.findMany({ where: { deletedAt: null } })).map(
          (t) => t.id,
        );
        userIds = (await this.prisma.user.findMany({ where: { deletedAt: null } })).map(
          (u) => u.id,
        );
        break;
      }
      case 'DEPARTMENT': {
        const departmentId = scope.context.departmentId ?? 'none';
        teamIds = (
          await this.prisma.team.findMany({ where: { departmentId, deletedAt: null } })
        ).map((t) => t.id);
        userIds = (
          await this.prisma.user.findMany({ where: { departmentId, deletedAt: null } })
        ).map((u) => u.id);
        break;
      }
      case 'MULTIPLE_TEAMS':
      case 'MY_TEAM': {
        teamIds = scope.scope === 'MY_TEAM' ? scope.context.teamIds : (scope.teamIds ?? []);
        const members = await this.prisma.teamMember.findMany({
          where: { teamId: { in: teamIds } },
          select: { userId: true },
        });
        userIds = [...new Set([scope.context.userId, ...members.map((m) => m.userId)])];
        break;
      }
      case 'MY_RECORDS':
      case 'BRANCH':
      case 'PARTNER':
      default:
        teamIds = [];
        userIds = [scope.context.userId];
    }

    if (filterTeamId) {
      if (!teamIds.includes(filterTeamId)) return { userIds: [], teamIds: [] };
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: filterTeamId },
        select: { userId: true },
      });
      const memberIds = new Set(members.map((m) => m.userId));
      return {
        userIds: userIds.filter((id) => memberIds.has(id)),
        teamIds: [filterTeamId],
      };
    }
    return { userIds, teamIds };
  }
}
