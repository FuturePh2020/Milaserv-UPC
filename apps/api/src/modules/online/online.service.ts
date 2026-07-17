import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { skipTake, toPage } from '../../core/pagination';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { IngestOrdersDto, ListOnlineOrdersQueryDto, OnlineStatsQueryDto } from './online.dto';

const ONLINE_TYPE_KEYS = ['ONLINE_ISSUE', 'ONLINE_REQUEST'] as const;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Online Operation & Ordering (blueprint §13,
 * spec docs/specs/online-operation-spec-v1.0.md). Issues/requests ride the
 * universal ticket engine (spec F1); orders are integration-owned records —
 * company-wide operational data, visible to any online.view holder.
 */
@Injectable()
export class OnlineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async catalogs() {
    const [orderSources, requestSources] = await Promise.all([
      this.prisma.orderSource.findMany({ where: { active: true }, orderBy: { key: 'asc' } }),
      this.prisma.requestSource.findMany({ where: { active: true }, orderBy: { key: 'asc' } }),
    ]);
    return { orderSources, requestSources };
  }

  // ── Order ingest (§13 Daily Orders — integration readiness, F4) ────

  async ingest(actor: AuthUser, dto: IngestOrdersDto, meta: { ip?: string }) {
    const sources = new Set(
      (await this.prisma.orderSource.findMany({ where: { active: true } })).map((s) => s.key),
    );
    let accepted = 0;
    const rejected: { index: number; reason: string }[] = [];

    for (const [index, row] of dto.orders.entries()) {
      if (!sources.has(row.orderSourceKey)) {
        rejected.push({ index, reason: `Unknown order source: ${row.orderSourceKey}` });
        continue;
      }
      // Idempotent by externalNumber (§21.1): re-sends update, never duplicate.
      await this.prisma.onlineOrder.upsert({
        where: { externalNumber: row.externalNumber },
        update: {
          orderSourceKey: row.orderSourceKey,
          orderedAt: new Date(row.orderedAt),
          customerName: row.customerName ?? null,
          customerPhone: row.customerPhone ?? null,
          value: row.value ?? null,
          externalStatus: row.externalStatus ?? null,
        },
        create: {
          externalNumber: row.externalNumber,
          orderSourceKey: row.orderSourceKey,
          orderedAt: new Date(row.orderedAt),
          customerName: row.customerName ?? null,
          customerPhone: row.customerPhone ?? null,
          value: row.value ?? null,
          externalStatus: row.externalStatus ?? null,
        },
      });
      accepted++;
    }

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'online.orders_ingest',
      entityType: 'online_order',
      after: { accepted, rejected: rejected.length },
      ...meta,
    });
    return { accepted, rejected };
  }

  list(q: ListOnlineOrdersQueryDto) {
    const where: Prisma.OnlineOrderWhereInput = {
      ...(q.sourceKey ? { orderSourceKey: q.sourceKey } : {}),
      ...(q.from || q.to
        ? {
            orderedAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lt: nextDay(q.to) } : {}),
            },
          }
        : {}),
      ...(q.q
        ? {
            OR: [
              { externalNumber: { contains: q.q, mode: 'insensitive' as const } },
              { customerName: { contains: q.q, mode: 'insensitive' as const } },
              { customerPhone: { contains: q.q } },
            ],
          }
        : {}),
    };
    return this.prisma
      .$transaction([
        this.prisma.onlineOrder.findMany({
          where,
          include: { orderSource: true },
          orderBy: { orderedAt: 'desc' },
          ...skipTake(q),
        }),
        this.prisma.onlineOrder.count({ where }),
      ])
      .then(([items, total]) => toPage(items, total, q));
  }

  // ── §13 day counters (spec F6) ─────────────────────────────────────

  async stats(q: OnlineStatsQueryDto) {
    const day = q.date ?? new Date().toISOString().slice(0, 10);
    const from = new Date(day);
    const to = nextDay(day);

    const types = await this.prisma.ticketType.findMany({
      where: { key: { in: [...ONLINE_TYPE_KEYS] } },
    });
    const typeIdByKey = new Map(types.map((t) => [t.key, t.id]));

    const dailyOrders = await this.prisma.onlineOrder.count({
      where: { orderedAt: { gte: from, lt: to } },
    });

    const perType: Record<string, { open: number; closedToday: number; handledToday: number }> = {};
    for (const key of ONLINE_TYPE_KEYS) {
      const typeId = typeIdByKey.get(key) ?? 'none';
      const [open, closedToday, handledToday] = await Promise.all([
        this.prisma.ticket.count({
          where: { typeId, deletedAt: null, status: { kind: 'OPEN' } },
        }),
        this.prisma.ticket.count({
          where: { typeId, deletedAt: null, closedAt: { gte: from, lt: to } },
        }),
        this.prisma.ticket.count({
          where: { typeId, deletedAt: null, resolvedAt: { gte: from, lt: to } },
        }),
      ]);
      perType[key] = { open, closedToday, handledToday };
    }

    // Handling Time + SLA Achievement over the day's resolved online tickets.
    const resolved = await this.prisma.ticket.findMany({
      where: {
        typeId: { in: [...typeIdByKey.values()] },
        deletedAt: null,
        resolvedAt: { gte: from, lt: to },
      },
      select: { createdAt: true, resolvedAt: true, slaState: true },
    });
    const handlingMinutes = resolved
      .filter((t) => t.resolvedAt)
      .map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 60_000);
    const avgHandlingMinutes = handlingMinutes.length
      ? round1(handlingMinutes.reduce((a, b) => a + b, 0) / handlingMinutes.length)
      : null;
    const slaAchievementPct = resolved.length
      ? round1((resolved.filter((t) => t.slaState !== 'BREACHED').length / resolved.length) * 100)
      : null;

    return {
      date: day,
      dailyOrders,
      issues: perType.ONLINE_ISSUE,
      requests: perType.ONLINE_REQUEST,
      avgHandlingMinutes,
      slaAchievementPct,
    };
  }
}

function nextDay(day: string): Date {
  const d = new Date(day);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
