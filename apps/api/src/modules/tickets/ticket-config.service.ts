import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/current-user.decorator';

interface CatalogPatch {
  nameAr?: string;
  nameEn?: string;
  active?: boolean;
  order?: number;
}

/**
 * Ticketing configuration catalogs (spec §3 — ADR-008). Values are data:
 * archiving keeps historical tickets intact; new tickets can only use
 * active values (enforced by TicketsService validation).
 * Transition-matrix editing stays DB-managed this phase (spec §5).
 */
@Injectable()
export class TicketConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async catalogs() {
    const [
      types,
      urgencies,
      statuses,
      transitions,
      updateTypes,
      resolutionCategories,
      slaPolicies,
    ] = await this.prisma.$transaction([
      this.prisma.ticketType.findMany({
        where: { active: true },
        include: { categories: { where: { active: true }, orderBy: { order: 'asc' } } },
      }),
      this.prisma.ticketUrgency.findMany({ where: { active: true }, orderBy: { order: 'asc' } }),
      this.prisma.ticketStatus.findMany({ orderBy: { order: 'asc' } }),
      this.prisma.statusTransition.findMany({
        include: { fromStatus: true, toStatus: true },
      }),
      this.prisma.updateType.findMany({ where: { active: true }, orderBy: { order: 'asc' } }),
      this.prisma.resolutionCategory.findMany({ where: { active: true } }),
      this.prisma.slaPolicy.findMany({ include: { type: true, urgency: true } }),
    ]);
    return {
      types,
      urgencies,
      statuses,
      transitions: transitions.map((t) => ({
        id: t.id,
        from: t.fromStatus.key,
        to: t.toStatus.key,
        requiredPermissionKey: t.requiredPermissionKey,
      })),
      updateTypes,
      resolutionCategories,
      slaPolicies,
    };
  }

  async createCategory(
    actor: AuthUser,
    dto: { typeKey: string; key: string; nameAr: string; nameEn: string },
    meta: { ip?: string },
  ) {
    const type = await this.prisma.ticketType.findUnique({ where: { key: dto.typeKey } });
    if (!type) throw new NotFoundException('Ticket type not found');

    const maxOrder = await this.prisma.ticketCategory.aggregate({
      where: { typeId: type.id },
      _max: { order: true },
    });
    const category = await this.prisma.ticketCategory.upsert({
      where: { typeId_key: { typeId: type.id, key: dto.key } },
      update: { nameAr: dto.nameAr, nameEn: dto.nameEn, active: true },
      create: {
        typeId: type.id,
        key: dto.key,
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        order: (maxOrder._max.order ?? 0) + 1,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ticket_config.category_create',
      entityType: 'ticket_category',
      entityId: category.id,
      after: dto,
      ...meta,
    });
    return category;
  }

  async updateCategory(actor: AuthUser, id: string, dto: CatalogPatch, meta: { ip?: string }) {
    const before = await this.prisma.ticketCategory.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Category not found');
    const category = await this.prisma.ticketCategory.update({ where: { id }, data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ticket_config.category_update',
      entityType: 'ticket_category',
      entityId: id,
      before: { nameAr: before.nameAr, nameEn: before.nameEn, active: before.active },
      after: dto,
      ...meta,
    });
    return category;
  }

  async updateUpdateType(actor: AuthUser, id: string, dto: CatalogPatch, meta: { ip?: string }) {
    const before = await this.prisma.updateType.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Update type not found');
    const updated = await this.prisma.updateType.update({ where: { id }, data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ticket_config.update_type_update',
      entityType: 'update_type',
      entityId: id,
      before: { nameAr: before.nameAr, nameEn: before.nameEn, active: before.active },
      after: dto,
      ...meta,
    });
    return updated;
  }

  async updateSlaPolicy(
    actor: AuthUser,
    id: string,
    dto: {
      firstResponseMinutes?: number;
      resolutionMinutes?: number;
      warningThresholdPct?: number;
      active?: boolean;
    },
    meta: { ip?: string },
  ) {
    const before = await this.prisma.slaPolicy.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('SLA policy not found');
    const policy = await this.prisma.slaPolicy.update({ where: { id }, data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ticket_config.sla_update',
      entityType: 'sla_policy',
      entityId: id,
      before: {
        firstResponseMinutes: before.firstResponseMinutes,
        resolutionMinutes: before.resolutionMinutes,
        warningThresholdPct: before.warningThresholdPct,
      },
      after: dto,
      ...meta,
    });
    return policy;
  }
}
