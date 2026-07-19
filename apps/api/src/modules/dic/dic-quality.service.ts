import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { MergeDrugDto, SetDataQualityStatusDto, UpdateDrugFieldsDto } from './dic.dto';

/** Data-quality rule keys → the Prisma filter that finds offending drugs. */
const QUALITY_RULES: Record<string, Prisma.DrugWhereInput> = {
  missing_name_ar: { OR: [{ nameAr: null }, { nameAr: '' }] },
  missing_dosage_form: { dosageFormId: null },
  missing_manufacturer: { manufacturerId: null },
  missing_strength: { strengthText: null },
  missing_barcode: { barcode: null },
  needs_review: { dataQualityStatus: 'NEEDS_REVIEW' },
  incomplete: { dataQualityStatus: 'INCOMPLETE' },
};

/**
 * CR-002 Phase 4 Step 6 — controlled drug merge, optimistic-locked
 * field edits, and the data-quality dashboard (design doc §22/§18).
 * "A merged record is never deleted, only redirected" — merge sets
 * mergedIntoDrugId and active:false, never a hard delete.
 */
@Injectable()
export class DicQualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
  ) {}

  // ── Merge ────────────────────────────────────────────────────────────

  async merge(actor: AuthUser, sourceId: string, dto: MergeDrugDto, meta: { ip?: string }) {
    if (sourceId === dto.targetDrugId) {
      throw new BadRequestException('A drug cannot be merged into itself');
    }
    const [source, target] = await Promise.all([
      this.prisma.drug.findUnique({ where: { id: sourceId } }),
      this.prisma.drug.findUnique({ where: { id: dto.targetDrugId } }),
    ]);
    if (!source) throw new NotFoundException('Source drug not found');
    if (!target) throw new NotFoundException('Target drug not found');
    if (source.mergedIntoDrugId) {
      throw new BadRequestException('Source drug is already merged into another drug');
    }
    if (target.mergedIntoDrugId) {
      throw new BadRequestException(
        'Target drug is itself merged into another drug; merge into the root drug instead',
      );
    }
    if (dto.expectedSourceVersion !== undefined && dto.expectedSourceVersion !== source.version) {
      throw new ConflictException('Source drug has changed since you loaded it');
    }
    if (dto.expectedTargetVersion !== undefined && dto.expectedTargetVersion !== target.version) {
      throw new ConflictException('Target drug has changed since you loaded it');
    }

    const targetId = dto.targetDrugId;
    const result = await this.prisma.$transaction(async (tx) => {
      // Aliases: reassign non-conflicting, drop the rest — target's own
      // alias wins over an identical one carried in from the source.
      const [sourceAliases, targetAliasKeys] = await Promise.all([
        tx.drugAlias.findMany({ where: { drugId: sourceId } }),
        tx.drugAlias
          .findMany({ where: { drugId: targetId }, select: { normalizedAlias: true } })
          .then((rows) => new Set(rows.map((r) => r.normalizedAlias))),
      ]);
      for (const alias of sourceAliases) {
        if (targetAliasKeys.has(alias.normalizedAlias)) {
          await tx.drugAlias.delete({ where: { id: alias.id } });
        } else {
          await tx.drugAlias.update({ where: { id: alias.id }, data: { drugId: targetId } });
          targetAliasKeys.add(alias.normalizedAlias);
        }
      }

      // Coverage: same non-conflicting reassignment, keyed by company.
      const [sourceCoverages, targetCoverageKeys] = await Promise.all([
        tx.drugCoverage.findMany({ where: { drugId: sourceId } }),
        tx.drugCoverage
          .findMany({ where: { drugId: targetId }, select: { companyKey: true } })
          .then((rows) => new Set(rows.map((r) => r.companyKey))),
      ]);
      for (const cov of sourceCoverages) {
        if (targetCoverageKeys.has(cov.companyKey)) {
          await tx.drugCoverage.delete({ where: { id: cov.id } });
        } else {
          await tx.drugCoverage.update({ where: { id: cov.id }, data: { drugId: targetId } });
          targetCoverageKeys.add(cov.companyKey);
        }
      }

      // Alternative links: repoint whichever side was the source drug,
      // dropping links that would become self-links or duplicates.
      const [asSource, asAlternative] = await Promise.all([
        tx.drugAlternativeLink.findMany({ where: { sourceDrugId: sourceId } }),
        tx.drugAlternativeLink.findMany({ where: { alternativeDrugId: sourceId } }),
      ]);
      for (const link of asSource) {
        if (link.alternativeDrugId === targetId) {
          await tx.drugAlternativeLink.delete({ where: { id: link.id } });
          continue;
        }
        const dup = await tx.drugAlternativeLink.findUnique({
          where: {
            sourceDrugId_alternativeDrugId: {
              sourceDrugId: targetId,
              alternativeDrugId: link.alternativeDrugId,
            },
          },
        });
        if (dup) await tx.drugAlternativeLink.delete({ where: { id: link.id } });
        else
          await tx.drugAlternativeLink.update({
            where: { id: link.id },
            data: { sourceDrugId: targetId },
          });
      }
      for (const link of asAlternative) {
        if (link.sourceDrugId === targetId) {
          await tx.drugAlternativeLink.delete({ where: { id: link.id } });
          continue;
        }
        const dup = await tx.drugAlternativeLink.findUnique({
          where: {
            sourceDrugId_alternativeDrugId: {
              sourceDrugId: link.sourceDrugId,
              alternativeDrugId: targetId,
            },
          },
        });
        if (dup) await tx.drugAlternativeLink.delete({ where: { id: link.id } });
        else {
          await tx.drugAlternativeLink.update({
            where: { id: link.id },
            data: { alternativeDrugId: targetId },
          });
        }
      }

      const updatedSource = await tx.drug.update({
        where: { id: sourceId },
        data: {
          mergedIntoDrugId: targetId,
          active: false,
          version: { increment: 1 },
          updatedById: actor.userId,
        },
      });
      const updatedTarget = await tx.drug.update({
        where: { id: targetId },
        data: { version: { increment: 1 }, updatedById: actor.userId },
      });
      return { source: updatedSource, target: updatedTarget };
    });

    await this.timeline.record({
      entityType: 'drug',
      entityId: sourceId,
      eventType: 'merged_into',
      actorId: actor.userId,
      payload: { targetDrugId: targetId, reason: dto.reason ?? null },
    });
    await this.timeline.record({
      entityType: 'drug',
      entityId: targetId,
      eventType: 'merged_from',
      actorId: actor.userId,
      payload: { sourceDrugId: sourceId },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.drug_merge',
      entityType: 'drug',
      entityId: sourceId,
      after: { targetDrugId: targetId, reason: dto.reason ?? null },
      ...meta,
    });
    return result;
  }

  // ── Optimistic-locked field edits ───────────────────────────────────

  async updateFields(actor: AuthUser, id: string, dto: UpdateDrugFieldsDto, meta: { ip?: string }) {
    const drug = await this.prisma.drug.findUnique({ where: { id } });
    if (!drug) throw new NotFoundException('Drug not found');
    if (drug.version !== dto.expectedVersion) {
      throw new ConflictException(
        `Expected version ${dto.expectedVersion} but drug is at version ${drug.version} — reload and retry`,
      );
    }

    const data: Prisma.DrugUncheckedUpdateInput = {
      dosageFormId: dto.dosageFormId,
      manufacturerId: dto.manufacturerId,
      countryOfOriginId: dto.countryOfOriginId,
      strengthText: dto.strengthText,
      regulatoryCategory: dto.regulatoryCategory,
      requiresPrescription: dto.requiresPrescription,
      requiresSpecialHandling: dto.requiresSpecialHandling,
      controlledDrug: dto.controlledDrug,
      coldChain: dto.coldChain,
      version: { increment: 1 },
      updatedById: actor.userId,
    };
    const updated = await this.prisma.drug.update({ where: { id }, data });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.drug_update_fields',
      entityType: 'drug',
      entityId: id,
      before: { version: drug.version },
      after: { ...dto, version: updated.version },
      ...meta,
    });
    return updated;
  }

  // ── Data-quality status ─────────────────────────────────────────────

  async setQualityStatus(
    actor: AuthUser,
    id: string,
    dto: SetDataQualityStatusDto,
    meta: { ip?: string },
  ) {
    const drug = await this.prisma.drug.findUnique({ where: { id } });
    if (!drug) throw new NotFoundException('Drug not found');

    const updated = await this.prisma.drug.update({
      where: { id },
      data: {
        dataQualityStatus: dto.status,
        version: { increment: 1 },
        updatedById: actor.userId,
        ...(dto.status === 'VERIFIED'
          ? { approvedById: actor.userId, approvedAt: new Date() }
          : {}),
      },
    });
    await this.timeline.record({
      entityType: 'drug',
      entityId: id,
      eventType: 'data_quality_status_changed',
      actorId: actor.userId,
      payload: { from: drug.dataQualityStatus, to: dto.status, note: dto.note ?? null },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.drug_quality_status',
      entityType: 'drug',
      entityId: id,
      before: { dataQualityStatus: drug.dataQualityStatus },
      after: { dataQualityStatus: dto.status, note: dto.note ?? null },
      ...meta,
    });
    return updated;
  }

  // ── Dashboard ────────────────────────────────────────────────────────

  async dashboard() {
    const activeFilter: Prisma.DrugWhereInput = { mergedIntoDrugId: null };
    const [
      totalActiveDrugs,
      byStatus,
      missingNameAr,
      missingDosageForm,
      missingManufacturer,
      missingStrength,
      missingBarcode,
      pendingAliasApprovals,
      pendingAlternativeApprovals,
      pendingImportBatches,
      mergedDrugs,
    ] = await Promise.all([
      this.prisma.drug.count({ where: activeFilter }),
      this.prisma.drug.groupBy({
        by: ['dataQualityStatus'],
        where: activeFilter,
        _count: true,
      }),
      this.prisma.drug.count({ where: { ...activeFilter, ...QUALITY_RULES.missing_name_ar } }),
      this.prisma.drug.count({ where: { ...activeFilter, ...QUALITY_RULES.missing_dosage_form } }),
      this.prisma.drug.count({ where: { ...activeFilter, ...QUALITY_RULES.missing_manufacturer } }),
      this.prisma.drug.count({ where: { ...activeFilter, ...QUALITY_RULES.missing_strength } }),
      this.prisma.drug.count({ where: { ...activeFilter, ...QUALITY_RULES.missing_barcode } }),
      this.prisma.drugAlias.count({ where: { approved: false, active: true } }),
      this.prisma.drugAlternativeLink.count({ where: { pharmacistApproved: false, active: true } }),
      this.prisma.drugImportBatch.count({
        where: { status: { in: ['UPLOADED', 'MAPPING', 'VALIDATED'] } },
      }),
      this.prisma.drug.count({ where: { mergedIntoDrugId: { not: null } } }),
    ]);

    return {
      totalActiveDrugs,
      byDataQualityStatus: Object.fromEntries(byStatus.map((s) => [s.dataQualityStatus, s._count])),
      missingFields: {
        nameAr: missingNameAr,
        dosageForm: missingDosageForm,
        manufacturer: missingManufacturer,
        strengthText: missingStrength,
        barcode: missingBarcode,
      },
      pendingAliasApprovals,
      pendingAlternativeApprovals,
      pendingImportBatches,
      mergedDrugs,
    };
  }

  listIssues(rule: string, limit = 50) {
    const where = QUALITY_RULES[rule];
    if (!where) {
      throw new BadRequestException(
        `Unknown rule: ${rule}. Valid rules: ${Object.keys(QUALITY_RULES).join(', ')}`,
      );
    }
    return this.prisma.drug.findMany({
      where: { ...where, mergedIntoDrugId: null },
      select: { id: true, materialNo: true, nameEn: true, nameAr: true, dataQualityStatus: true },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }
}
