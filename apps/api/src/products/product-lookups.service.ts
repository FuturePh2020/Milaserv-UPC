import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

type LookupKind = "categories" | "subcategories" | "dosage-forms" | "units" | "manufacturers" | "currencies";

@Injectable()
export class ProductLookupsService {
  constructor(private readonly prisma: PrismaService) {}

  private delegate(kind: LookupKind) {
    switch (kind) {
      case "categories":
        return this.prisma.productCategory;
      case "subcategories":
        return this.prisma.productSubcategory;
      case "dosage-forms":
        return this.prisma.dosageForm;
      case "units":
        return this.prisma.productUnit;
      case "manufacturers":
        return this.prisma.manufacturer;
      case "currencies":
        return this.prisma.currency;
      default:
        throw new NotFoundException("Unknown lookup type");
    }
  }

  async list(kind: LookupKind, activeOnly = false) {
    const delegate = this.delegate(kind) as any;
    return delegate.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
  }

  async create(kind: LookupKind, data: Record<string, unknown>) {
    const delegate = this.delegate(kind) as any;
    return delegate.create({ data });
  }

  async update(kind: LookupKind, id: string, data: Record<string, unknown>) {
    const delegate = this.delegate(kind) as any;
    return delegate.update({ where: { id }, data });
  }
}
