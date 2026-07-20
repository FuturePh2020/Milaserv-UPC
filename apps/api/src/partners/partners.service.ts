import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PartnersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(params: { isActive?: boolean; categoryId?: string }) {
    return this.prisma.partner.findMany({
      where: {
        isActive: params.isActive,
        categories: params.categoryId ? { some: { categoryId: params.categoryId } } : undefined,
      },
      include: { categories: { include: { category: true } }, defaultTask: true },
      orderBy: { name: "asc" },
    });
  }

  async findOne(id: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id },
      include: { categories: { include: { category: true } }, defaultTask: true, columnMappings: true },
    });
    if (!partner) throw new NotFoundException("Partner not found");
    return partner;
  }

  async create(data: {
    name: string;
    code: string;
    partnerType?: string;
    insuranceEnabled?: boolean;
    cashEnabled?: boolean;
    categoryIds?: string[];
    contactPerson?: string;
    email?: string;
    phone?: string;
    notes?: string;
    defaultTaskId?: string;
    priority?: number;
    customFieldDefs?: unknown;
    requiredImportColumns?: unknown;
  }) {
    const existing = await this.prisma.partner.findUnique({ where: { code: data.code } });
    if (existing) throw new ConflictException("Partner code already exists");

    const { categoryIds, ...rest } = data;
    return this.prisma.partner.create({
      data: {
        ...rest,
        customFieldDefs: (data.customFieldDefs ?? []) as any,
        requiredImportColumns: (data.requiredImportColumns ?? []) as any,
        categories: categoryIds
          ? { create: categoryIds.map((categoryId) => ({ categoryId })) }
          : undefined,
      },
      include: { categories: { include: { category: true } } },
    });
  }

  async update(id: string, data: Partial<{
    name: string;
    partnerType: string;
    insuranceEnabled: boolean;
    cashEnabled: boolean;
    categoryIds: string[];
    contactPerson: string;
    email: string;
    phone: string;
    notes: string;
    isActive: boolean;
    defaultTaskId: string;
    priority: number;
    customFieldDefs: unknown;
    requiredImportColumns: unknown;
    logoUrl: string;
  }>) {
    await this.ensureExists(id);
    const { categoryIds, ...rest } = data;

    if (categoryIds) {
      await this.prisma.partnerLeadCategory.deleteMany({ where: { partnerId: id } });
    }

    return this.prisma.partner.update({
      where: { id },
      data: {
        ...rest,
        customFieldDefs: data.customFieldDefs !== undefined ? (data.customFieldDefs as any) : undefined,
        requiredImportColumns:
          data.requiredImportColumns !== undefined ? (data.requiredImportColumns as any) : undefined,
        categories: categoryIds
          ? { create: categoryIds.map((categoryId) => ({ categoryId })) }
          : undefined,
      },
      include: { categories: { include: { category: true } } },
    });
  }

  async setActive(id: string, isActive: boolean) {
    await this.ensureExists(id);
    return this.prisma.partner.update({ where: { id }, data: { isActive } });
  }

  async saveColumnMapping(partnerId: string, name: string, mapping: Record<string, string>) {
    await this.ensureExists(partnerId);
    return this.prisma.partnerColumnMapping.upsert({
      where: { partnerId_name: { partnerId, name } },
      update: { mapping: mapping as any },
      create: { partnerId, name, mapping: mapping as any },
    });
  }

  private async ensureExists(id: string) {
    const partner = await this.prisma.partner.findUnique({ where: { id } });
    if (!partner) throw new NotFoundException("Partner not found");
    return partner;
  }
}
