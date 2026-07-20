import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type {
  CreateAlternativeLinkDto,
  DecideAlternativeLinkDto,
  UpdateAlternativeLinkDto,
} from './dic.dto';

const RELATED_DRUG_SELECT = {
  id: true,
  materialNo: true,
  nameEn: true,
  nameAr: true,
  priceWithTax: true,
} as const;

/**
 * CR-002 Phase 4 Step 4 — DrugAlternativeLink propose/approve/reject
 * workflow (design doc §10/§17). This is the pharmacist-approved
 * alternative data structure only — no auto-recommendation, no
 * surfacing to prescription matching (that is explicitly out of scope
 * for Phase 4). A link starts `pharmacistApproved: false`; only
 * dic.approve_alternative can flip it. Rejecting deactivates rather
 * than deletes so the proposal stays in the audit/timeline trail.
 */
@Injectable()
export class DicAlternativeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
  ) {}

  async listForDrug(drugId: string) {
    const drug = await this.prisma.drug.findUnique({ where: { id: drugId } });
    if (!drug) throw new NotFoundException('Drug not found');
    return this.prisma.drugAlternativeLink.findMany({
      where: { sourceDrugId: drugId },
      include: { alternativeDrug: { select: RELATED_DRUG_SELECT } },
      orderBy: { priority: 'asc' },
    });
  }

  listPending() {
    return this.prisma.drugAlternativeLink.findMany({
      where: { pharmacistApproved: false, active: true },
      include: {
        sourceDrug: { select: RELATED_DRUG_SELECT },
        alternativeDrug: { select: RELATED_DRUG_SELECT },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  async propose(
    actor: AuthUser,
    sourceDrugId: string,
    dto: CreateAlternativeLinkDto,
    meta: { ip?: string },
  ) {
    if (dto.alternativeDrugId === sourceDrugId) {
      throw new BadRequestException('A drug cannot be an alternative to itself');
    }
    const [source, alternative] = await Promise.all([
      this.prisma.drug.findUnique({ where: { id: sourceDrugId } }),
      this.prisma.drug.findUnique({ where: { id: dto.alternativeDrugId } }),
    ]);
    if (!source) throw new NotFoundException('Source drug not found');
    if (!alternative) throw new NotFoundException('Alternative drug not found');

    const existing = await this.prisma.drugAlternativeLink.findUnique({
      where: {
        sourceDrugId_alternativeDrugId: {
          sourceDrugId,
          alternativeDrugId: dto.alternativeDrugId,
        },
      },
    });
    if (existing) {
      throw new BadRequestException('An alternative link between these drugs already exists');
    }

    const link = await this.prisma.drugAlternativeLink.create({
      data: {
        sourceDrugId,
        alternativeDrugId: dto.alternativeDrugId,
        alternativeType: dto.alternativeType,
        equivalenceLevel: dto.equivalenceLevel,
        sameActiveIngredient: dto.sameActiveIngredient ?? false,
        sameStrength: dto.sameStrength ?? false,
        sameDosageForm: dto.sameDosageForm ?? false,
        priority: dto.priority ?? 0,
        notes: dto.notes,
      },
    });

    await this.timeline.record({
      entityType: 'drug',
      entityId: sourceDrugId,
      eventType: 'alternative_proposed',
      actorId: actor.userId,
      payload: { linkId: link.id, alternativeDrugId: dto.alternativeDrugId },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.alternative_propose',
      entityType: 'drug_alternative_link',
      entityId: link.id,
      after: { sourceDrugId, ...dto },
      ...meta,
    });
    return link;
  }

  async update(actor: AuthUser, id: string, dto: UpdateAlternativeLinkDto, meta: { ip?: string }) {
    const before = await this.prisma.drugAlternativeLink.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Alternative link not found');
    if (before.pharmacistApproved) {
      throw new BadRequestException(
        'Approved alternative links cannot be edited; propose a new one instead',
      );
    }

    const data: Prisma.DrugAlternativeLinkUpdateInput = {
      alternativeType: dto.alternativeType,
      equivalenceLevel: dto.equivalenceLevel,
      sameActiveIngredient: dto.sameActiveIngredient,
      sameStrength: dto.sameStrength,
      sameDosageForm: dto.sameDosageForm,
      priority: dto.priority,
      notes: dto.notes,
      active: dto.active,
    };

    const link = await this.prisma.drugAlternativeLink.update({ where: { id }, data });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.alternative_update',
      entityType: 'drug_alternative_link',
      entityId: id,
      before: {
        alternativeType: before.alternativeType,
        priority: before.priority,
        active: before.active,
      },
      after: dto,
      ...meta,
    });
    return link;
  }

  async decide(actor: AuthUser, id: string, dto: DecideAlternativeLinkDto, meta: { ip?: string }) {
    const link = await this.prisma.drugAlternativeLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Alternative link not found');
    if (link.pharmacistApproved) {
      throw new BadRequestException('Alternative link is already approved');
    }
    if (!link.active) {
      throw new BadRequestException('Alternative link was already rejected');
    }

    const now = new Date();
    const updated = await this.prisma.drugAlternativeLink.update({
      where: { id },
      data:
        dto.decision === 'approve'
          ? { pharmacistApproved: true, approvedById: actor.userId, approvedAt: now }
          : { active: false },
    });

    await this.timeline.record({
      entityType: 'drug',
      entityId: link.sourceDrugId,
      eventType: dto.decision === 'approve' ? 'alternative_approved' : 'alternative_rejected',
      actorId: actor.userId,
      payload: { linkId: id, note: dto.note ?? null },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: `dic.alternative_${dto.decision}`,
      entityType: 'drug_alternative_link',
      entityId: id,
      before: { pharmacistApproved: link.pharmacistApproved, active: link.active },
      after: { decision: dto.decision, note: dto.note ?? null },
      ...meta,
    });
    return updated;
  }
}
