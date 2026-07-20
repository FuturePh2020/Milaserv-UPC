import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { normalizePhone } from "../common/utils/phone";

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreate(params: { name: string; phone: string; alternatePhone?: string; source?: string }) {
    const phoneNorm = normalizePhone(params.phone) ?? params.phone.trim();
    const existing = await this.prisma.customer.findFirst({ where: { phoneNorm } });
    if (existing) {
      return this.prisma.customer.update({
        where: { id: existing.id },
        data: {
          name: params.name || existing.name,
          alternatePhone: params.alternatePhone ?? existing.alternatePhone,
        },
      });
    }
    return this.prisma.customer.create({
      data: {
        name: params.name,
        phone: params.phone,
        phoneNorm,
        alternatePhone: params.alternatePhone,
        source: params.source,
      },
    });
  }

  async search(query: string) {
    return this.prisma.customer.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { phone: { contains: query } },
          { phoneNorm: { contains: normalizePhone(query) ?? query } },
        ],
      },
      take: 20,
      orderBy: { updatedAt: "desc" },
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: { orders: { orderBy: { createdAt: "desc" } }, retentionCustomer: true },
    });
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }
}
