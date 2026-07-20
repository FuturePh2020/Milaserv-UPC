import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { EventSource, OrderSource, OrderStatus, OrderType, PENDING_COMPLETION_STATUSES, RefillMode } from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { TimelineService } from "../timeline/timeline.service";
import { CustomersService } from "../customers/customers.service";
import { SettingsService } from "../settings/settings.service";
import { RetentionService } from "../retention/retention.service";

const EXTERNAL_SYSTEM_ID = "DEFAULT";

export interface RequestMetaInput {
  ipAddress: string;
  userAgent: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly customers: CustomersService,
    private readonly settings: SettingsService,
    private readonly retention: RetentionService,
  ) {}

  /** Validates + normalizes an externalOrderNumber per spec section 7/10/20. */
  async validateOrderNumber(raw: string, excludeOrderId?: string): Promise<string> {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) {
      throw new BadRequestException("External Order Number is required");
    }
    const workflowSettings = await this.settings.getCrmWorkflowSettings();
    if (workflowSettings.orderNumberFormat === "DIGITS_ONLY" && !/^\d+$/.test(trimmed)) {
      throw new BadRequestException("External Order Number must contain digits only");
    }
    const existing = await this.prisma.order.findUnique({
      where: { externalSystemId_externalOrderNumber: { externalSystemId: EXTERNAL_SYSTEM_ID, externalOrderNumber: trimmed } },
    });
    if (existing && existing.id !== excludeOrderId) {
      throw new ConflictException("This order number already exists in Milaserv 360.");
    }
    return trimmed;
  }

  async createManual(
    dto: {
      externalOrderNumber: string;
      customerName: string;
      customerPhone: string;
      alternatePhone?: string;
      orderType: string;
      source: string;
      responsibleUserId: string;
      partnerId?: string;
      leadId?: string;
      retentionCustomerId?: string;
      notes?: string;
    },
    actorId: string,
    meta: RequestMetaInput,
  ) {
    const externalOrderNumber = await this.validateOrderNumber(dto.externalOrderNumber);

    if (dto.source === OrderSource.PARTNER && !dto.partnerId) {
      throw new BadRequestException("Partner is required when Order Source is Partner");
    }
    if (dto.source === OrderSource.LEADS && !dto.leadId) {
      throw new BadRequestException("A Lead must be linked when Order Source is Leads");
    }

    const customer = await this.customers.findOrCreate({
      name: dto.customerName,
      phone: dto.customerPhone,
      alternatePhone: dto.alternatePhone,
      source: dto.source,
    });

    let partnerId = dto.partnerId;
    let leadId = dto.leadId;
    if (dto.source === OrderSource.LEADS && dto.leadId) {
      const lead = await this.prisma.lead.findUnique({ where: { id: dto.leadId } });
      if (!lead) throw new NotFoundException("Linked lead not found");
      partnerId = partnerId ?? lead.partnerId;
    }
    if (dto.source === OrderSource.RETENTION_CUSTOMER && dto.retentionCustomerId) {
      const rc = await this.prisma.retentionCustomer.findUnique({ where: { id: dto.retentionCustomerId } });
      partnerId = partnerId ?? rc?.partnerId ?? undefined;
    }

    const responsible = await this.prisma.user.findUnique({ where: { id: dto.responsibleUserId } });
    if (!responsible) throw new NotFoundException("Responsible user not found");

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          externalSystemId: EXTERNAL_SYSTEM_ID,
          externalOrderNumber,
          customerId: customer.id,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          leadId,
          responsibleUserId: dto.responsibleUserId,
          teamId: responsible.teamId,
          partnerId,
          orderType: dto.orderType as any,
          source: dto.source as any,
          status: OrderStatus.PENDING,
        },
      });
      await tx.orderStatusHistory.create({
        data: { orderId: created.id, newStatus: OrderStatus.PENDING, changedByUserId: actorId, source: EventSource.AGENT },
      });
      if (dto.notes) {
        await tx.orderNote.create({
          data: { orderId: created.id, authorId: actorId, authorRole: "AGENT", text: dto.notes },
        });
      }
      return created;
    });

    await this.timeline.record({
      entityType: "Order",
      entityId: order.id,
      eventType: "ORDER_CREATED",
      actorUserId: actorId,
      newValue: { externalOrderNumber, source: dto.source, orderType: dto.orderType },
      source: EventSource.AGENT,
      ipAddress: meta.ipAddress,
    });
    await this.audit.log({
      action: "ORDER_CREATE",
      userId: actorId,
      entityType: "Order",
      entityId: order.id,
      metadata: { externalOrderNumber, source: dto.source },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.findOne(order.id);
  }

  /** Prefills from the Lead/Call/Agent context per spec section 6. */
  async createFromLead(
    params: {
      leadId: string;
      agentId: string;
      callRecordId?: string;
      externalOrderNumber: string;
      notes?: string;
    },
    meta: RequestMetaInput,
  ) {
    const lead = await this.prisma.lead.findUnique({ where: { id: params.leadId }, include: { category: true } });
    if (!lead) throw new NotFoundException("Lead not found");

    const externalOrderNumber = await this.validateOrderNumber(params.externalOrderNumber);
    const customer = await this.customers.findOrCreate({
      name: lead.customerName,
      phone: lead.primaryPhone,
      alternatePhone: lead.secondaryPhone ?? undefined,
      source: "Leads",
    });
    const agent = await this.prisma.user.findUnique({ where: { id: params.agentId } });
    const orderType = lead.category.code === "CASH" ? OrderType.CASH : OrderType.INSURANCE;

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          externalSystemId: EXTERNAL_SYSTEM_ID,
          externalOrderNumber,
          customerId: customer.id,
          customerName: lead.customerName,
          customerPhone: lead.primaryPhone,
          leadId: lead.id,
          callRecordId: params.callRecordId,
          responsibleUserId: params.agentId,
          teamId: agent?.teamId,
          partnerId: lead.partnerId,
          orderType,
          source: OrderSource.LEADS,
          status: OrderStatus.PENDING,
        },
      });
      await tx.orderStatusHistory.create({
        data: { orderId: created.id, newStatus: OrderStatus.PENDING, changedByUserId: params.agentId, source: EventSource.AGENT },
      });
      if (params.notes) {
        await tx.orderNote.create({
          data: { orderId: created.id, authorId: params.agentId, authorRole: "AGENT", text: params.notes },
        });
      }
      return created;
    });

    await this.timeline.record({
      entityType: "Order",
      entityId: order.id,
      eventType: "ORDER_CREATED",
      actorUserId: params.agentId,
      newValue: { externalOrderNumber, source: "LEADS", leadId: lead.id },
      source: EventSource.AGENT,
      ipAddress: meta.ipAddress,
    });
    await this.timeline.record({
      entityType: "Lead",
      entityId: lead.id,
      eventType: "ORDER_CREATED",
      actorUserId: params.agentId,
      newValue: { orderId: order.id, externalOrderNumber },
      source: EventSource.AGENT,
      ipAddress: meta.ipAddress,
    });

    return this.findOne(order.id);
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        statusHistory: { orderBy: { createdAt: "desc" } },
        orderNotes: { orderBy: { createdAt: "desc" } },
        responsibleUser: { select: { id: true, fullName: true, username: true } },
        partner: { select: { id: true, name: true } },
        customer: true,
        lead: { select: { id: true, customerName: true } },
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  async addItem(
    orderId: string,
    dto: { productId?: string; quantity: number; unitPrice?: number; discount?: number; notes?: string },
    actorId: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Order not found");

    let product = null as Awaited<ReturnType<typeof this.prisma.product.findUnique>> | null;
    let partnerMapping = null as Awaited<ReturnType<typeof this.prisma.productPartner.findUnique>> | null;
    if (dto.productId) {
      product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
      if (!product) throw new NotFoundException("Product not found");
      if (!product.isActive || product.isArchived) {
        throw new BadRequestException("Inactive or archived Items cannot be added to new Orders.");
      }
      if (order.orderType === OrderType.CASH && !product.cashAvailable) {
        throw new BadRequestException("This item is not available for Cash Orders.");
      }
      if (order.orderType === OrderType.INSURANCE && !product.insuranceAvailable) {
        throw new BadRequestException("This item is not available for Insurance Orders.");
      }
      if (order.partnerId) {
        partnerMapping = await this.prisma.productPartner.findUnique({
          where: { productId_partnerId: { productId: product.id, partnerId: order.partnerId } },
        });
        if (partnerMapping && !partnerMapping.active) {
          throw new BadRequestException("This item is not available for the selected Partner.");
        }
      }
    }

    const resolvedPrice = partnerMapping?.partnerPrice ?? product?.defaultPrice ?? null;
    const unitPrice = dto.unitPrice ?? resolvedPrice ?? undefined;
    const lineValue =
      unitPrice !== undefined ? Math.max(0, unitPrice * dto.quantity - (dto.discount ?? 0)) : undefined;

    const item = await this.prisma.orderItem.create({
      data: {
        orderId,
        productId: dto.productId,
        itemCodeSnapshot: product?.itemCode,
        arabicNameSnapshot: product?.arabicName,
        englishNameSnapshot: product?.englishName,
        quantity: dto.quantity,
        unitPrice,
        lineValue,
        discount: dto.discount,
        notes: dto.notes,
      },
    });

    await this.timeline.record({
      entityType: "Order",
      entityId: orderId,
      eventType: "ORDER_ITEM_ADDED",
      actorUserId: actorId,
      newValue: { itemId: item.id, productId: dto.productId, quantity: dto.quantity },
      source: EventSource.AGENT,
    });

    return this.findOne(orderId);
  }

  async removeItem(orderId: string, itemId: string, actorId: string) {
    const item = await this.prisma.orderItem.findFirst({ where: { id: itemId, orderId } });
    if (!item) throw new NotFoundException("Order item not found");
    await this.prisma.orderItem.delete({ where: { id: itemId } });
    await this.timeline.record({
      entityType: "Order",
      entityId: orderId,
      eventType: "ORDER_ITEM_REMOVED",
      actorUserId: actorId,
      previousValue: { itemId, productId: item.productId, quantity: item.quantity },
      source: EventSource.AGENT,
    });
    return this.findOne(orderId);
  }

  async updateItemQuantity(orderId: string, itemId: string, quantity: number, actorId: string) {
    const item = await this.prisma.orderItem.findFirst({ where: { id: itemId, orderId } });
    if (!item) throw new NotFoundException("Order item not found");
    const lineValue = item.unitPrice != null ? Math.max(0, item.unitPrice * quantity - (item.discount ?? 0)) : item.lineValue;
    await this.prisma.orderItem.update({ where: { id: itemId }, data: { quantity, lineValue } });
    await this.timeline.record({
      entityType: "Order",
      entityId: orderId,
      eventType: "ORDER_ITEM_ADDED",
      actorUserId: actorId,
      previousValue: { quantity: item.quantity },
      newValue: { quantity },
      source: EventSource.AGENT,
    });
    return this.findOne(orderId);
  }

  async updateStatus(
    orderId: string,
    dto: {
      status: string;
      completedValue?: number;
      completionDate?: string;
      cancellationReason?: string;
      cancellationNotes?: string;
      notes?: string;
    },
    actorId: string,
    meta: RequestMetaInput,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Order not found");

    const newStatus = dto.status as OrderStatus;
    const data: Record<string, unknown> = { status: newStatus };

    if (newStatus === OrderStatus.COMPLETED) {
      if (dto.completedValue === undefined || dto.completedValue === null || Number.isNaN(Number(dto.completedValue))) {
        throw new BadRequestException("Completed Order Value is required when marking an Order Completed");
      }
      if (dto.completedValue < 0) {
        throw new BadRequestException("Completed Order Value must be greater than or equal to zero");
      }
      data.completedValue = dto.completedValue;
      data.completedAt = dto.completionDate ? new Date(dto.completionDate) : new Date();
    }

    if (newStatus === OrderStatus.CLOSED) {
      if (!dto.cancellationReason) {
        throw new BadRequestException("Cancellation Reason is required when closing an Order");
      }
      data.cancellationReason = dto.cancellationReason;
      data.cancellationNotes = dto.cancellationNotes;
      data.closedAt = new Date();
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Optimistic concurrency: only apply if the order's status is still
      // what we read it as. Without this, two near-simultaneous status
      // updates (e.g. one operator completing an order while another closes
      // it) both read the same pre-transaction snapshot and both commit,
      // silently losing one operator's action and recording the same stale
      // previousStatus on both OrderStatusHistory rows.
      const { count } = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data });
      if (count === 0) {
        throw new ConflictException(
          "This order was updated by someone else in the meantime. Refresh and try again.",
        );
      }
      const result = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          previousStatus: order.status,
          newStatus,
          changedByUserId: actorId,
          source: EventSource.AGENT,
          notes: dto.notes,
        },
      });
      return result;
    });

    await this.timeline.record({
      entityType: "Order",
      entityId: orderId,
      eventType: "ORDER_STATUS_CHANGED",
      actorUserId: actorId,
      previousValue: { status: order.status },
      newValue: { status: newStatus, completedValue: data.completedValue, cancellationReason: data.cancellationReason },
      source: EventSource.AGENT,
      ipAddress: meta.ipAddress,
    });

    if (newStatus === OrderStatus.COMPLETED) {
      const withItems = await this.prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (withItems) {
        await this.retention.upsertFromOrder(withItems);
      }
    }

    return this.findOne(orderId);
  }

  async setExpectedValue(orderId: string, expectedValue: number, actorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Order not found");
    if (expectedValue < 0) throw new BadRequestException("Expected Order Value must be greater than or equal to zero");
    await this.prisma.order.update({ where: { id: orderId }, data: { expectedValue } });
    await this.timeline.record({
      entityType: "Order",
      entityId: orderId,
      eventType: "EXPECTED_VALUE_CHANGED",
      actorUserId: actorId,
      previousValue: { expectedValue: order.expectedValue },
      newValue: { expectedValue },
      source: EventSource.AGENT,
    });
    return this.findOne(orderId);
  }

  async addNote(orderId: string, text: string, visibility: string, actorId: string, actorRole: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Order not found");
    const note = await this.prisma.orderNote.create({
      data: { orderId, authorId: actorId, authorRole: actorRole, text, visibility: visibility || "INTERNAL" },
    });
    await this.timeline.record({
      entityType: "Order",
      entityId: orderId,
      eventType: "NOTE_ADDED",
      actorUserId: actorId,
      newValue: { text },
      source: EventSource.AGENT,
    });
    return note;
  }

  async updateNextRefill(
    orderId: string,
    dto: { mode: string; days?: number; exactDate?: string },
    actorId: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Order not found");

    let nextRefillDate: Date;
    if (dto.mode === RefillMode.NUMBER_OF_DAYS) {
      if (!dto.days || dto.days <= 0) throw new BadRequestException("Number of days must be a positive integer");
      nextRefillDate = new Date(Date.now() + dto.days * 24 * 60 * 60 * 1000);
    } else {
      if (!dto.exactDate) throw new BadRequestException("An exact date is required");
      nextRefillDate = new Date(dto.exactDate);
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        nextRefillDate,
        refillIntervalDays: dto.mode === RefillMode.NUMBER_OF_DAYS ? dto.days : null,
        refillMode: dto.mode as any,
      },
    });

    await this.timeline.record({
      entityType: "Order",
      entityId: orderId,
      eventType: "NEXT_REFILL_CHANGED",
      actorUserId: actorId,
      previousValue: { nextRefillDate: order.nextRefillDate },
      newValue: { nextRefillDate, mode: dto.mode },
      source: EventSource.AGENT,
    });

    return this.findOne(orderId);
  }

  async myOrders(agentId: string, filters: OrderFilters) {
    return this.queryOrders({ ...filters, responsibleUserId: agentId });
  }

  async teamOrders(teamId: string, filters: OrderFilters) {
    return this.queryOrders({ ...filters, teamId });
  }

  private async queryOrders(filters: OrderFilters & { responsibleUserId?: string; teamId?: string }) {
    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.pageSize ?? 50, 200);

    const where: Record<string, unknown> = {
      responsibleUserId: filters.responsibleUserId,
      teamId: filters.teamId,
      status: filters.status,
      orderType: filters.orderType,
      source: filters.source,
      partnerId: filters.partnerId,
      createdAt:
        filters.dateFrom || filters.dateTo
          ? { gte: filters.dateFrom, lte: filters.dateTo }
          : undefined,
    };

    if (filters.responsibleUserIdFilter) where.responsibleUserId = filters.responsibleUserIdFilter;

    const orFilters: Record<string, unknown>[] = [];
    if (filters.customerPhone) orFilters.push({ customerPhone: { contains: filters.customerPhone } });
    if (filters.customerName) orFilters.push({ customerName: { contains: filters.customerName, mode: "insensitive" } });
    if (filters.externalOrderNumber) orFilters.push({ externalOrderNumber: { contains: filters.externalOrderNumber } });
    if (orFilters.length > 0) where.OR = orFilters;

    if (filters.itemSearch) {
      where.items = {
        some: {
          OR: [
            { arabicNameSnapshot: { contains: filters.itemSearch } },
            { englishNameSnapshot: { contains: filters.itemSearch, mode: "insensitive" } },
            { itemCodeSnapshot: { contains: filters.itemSearch } },
          ],
        },
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          responsibleUser: { select: { id: true, fullName: true } },
          partner: { select: { id: true, name: true } },
          items: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }
}

export interface OrderFilters {
  dateFrom?: Date;
  dateTo?: Date;
  status?: string;
  orderType?: string;
  source?: string;
  partnerId?: string;
  responsibleUserIdFilter?: string;
  customerPhone?: string;
  customerName?: string;
  externalOrderNumber?: string;
  itemSearch?: string;
  page?: number;
  pageSize?: number;
}
