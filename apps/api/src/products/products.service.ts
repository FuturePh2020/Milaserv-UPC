import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EventSource } from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";
import { TimelineService } from "../timeline/timeline.service";
import { AuditService } from "../audit/audit.service";

export interface ProductInput {
  itemCode: string;
  barcode?: string;
  arabicName?: string;
  englishName?: string;
  scientificName?: string;
  activeIngredient?: string;
  categoryId?: string;
  subcategoryId?: string;
  dosageFormId?: string;
  strength?: string;
  unitId?: string;
  packSize?: string;
  manufacturerId?: string;
  defaultPrice?: number;
  currency?: string;
  insuranceAvailable?: boolean;
  cashAvailable?: boolean;
  notes?: string;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
  ) {}

  private validate(input: ProductInput) {
    const itemCode = (input.itemCode ?? "").trim();
    if (!itemCode) {
      throw new BadRequestException("Item Code is required");
    }
    if (!input.arabicName?.trim() && !input.englishName?.trim()) {
      throw new BadRequestException("Arabic or English Item Name must be provided");
    }
    if (input.defaultPrice !== undefined && input.defaultPrice !== null) {
      if (Number.isNaN(Number(input.defaultPrice)) || Number(input.defaultPrice) < 0) {
        throw new BadRequestException("Default Price must be a valid non-negative number");
      }
    }
    return itemCode;
  }

  async create(input: ProductInput, actorId: string) {
    const itemCode = this.validate(input);
    const barcode = input.barcode?.trim() || undefined;

    const existingCode = await this.prisma.product.findUnique({ where: { itemCode } });
    if (existingCode) throw new ConflictException("This Item Code already exists.");
    if (barcode) {
      const existingBarcode = await this.prisma.product.findUnique({ where: { barcode } });
      if (existingBarcode) throw new ConflictException("This Barcode is already assigned to another Item.");
    }

    const product = await this.prisma.product.create({
      data: { ...input, itemCode, barcode, createdById: actorId, updatedById: actorId },
    });

    await this.timeline.record({
      entityType: "Product",
      entityId: product.id,
      eventType: "PRODUCT_CREATED",
      actorUserId: actorId,
      newValue: { itemCode, arabicName: input.arabicName, englishName: input.englishName },
      source: EventSource.ADMIN,
    });
    await this.audit.log({ action: "PRODUCT_CREATE", userId: actorId, entityType: "Product", entityId: product.id, metadata: { itemCode } });

    return product;
  }

  async update(id: string, input: Partial<ProductInput>, actorId: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Product not found");

    if (input.itemCode && input.itemCode.trim() !== existing.itemCode) {
      const clash = await this.prisma.product.findUnique({ where: { itemCode: input.itemCode.trim() } });
      if (clash) throw new ConflictException("This Item Code already exists.");
    }
    if (input.barcode && input.barcode.trim() && input.barcode.trim() !== existing.barcode) {
      const clash = await this.prisma.product.findUnique({ where: { barcode: input.barcode.trim() } });
      if (clash) throw new ConflictException("This Barcode is already assigned to another Item.");
    }
    if (input.defaultPrice !== undefined && input.defaultPrice !== null) {
      if (Number.isNaN(Number(input.defaultPrice)) || Number(input.defaultPrice) < 0) {
        throw new BadRequestException("Default Price must be a valid non-negative number");
      }
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: { ...input, itemCode: input.itemCode?.trim(), barcode: input.barcode?.trim() || undefined, updatedById: actorId },
    });

    if (input.defaultPrice !== undefined && input.defaultPrice !== existing.defaultPrice) {
      await this.prisma.productPriceHistory.create({
        data: { productId: id, previousPrice: existing.defaultPrice, newPrice: input.defaultPrice, changedByUserId: actorId },
      });
      await this.timeline.record({
        entityType: "Product",
        entityId: id,
        eventType: "PRICE_CHANGED",
        actorUserId: actorId,
        previousValue: { defaultPrice: existing.defaultPrice },
        newValue: { defaultPrice: input.defaultPrice },
        source: EventSource.ADMIN,
      });
    }

    await this.timeline.record({
      entityType: "Product",
      entityId: id,
      eventType: "PRODUCT_UPDATED",
      actorUserId: actorId,
      previousValue: existing,
      newValue: input,
      source: EventSource.ADMIN,
    });
    await this.audit.log({ action: "PRODUCT_UPDATE", userId: actorId, entityType: "Product", entityId: id, metadata: input });

    return product;
  }

  async setStatus(id: string, isActive: boolean, actorId: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Product not found");
    const product = await this.prisma.product.update({ where: { id }, data: { isActive, updatedById: actorId } });
    await this.timeline.record({
      entityType: "Product",
      entityId: id,
      eventType: isActive ? "PRODUCT_ACTIVATED" : "PRODUCT_DEACTIVATED",
      actorUserId: actorId,
      source: EventSource.ADMIN,
    });
    await this.audit.log({ action: "PRODUCT_STATUS_UPDATE", userId: actorId, entityType: "Product", entityId: id, metadata: { isActive } });
    return product;
  }

  async archive(id: string, actorId: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Product not found");
    const product = await this.prisma.product.update({ where: { id }, data: { isArchived: true, isActive: false, updatedById: actorId } });
    await this.timeline.record({ entityType: "Product", entityId: id, eventType: "PRODUCT_ARCHIVED", actorUserId: actorId, source: EventSource.ADMIN });
    await this.audit.log({ action: "PRODUCT_STATUS_UPDATE", userId: actorId, entityType: "Product", entityId: id, metadata: { archived: true } });
    return product;
  }

  async restore(id: string, actorId: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Product not found");
    const product = await this.prisma.product.update({ where: { id }, data: { isArchived: false, updatedById: actorId } });
    await this.timeline.record({ entityType: "Product", entityId: id, eventType: "PRODUCT_RESTORED", actorUserId: actorId, source: EventSource.ADMIN });
    await this.audit.log({ action: "PRODUCT_STATUS_UPDATE", userId: actorId, entityType: "Product", entityId: id, metadata: { restored: true } });
    return product;
  }

  async findAll(filters: { search?: string; categoryId?: string; isActive?: boolean; isArchived?: boolean }) {
    return this.prisma.product.findMany({
      where: {
        categoryId: filters.categoryId,
        isActive: filters.isActive,
        isArchived: filters.isArchived,
        OR: filters.search
          ? [
              { itemCode: { contains: filters.search, mode: "insensitive" } },
              { barcode: { contains: filters.search } },
              { arabicName: { contains: filters.search } },
              { englishName: { contains: filters.search, mode: "insensitive" } },
              { scientificName: { contains: filters.search, mode: "insensitive" } },
            ]
          : undefined,
      },
      include: { category: true, subcategory: true, dosageForm: true, unit: true, manufacturer: true },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        subcategory: true,
        dosageForm: true,
        unit: true,
        manufacturer: true,
        partners: { include: { partner: { select: { id: true, name: true } } } },
        priceHistory: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!product) throw new NotFoundException("Product not found");
    const orderItemCount = await this.prisma.orderItem.count({ where: { productId: id } });
    return { ...product, orderItemCount };
  }

  /** Active, non-archived items only, filtered by cash/insurance availability and optional partner (spec section 29-30). */
  async searchForAgents(params: { query?: string; orderType?: string; partnerId?: string }) {
    const where: Record<string, unknown> = { isActive: true, isArchived: false };
    if (params.query) {
      where.OR = [
        { itemCode: { contains: params.query, mode: "insensitive" } },
        { barcode: { contains: params.query } },
        { arabicName: { contains: params.query } },
        { englishName: { contains: params.query, mode: "insensitive" } },
        { scientificName: { contains: params.query, mode: "insensitive" } },
        { activeIngredient: { contains: params.query, mode: "insensitive" } },
      ];
    }
    if (params.orderType === "CASH") where.cashAvailable = true;
    if (params.orderType === "INSURANCE") where.insuranceAvailable = true;

    let products = await this.prisma.product.findMany({
      where,
      include: params.partnerId ? { partners: { where: { partnerId: params.partnerId } } } : undefined,
      take: 50,
    });

    if (params.partnerId) {
      products = products.filter((p: any) => {
        const mapping = p.partners?.[0];
        return !mapping || mapping.active;
      });
    }

    return products;
  }

  async setPartnerAvailability(
    productId: string,
    partnerId: string,
    dto: { partnerItemCode?: string; partnerPrice?: number; insuranceCovered?: boolean; active?: boolean },
    actorId: string,
  ) {
    const mapping = await this.prisma.productPartner.upsert({
      where: { productId_partnerId: { productId, partnerId } },
      update: dto,
      create: { productId, partnerId, ...dto },
    });
    await this.timeline.record({
      entityType: "Product",
      entityId: productId,
      eventType: "PARTNER_AVAILABILITY_CHANGED",
      actorUserId: actorId,
      newValue: { partnerId, ...dto },
      source: EventSource.ADMIN,
    });
    return mapping;
  }
}
