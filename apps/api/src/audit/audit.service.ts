import { Injectable } from "@nestjs/common";
import { AuditAction } from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditLogInput {
  action: AuditAction;
  userId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput) {
    return this.prisma.auditLog.create({
      data: {
        action: input.action,
        userId: input.userId ?? undefined,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: (input.metadata ?? {}) as any,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  async query(params: {
    action?: string;
    userId?: string;
    entityType?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const page = params.page ?? 1;
    const pageSize = Math.min(params.pageSize ?? 50, 200);
    const where = {
      action: params.action ? { equals: params.action } : undefined,
      userId: params.userId ?? undefined,
      entityType: params.entityType ?? undefined,
      createdAt:
        params.from || params.to
          ? { gte: params.from ?? undefined, lte: params.to ?? undefined }
          : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { id: true, username: true, fullName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}
