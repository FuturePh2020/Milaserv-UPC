import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { normalizePhone } from "../common/utils/phone";

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreate(params: { name: string; phone: string; alternatePhone?: string; source?: string }) {
    const phoneNorm = normalizePhone(params.phone) ?? params.phone.trim();
    // A real upsert (INSERT ... ON CONFLICT) is atomic at the DB level —
    // unlike a findFirst-then-create/update check, two concurrent callers
    // for the same phone (e.g. two agents creating orders for the same
    // customer at once) can't both miss the "existing" check and create
    // duplicate Customer rows.
    return this.prisma.customer.upsert({
      where: { phoneNorm },
      update: {
        name: params.name || undefined,
        alternatePhone: params.alternatePhone,
      },
      create: {
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
