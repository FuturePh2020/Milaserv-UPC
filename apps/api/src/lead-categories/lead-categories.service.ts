import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class LeadCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.leadCategory.findMany({ orderBy: { name: "asc" } });
  }

  async create(data: { name: string; code: string; description?: string }) {
    const existing = await this.prisma.leadCategory.findFirst({
      where: { OR: [{ name: data.name }, { code: data.code }] },
    });
    if (existing) throw new ConflictException("Category name or code already exists");
    return this.prisma.leadCategory.create({ data });
  }

  async update(id: string, data: Partial<{ name: string; description: string; isActive: boolean }>) {
    const existing = await this.prisma.leadCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Category not found");
    return this.prisma.leadCategory.update({ where: { id }, data });
  }
}
