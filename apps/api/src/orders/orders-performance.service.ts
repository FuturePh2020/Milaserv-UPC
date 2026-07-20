import { Injectable } from "@nestjs/common";
import { OrderStatus, OrderType, PENDING_COMPLETION_STATUSES } from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(monthKey: string): { start: Date; end: Date } {
  const [year, month] = monthKey.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const now = new Date();
  const isCurrentMonth = monthKey === currentMonthKey();
  const end = isCurrentMonth ? now : new Date(Date.UTC(year, month, 0, 23, 59, 59));
  return { start, end };
}

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}

@Injectable()
export class OrdersPerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async computeCore(where: Record<string, unknown>) {
    const orders = await this.prisma.order.findMany({ where, select: { status: true, orderType: true, completedValue: true } });
    const totalOrders = orders.length;
    const completedOrders = orders.filter((o) => o.status === OrderStatus.COMPLETED).length;
    const cashOrders = orders.filter((o) => o.orderType === OrderType.CASH).length;
    const insuranceOrders = orders.filter((o) => o.orderType === OrderType.INSURANCE).length;
    const cashCompletedSales = orders
      .filter((o) => o.orderType === OrderType.CASH && o.status === OrderStatus.COMPLETED)
      .reduce((sum, o) => sum + (o.completedValue ?? 0), 0);
    const insuranceCompletedSales = orders
      .filter((o) => o.orderType === OrderType.INSURANCE && o.status === OrderStatus.COMPLETED)
      .reduce((sum, o) => sum + (o.completedValue ?? 0), 0);
    return {
      totalOrders,
      completedOrders,
      cashOrders,
      insuranceOrders,
      cashCompletedSales,
      insuranceCompletedSales,
      totalCompletedSales: cashCompletedSales + insuranceCompletedSales,
    };
  }

  private async computePendingCompletion(where: Record<string, unknown>) {
    const pending = await this.prisma.order.findMany({
      where: { ...where, status: { in: PENDING_COMPLETION_STATUSES } },
      select: { expectedValue: true },
    });
    return {
      pendingCompletionOrdersCount: pending.length,
      pendingCompletionValue: pending.reduce((sum, o) => sum + (o.expectedValue ?? 0), 0),
    };
  }

  async agentPerformance(agentId: string, monthKey = currentMonthKey()) {
    const { start, end } = monthRange(monthKey);
    const core = await this.computeCore({ responsibleUserId: agentId, createdAt: { gte: start, lte: end } });
    const pending = await this.computePendingCompletion({ responsibleUserId: agentId });
    const target = await this.prisma.orderTarget.findFirst({ where: { agentId, effectiveMonth: monthKey } });

    const cashTarget = target?.cashTarget ?? 0;
    const insuranceTarget = target?.insuranceTarget ?? 0;
    const totalTarget = target?.totalTarget ?? cashTarget + insuranceTarget;

    return {
      ...core,
      ...pending,
      cashTarget,
      insuranceTarget,
      totalTarget,
      cashTargetAchievementPct: safeDivide(core.cashCompletedSales, cashTarget) * 100,
      insuranceTargetAchievementPct: safeDivide(core.insuranceCompletedSales, insuranceTarget) * 100,
      totalTargetAchievementPct: safeDivide(core.totalCompletedSales, totalTarget) * 100,
      month: monthKey,
    };
  }

  async teamPerformance(
    teamId: string,
    monthKey = currentMonthKey(),
    filters?: {
      useFilters: boolean;
      dateFrom?: Date;
      dateTo?: Date;
      status?: string;
      orderType?: string;
      responsibleUserId?: string;
      partnerId?: string;
      source?: string;
    },
  ) {
    const where: Record<string, unknown> = { teamId };
    if (filters?.useFilters) {
      if (filters.dateFrom || filters.dateTo) {
        where.createdAt = { gte: filters.dateFrom, lte: filters.dateTo };
      }
      if (filters.status) where.status = filters.status;
      if (filters.orderType) where.orderType = filters.orderType;
      if (filters.responsibleUserId) where.responsibleUserId = filters.responsibleUserId;
      if (filters.partnerId) where.partnerId = filters.partnerId;
      if (filters.source) where.source = filters.source;
    } else {
      const { start, end } = monthRange(monthKey);
      where.createdAt = { gte: start, lte: end };
    }

    const core = await this.computeCore(where);
    const pending = await this.computePendingCompletion({ teamId });
    const target = await this.prisma.orderTarget.findFirst({ where: { teamId, effectiveMonth: monthKey } });

    const cashTarget = target?.cashTarget ?? 0;
    const insuranceTarget = target?.insuranceTarget ?? 0;
    const totalTarget = target?.totalTarget ?? cashTarget + insuranceTarget;

    return {
      ...core,
      ...pending,
      cashTarget,
      insuranceTarget,
      totalTarget,
      cashTargetAchievementPct: safeDivide(core.cashCompletedSales, cashTarget) * 100,
      insuranceTargetAchievementPct: safeDivide(core.insuranceCompletedSales, insuranceTarget) * 100,
      totalTargetAchievementPct: safeDivide(core.totalCompletedSales, totalTarget) * 100,
      month: monthKey,
      filtered: Boolean(filters?.useFilters),
    };
  }

  async listTargets(params: { agentId?: string; teamId?: string; effectiveMonth?: string }) {
    return this.prisma.orderTarget.findMany({
      where: params,
      include: { agent: { select: { id: true, fullName: true } }, team: { select: { id: true, name: true } } },
      orderBy: { effectiveMonth: "desc" },
    });
  }

  async upsertTarget(
    dto: { agentId?: string; teamId?: string; cashTarget: number; insuranceTarget: number; totalTarget?: number; effectiveMonth: string },
    actorId: string,
  ) {
    const totalTarget = dto.totalTarget ?? dto.cashTarget + dto.insuranceTarget;

    // agentId/teamId are nullable, so a plain @@unique wouldn't actually
    // prevent duplicates here — Postgres never considers two NULLs equal
    // for uniqueness purposes, so e.g. two agent-scoped rows (teamId always
    // NULL) for the same agent+month wouldn't violate a
    // (agentId, teamId, effectiveMonth) constraint. An advisory lock around
    // the check-then-act closes the same race two admins hit setting the
    // same agent's target for the same month concurrently.
    const lockKey = `order-target:${dto.agentId ?? "none"}:${dto.teamId ?? "none"}:${dto.effectiveMonth}`;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey);
      const existing = await tx.orderTarget.findFirst({
        where: { agentId: dto.agentId ?? null, teamId: dto.teamId ?? null, effectiveMonth: dto.effectiveMonth },
      });
      return existing
        ? tx.orderTarget.update({
            where: { id: existing.id },
            data: { cashTarget: dto.cashTarget, insuranceTarget: dto.insuranceTarget, totalTarget },
          })
        : tx.orderTarget.create({
            data: {
              agentId: dto.agentId,
              teamId: dto.teamId,
              cashTarget: dto.cashTarget,
              insuranceTarget: dto.insuranceTarget,
              totalTarget,
              effectiveMonth: dto.effectiveMonth,
            },
          });
    });

    await this.audit.log({
      action: "ORDER_UPDATE",
      userId: actorId,
      entityType: "OrderTarget",
      entityId: result.id,
      metadata: dto,
    });

    return result;
  }
}
