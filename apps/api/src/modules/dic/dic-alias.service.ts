import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { normalizeSearchInput } from './normalization';
import type { CreateAliasDto, DecideAliasDto, UpdateAliasDto } from './dic.dto';

/**
 * CR-002 Phase 4 Step 4 — DrugAlias propose/approve/reject workflow
 * (design doc §6/§17). An alias row IS the proposal: creating one
 * always starts unapproved (`approved: false`) — "never auto-
 * authoritative" — and only a dic.approve_alias holder can flip it.
 * Rejecting deactivates rather than deletes, so the audit/timeline
 * trail for the proposal survives.
 */
@Injectable()
export class DicAliasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
  ) {}

  async listForDrug(drugId: string) {
    const drug = await this.prisma.drug.findUnique({ where: { id: drugId } });
    if (!drug) throw new NotFoundException('Drug not found');
    return this.prisma.drugAlias.findMany({
      where: { drugId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listPending() {
    return this.prisma.drugAlias.findMany({
      where: { approved: false, active: true },
      include: {
        drug: { select: { id: true, materialNo: true, nameEn: true, nameAr: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  async propose(actor: AuthUser, drugId: string, dto: CreateAliasDto, meta: { ip?: string }) {
    const drug = await this.prisma.drug.findUnique({ where: { id: drugId } });
    if (!drug) throw new NotFoundException('Drug not found');

    const normalizedAlias = normalizeSearchInput(dto.alias);
    const existingOnDrug = await this.prisma.drugAlias.findUnique({
      where: { drugId_normalizedAlias: { drugId, normalizedAlias } },
    });
    if (existingOnDrug) {
      throw new BadRequestException('This alias already exists for this drug');
    }
    // Duplicate detection (design doc §17) — surface, never auto-merge:
    // the same alias text approved on a *different* drug is a signal
    // for the reviewer, not a block.
    const crossDrugMatches = await this.prisma.drugAlias.findMany({
      where: { normalizedAlias, drugId: { not: drugId }, approved: true },
      include: { drug: { select: { id: true, materialNo: true, nameEn: true } } },
      take: 5,
    });

    const alias = await this.prisma.drugAlias.create({
      data: {
        drugId,
        alias: dto.alias,
        normalizedAlias,
        language: dto.language,
        script: dto.script,
        aliasType: dto.aliasType,
        source: dto.source ?? 'MANUAL',
        confidence: dto.confidence,
        createdById: actor.userId,
      },
    });

    await this.timeline.record({
      entityType: 'drug',
      entityId: drugId,
      eventType: 'alias_proposed',
      actorId: actor.userId,
      payload: { aliasId: alias.id, alias: dto.alias },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.alias_propose',
      entityType: 'drug_alias',
      entityId: alias.id,
      after: { drugId, alias: dto.alias, aliasType: dto.aliasType },
      ...meta,
    });

    return {
      ...alias,
      duplicateOf: crossDrugMatches.map((m) => m.drug),
    };
  }

  async update(actor: AuthUser, id: string, dto: UpdateAliasDto, meta: { ip?: string }) {
    const before = await this.prisma.drugAlias.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Alias not found');
    if (before.approved) {
      throw new BadRequestException('Approved aliases cannot be edited; propose a new one instead');
    }

    const data: Prisma.DrugAliasUpdateInput = { active: dto.active };
    if (dto.alias !== undefined) {
      data.alias = dto.alias;
      data.normalizedAlias = normalizeSearchInput(dto.alias);
    }
    if (dto.aliasType !== undefined) data.aliasType = dto.aliasType;

    const alias = await this.prisma.drugAlias.update({ where: { id }, data });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.alias_update',
      entityType: 'drug_alias',
      entityId: id,
      before: { alias: before.alias, aliasType: before.aliasType, active: before.active },
      after: dto,
      ...meta,
    });
    return alias;
  }

  async decide(actor: AuthUser, id: string, dto: DecideAliasDto, meta: { ip?: string }) {
    const alias = await this.prisma.drugAlias.findUnique({ where: { id } });
    if (!alias) throw new NotFoundException('Alias not found');
    if (alias.approved) {
      throw new BadRequestException('Alias is already approved');
    }
    if (!alias.active) {
      throw new BadRequestException('Alias was already rejected');
    }

    const now = new Date();
    const updated = await this.prisma.drugAlias.update({
      where: { id },
      data:
        dto.decision === 'approve'
          ? { approved: true, approvedById: actor.userId, approvedAt: now }
          : { active: false },
    });

    await this.timeline.record({
      entityType: 'drug',
      entityId: alias.drugId,
      eventType: dto.decision === 'approve' ? 'alias_approved' : 'alias_rejected',
      actorId: actor.userId,
      payload: { aliasId: id, note: dto.note ?? null },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: `dic.alias_${dto.decision}`,
      entityType: 'drug_alias',
      entityId: id,
      before: { approved: alias.approved, active: alias.active },
      after: { decision: dto.decision, note: dto.note ?? null },
      ...meta,
    });
    return updated;
  }
}
