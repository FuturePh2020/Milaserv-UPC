import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

interface Range {
  from: Date;
  to: Date;
}

interface Tally {
  calls: number;
  leadIds: Set<string>;
  talkSeconds: number;
  ordersCreated: number;
  ordersCompleted: number;
  ordersOpen: number;
  salesValue: number;
}

const emptyTally = (): Tally => ({
  calls: 0,
  leadIds: new Set(),
  talkSeconds: 0,
  ordersCreated: 0,
  ordersCompleted: 0,
  ordersOpen: 0,
  salesValue: 0,
});

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * §14.5 Telesales KPIs, computed live from LeadCall/TelesalesOrder (spec E5)
 * and exposed to the §12 performance engine. USER rows per agent; TEAM rows
 * aggregate the team's members.
 */
@Injectable()
export class TelesalesKpiService {
  constructor(private readonly prisma: PrismaService) {}

  /** Adds `SCOPE:id:metricKey → value` entries into the dashboard map. */
  async add(
    into: Map<string, number>,
    userIds: string[],
    teamIds: string[],
    range: Range,
  ): Promise<void> {
    const members = teamIds.length
      ? await this.prisma.teamMember.findMany({
          where: { teamId: { in: teamIds } },
          select: { teamId: true, userId: true },
        })
      : [];
    const allUserIds = [...new Set([...userIds, ...members.map((m) => m.userId)])];
    if (allUserIds.length === 0) return;

    const [calls, orders, completions] = await Promise.all([
      this.prisma.leadCall.findMany({
        where: { agentId: { in: allUserIds }, createdAt: { gte: range.from, lt: range.to } },
        select: { agentId: true, leadId: true, durationSeconds: true },
      }),
      this.prisma.telesalesOrder.findMany({
        where: { createdById: { in: allUserIds }, createdAt: { gte: range.from, lt: range.to } },
        select: { createdById: true, status: true, value: true },
      }),
      // Completed Orders counts completions that happened in the period,
      // regardless of when the order was created (spec E5 table).
      this.prisma.telesalesOrder.findMany({
        where: {
          createdById: { in: allUserIds },
          completedAt: { gte: range.from, lt: range.to },
        },
        select: { createdById: true },
      }),
    ]);

    const perUser = new Map<string, Tally>();
    const tallyOf = (id: string) => {
      const t = perUser.get(id) ?? emptyTally();
      perUser.set(id, t);
      return t;
    };
    for (const c of calls) {
      const t = tallyOf(c.agentId);
      t.calls += 1;
      t.leadIds.add(c.leadId);
      t.talkSeconds += c.durationSeconds;
    }
    for (const o of orders) {
      const t = tallyOf(o.createdById);
      t.ordersCreated += 1;
      t.salesValue += Number(o.value);
      if (o.status === 'OPEN') t.ordersOpen += 1;
    }
    for (const o of completions) tallyOf(o.createdById).ordersCompleted += 1;

    for (const id of userIds) {
      const t = perUser.get(id);
      if (t) this.emit(into, 'USER', id, t);
    }
    for (const teamId of teamIds) {
      const ids = members.filter((m) => m.teamId === teamId).map((m) => m.userId);
      const merged = emptyTally();
      for (const id of ids) {
        const t = perUser.get(id);
        if (!t) continue;
        merged.calls += t.calls;
        for (const leadId of t.leadIds) merged.leadIds.add(leadId);
        merged.talkSeconds += t.talkSeconds;
        merged.ordersCreated += t.ordersCreated;
        merged.ordersCompleted += t.ordersCompleted;
        merged.ordersOpen += t.ordersOpen;
        merged.salesValue += t.salesValue;
      }
      if (merged.calls || merged.ordersCreated || merged.ordersCompleted) {
        this.emit(into, 'TEAM', teamId, merged);
      }
    }
  }

  private emit(into: Map<string, number>, scope: 'USER' | 'TEAM', id: string, t: Tally) {
    const set = (key: string, value: number) => into.set(`${scope}:${id}:${key}`, value);
    set('ts_calls', t.calls);
    set('ts_leads_called', t.leadIds.size);
    set('ts_orders_created', t.ordersCreated);
    set('ts_completed_orders', t.ordersCompleted);
    set('ts_open_orders', t.ordersOpen);
    set('ts_sales_value', round1(t.salesValue));
    if (t.calls > 0) {
      set('ts_aht', round1(t.talkSeconds / t.calls));
      set('ts_talk_time', t.talkSeconds);
    }
    if (t.leadIds.size > 0) {
      set('ts_conversion_rate', round1((t.ordersCreated / t.leadIds.size) * 100));
    }
  }
}
