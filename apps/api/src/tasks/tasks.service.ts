import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(params: { isActive?: boolean }) {
    return this.prisma.task.findMany({
      where: { isActive: params.isActive },
      include: {
        categories: { include: { category: true } },
        partners: { include: { partner: true } },
      },
      orderBy: { priority: "desc" },
    });
  }

  async findOne(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        categories: { include: { category: true } },
        partners: { include: { partner: true } },
        agentPermissions: { include: { user: { select: { id: true, username: true, fullName: true } } } },
      },
    });
    if (!task) throw new NotFoundException("Task not found");
    return task;
  }

  async create(data: {
    name: string;
    code: string;
    description?: string;
    partnerIds?: string[];
    categoryIds?: string[];
    requiredQuantity?: number;
    dailyTarget?: number;
    priority?: number;
    maxActiveAgents?: number;
    maxConcurrentBreaks?: number;
  }) {
    const existing = await this.prisma.task.findUnique({ where: { code: data.code } });
    if (existing) throw new ConflictException("Task code already exists");

    const { partnerIds, categoryIds, ...rest } = data;
    return this.prisma.task.create({
      data: {
        ...rest,
        categories: categoryIds ? { create: categoryIds.map((categoryId) => ({ categoryId })) } : undefined,
        partners: partnerIds ? { create: partnerIds.map((partnerId) => ({ partnerId })) } : undefined,
      },
    });
  }

  async update(id: string, data: Partial<{
    name: string;
    description: string;
    partnerIds: string[];
    categoryIds: string[];
    requiredQuantity: number;
    dailyTarget: number;
    priority: number;
    isActive: boolean;
    maxActiveAgents: number;
    maxConcurrentBreaks: number;
  }>) {
    const existing = await this.prisma.task.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Task not found");

    const { partnerIds, categoryIds, ...rest } = data;
    if (categoryIds) await this.prisma.taskLeadCategory.deleteMany({ where: { taskId: id } });
    if (partnerIds) await this.prisma.taskPartnerRestriction.deleteMany({ where: { taskId: id } });

    return this.prisma.task.update({
      where: { id },
      data: {
        ...rest,
        categories: categoryIds ? { create: categoryIds.map((categoryId) => ({ categoryId })) } : undefined,
        partners: partnerIds ? { create: partnerIds.map((partnerId) => ({ partnerId })) } : undefined,
      },
    });
  }
}
