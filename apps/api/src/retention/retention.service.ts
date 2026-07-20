import { Injectable, NotFoundException } from "@nestjs/common";
import { EventSource } from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";
import { TimelineService } from "../timeline/timeline.service";
import { AuditService } from "../audit/audit.service";

type OrderWithItems = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  partnerId: string | null;
  orderType: string;
  externalOrderNumber: string;
  completedAt: Date | null;
  nextRefillDate: Date | null;
  responsibleUserId: string;
  items: { arabicNameSnapshot: string | null; englishNameSnapshot: string | null; quantity: number }[];
};

@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
  ) {}

  /** Called when an Order is completed (spec section 16). */
  async upsertFromOrder(order: OrderWithItems) {
    const data = {
      customerId: order.customerId,
      name: order.customerName,
      phone: order.customerPhone,
      partnerId: order.partnerId ?? undefined,
      orderType: order.orderType as any,
      lastOrderNumber: order.externalOrderNumber,
      lastOrderDate: order.completedAt ?? new Date(),
      lastItems: order.items.map((i) => ({ name: i.englishNameSnapshot ?? i.arabicNameSnapshot, quantity: i.quantity })) as any,
      nextRefillDate: order.nextRefillDate,
      responsibleAgentId: order.responsibleUserId,
      customerSource: "Completed Order",
    };

    const existing = await this.prisma.retentionCustomer.findUnique({ where: { customerId: order.customerId } });
    const rc = existing
      ? await this.prisma.retentionCustomer.update({ where: { id: existing.id }, data })
      : await this.prisma.retentionCustomer.create({ data });

    if (order.nextRefillDate) {
      await this.prisma.refillSchedule.create({
        data: {
          retentionCustomerId: rc.id,
          orderId: order.id,
          scheduledDate: order.nextRefillDate,
          mode: "EXACT_DATE",
          status: "PENDING",
        },
      });
    }

    await this.timeline.record({
      entityType: "RetentionCustomer",
      entityId: rc.id,
      eventType: existing ? "RETENTION_CUSTOMER_UPDATED" : "RETENTION_CUSTOMER_CREATED",
      source: EventSource.SYSTEM,
      newValue: { fromOrderId: order.id, lastOrderNumber: order.externalOrderNumber },
    });

    return rc;
  }

  /** Called from the "Already Dispensed" call outcome (spec section 3/16). */
  async upsertFromAlreadyDispensed(params: {
    leadId: string;
    customerName: string;
    customerPhone: string;
    partnerId?: string;
    agentId: string;
    lastDispensingDate: Date;
    expectedNextRefillDate?: Date;
  }) {
    const existing = await this.prisma.retentionCustomer.findFirst({ where: { phone: params.customerPhone } });
    const data = {
      name: params.customerName,
      phone: params.customerPhone,
      partnerId: params.partnerId,
      lastDispensingDate: params.lastDispensingDate,
      nextRefillDate: params.expectedNextRefillDate,
      responsibleAgentId: params.agentId,
      customerSource: "Already Dispensed Outcome",
    };
    const rc = existing
      ? await this.prisma.retentionCustomer.update({ where: { id: existing.id }, data })
      : await this.prisma.retentionCustomer.create({ data });

    await this.timeline.record({
      entityType: "RetentionCustomer",
      entityId: rc.id,
      eventType: existing ? "RETENTION_CUSTOMER_UPDATED" : "RETENTION_CUSTOMER_CREATED",
      source: EventSource.AGENT,
      actorUserId: params.agentId,
      newValue: { fromLeadId: params.leadId, reason: "already_dispensed" },
    });

    return rc;
  }

  async createManual(dto: Record<string, unknown>, actorId: string) {
    const rc = await this.prisma.retentionCustomer.create({ data: dto as any });
    await this.timeline.record({
      entityType: "RetentionCustomer",
      entityId: rc.id,
      eventType: "RETENTION_CUSTOMER_CREATED",
      actorUserId: actorId,
      source: EventSource.ADMIN,
      newValue: dto,
    });
    return rc;
  }

  async update(id: string, dto: Record<string, unknown>, actorId: string) {
    const existing = await this.prisma.retentionCustomer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Retention customer not found");
    const rc = await this.prisma.retentionCustomer.update({ where: { id }, data: dto as any });
    await this.timeline.record({
      entityType: "RetentionCustomer",
      entityId: id,
      eventType: "RETENTION_CUSTOMER_UPDATED",
      actorUserId: actorId,
      source: EventSource.ADMIN,
      previousValue: existing,
      newValue: dto,
    });
    await this.audit.log({ action: "RETENTION_CUSTOMER_UPDATE", userId: actorId, entityType: "RetentionCustomer", entityId: id, metadata: dto });
    return rc;
  }

  async list(filters: { search?: string; partnerId?: string; responsibleAgentId?: string; isActive?: boolean }) {
    return this.prisma.retentionCustomer.findMany({
      where: {
        partnerId: filters.partnerId,
        responsibleAgentId: filters.responsibleAgentId,
        isActive: filters.isActive,
        OR: filters.search
          ? [
              { name: { contains: filters.search, mode: "insensitive" } },
              { phone: { contains: filters.search } },
              { lastOrderNumber: { contains: filters.search } },
            ]
          : undefined,
      },
      include: { partner: { select: { id: true, name: true } }, responsibleAgent: { select: { id: true, fullName: true } } },
      orderBy: { nextRefillDate: "asc" },
      take: 500,
    });
  }

  async findDue(params: { window: string; dateFrom?: Date; dateTo?: Date }) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1);

    let where: Record<string, unknown> = { isActive: true, nextRefillDate: { not: null } };
    switch (params.window) {
      case "TODAY":
        where.nextRefillDate = { gte: startOfToday, lte: endOfToday };
        break;
      case "OVERDUE":
        where.nextRefillDate = { lt: startOfToday };
        break;
      case "TOMORROW": {
        const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
        const endOfTomorrow = new Date(startOfTomorrow.getTime() + 24 * 60 * 60 * 1000 - 1);
        where.nextRefillDate = { gte: startOfTomorrow, lte: endOfTomorrow };
        break;
      }
      case "WITHIN_7_DAYS":
        where.nextRefillDate = { gte: startOfToday, lte: new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000) };
        break;
      case "CUSTOM":
        where.nextRefillDate = { gte: params.dateFrom, lte: params.dateTo };
        break;
      default:
        break;
    }

    return this.prisma.retentionCustomer.findMany({
      where,
      include: { partner: { select: { id: true, name: true } }, responsibleAgent: { select: { id: true, fullName: true } } },
      orderBy: { nextRefillDate: "asc" },
      take: 500,
    });
  }
}
