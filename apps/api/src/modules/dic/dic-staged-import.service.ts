import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { foldDrugNameVariants } from './normalization';
import type { CreateImportBatchDto, ResolveImportRowDto, SetImportMappingDto } from './dic.dto';

/**
 * CR-002 Phase 4 Step 5 — staged Excel import (design doc §7/§20/§21).
 * Never writes to Drug directly: every uploaded row lands in
 * DrugImportRow first, goes through mapping → validation (incl.
 * weighted-signal duplicate detection) → reviewer resolution → an
 * explicit approval gate → execution. "Do not import directly into
 * production tables without validation."
 */

const IMPORT_ROW_STATUSES = [
  'PENDING',
  'VALID',
  'INVALID',
  'DUPLICATE',
  'IMPORTED',
  'SKIPPED',
  'FAILED',
] as const;

const IMPORT_BATCH_STATUSES = [
  'UPLOADED',
  'MAPPING',
  'VALIDATING',
  'VALIDATED',
  'APPROVED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'ROLLED_BACK',
] as const;

/** Canonical Drug fields a source column may be mapped onto. */
const IMPORTABLE_FIELDS = [
  'materialNo',
  'nameEn',
  'nameAr',
  'brand',
  'barcode',
  'strengthText',
  'activeIngredient',
  'manufacturerName',
  'dosageFormCode',
] as const;
type ImportableField = (typeof IMPORTABLE_FIELDS)[number];

interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

interface DuplicateCandidate {
  drugId: string;
  materialNo: string;
  nameEn: string;
  score: number;
  matchedOn: string[];
}

const str = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

/** Strips a formula-trigger prefix before a CSV cell reaches Excel/Sheets
 *  (=, +, -, @ at the start auto-evaluate on open — CSV injection). */
function sanitizeCsvCell(value: string): string {
  const needsGuard = /^[=+\-@\t\r]/.test(value);
  const escaped = value.replaceAll('"', '""');
  return needsGuard ? `"'${escaped}"` : `"${escaped}"`;
}

@Injectable()
export class DicStagedImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
  ) {}

  // ── Upload ───────────────────────────────────────────────────────────

  async createBatch(actor: AuthUser, dto: CreateImportBatchDto, meta: { ip?: string }) {
    const fileHash = createHash('sha256').update(JSON.stringify(dto.rows)).digest('hex');
    const batch = await this.prisma.drugImportBatch.create({
      data: {
        fileName: dto.fileName,
        fileHash,
        uploadedById: actor.userId,
        totalRows: dto.rows.length,
        rows: {
          create: dto.rows.map((rawData, i) => ({
            rowNumber: i + 1,
            rawDataJson: rawData as Prisma.InputJsonValue,
          })),
        },
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.import.batch_upload',
      entityType: 'drug_import_batch',
      entityId: batch.id,
      after: { fileName: dto.fileName, totalRows: dto.rows.length },
      ...meta,
    });
    return batch;
  }

  // ── Mapping ──────────────────────────────────────────────────────────

  async setMapping(actor: AuthUser, id: string, dto: SetImportMappingDto, meta: { ip?: string }) {
    const batch = await this.requireBatch(id);
    if (batch.status !== 'UPLOADED' && batch.status !== 'MAPPING') {
      throw new BadRequestException(`Cannot set mapping in status ${batch.status}`);
    }
    for (const target of Object.values(dto.mapping)) {
      if (!(IMPORTABLE_FIELDS as readonly string[]).includes(target)) {
        throw new BadRequestException(`Unknown target field: ${target}`);
      }
    }
    if (!Object.values(dto.mapping).includes('materialNo')) {
      throw new BadRequestException('mapping must map a source column to materialNo');
    }
    if (!Object.values(dto.mapping).includes('nameEn')) {
      throw new BadRequestException('mapping must map a source column to nameEn');
    }

    const updated = await this.prisma.drugImportBatch.update({
      where: { id },
      data: { status: 'MAPPING', mappingJson: dto.mapping as Prisma.InputJsonValue },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.import.batch_mapping',
      entityType: 'drug_import_batch',
      entityId: id,
      after: dto.mapping,
      ...meta,
    });
    return updated;
  }

  // ── Validation (also serves as the "dry run" report) ────────────────

  async validate(actor: AuthUser, id: string, meta: { ip?: string }) {
    const batch = await this.requireBatch(id);
    if (!batch.mappingJson) {
      throw new BadRequestException('Set a column mapping before validating');
    }
    const mapping = batch.mappingJson as Record<string, string>;
    const rows = await this.prisma.drugImportRow.findMany({
      where: { batchId: id },
      orderBy: { rowNumber: 'asc' },
    });

    const existingDrugs = await this.prisma.drug.findMany({
      select: {
        id: true,
        materialNo: true,
        nameEn: true,
        barcode: true,
        normalizedTradeNameEnglish: true,
      },
    });
    const byMaterialNo = new Map(existingDrugs.map((d) => [d.materialNo, d]));
    const byBarcode = new Map(
      existingDrugs.filter((d) => d.barcode).map((d) => [d.barcode as string, d]),
    );
    const byNormalizedName = new Map<string, typeof existingDrugs>();
    for (const d of existingDrugs) {
      const key = d.normalizedTradeNameEnglish ?? foldDrugNameVariants(d.nameEn);
      byNormalizedName.set(key, [...(byNormalizedName.get(key) ?? []), d]);
    }

    const seenInBatch = new Set<string>();
    let validRows = 0;
    let invalidRows = 0;
    let duplicateRows = 0;

    for (const row of rows) {
      const raw = row.rawDataJson as Record<string, unknown>;
      const normalized: Partial<Record<ImportableField, string>> = {};
      for (const [source, target] of Object.entries(mapping)) {
        const value = str(raw[source]);
        if (value) normalized[target as ImportableField] = value;
      }

      const issues: ValidationIssue[] = [];
      if (!normalized.materialNo) {
        issues.push({ field: 'materialNo', message: 'materialNo is required', severity: 'error' });
      } else if (seenInBatch.has(normalized.materialNo)) {
        issues.push({
          field: 'materialNo',
          message: 'Duplicate materialNo within this batch',
          severity: 'error',
        });
      } else {
        seenInBatch.add(normalized.materialNo);
      }
      if (!normalized.nameEn) {
        issues.push({ field: 'nameEn', message: 'nameEn is required', severity: 'error' });
      }
      if (normalized.barcode && !/^\d{8,14}$/.test(normalized.barcode)) {
        issues.push({
          field: 'barcode',
          message: 'barcode should be an 8-14 digit code',
          severity: 'warning',
        });
      }

      const hasError = issues.some((i) => i.severity === 'error');
      let status: 'VALID' | 'INVALID' | 'DUPLICATE' = hasError ? 'INVALID' : 'VALID';
      let candidates: DuplicateCandidate[] = [];

      if (!hasError) {
        candidates = this.findDuplicateCandidates(
          normalized,
          byMaterialNo,
          byBarcode,
          byNormalizedName,
        );
        if (candidates.length) status = 'DUPLICATE';
      }

      if (status === 'VALID') validRows++;
      else if (status === 'INVALID') invalidRows++;
      else duplicateRows++;

      await this.prisma.drugImportRow.update({
        where: { id: row.id },
        data: {
          normalizedDataJson: normalized as Prisma.InputJsonValue,
          validationErrorsJson: issues.length
            ? (issues as unknown as Prisma.InputJsonValue)
            : undefined,
          duplicateCandidatesJson: candidates.length
            ? (candidates as unknown as Prisma.InputJsonValue)
            : undefined,
          status,
        },
      });
    }

    const updated = await this.prisma.drugImportBatch.update({
      where: { id },
      data: { status: 'VALIDATED', validRows, invalidRows, duplicateRows },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.import.batch_validate',
      entityType: 'drug_import_batch',
      entityId: id,
      after: { validRows, invalidRows, duplicateRows },
      ...meta,
    });
    return updated;
  }

  private findDuplicateCandidates(
    normalized: Partial<Record<ImportableField, string>>,
    byMaterialNo: Map<string, { id: string; materialNo: string; nameEn: string }>,
    byBarcode: Map<string, { id: string; materialNo: string; nameEn: string }>,
    byNormalizedName: Map<string, { id: string; materialNo: string; nameEn: string }[]>,
  ): DuplicateCandidate[] {
    const scored = new Map<string, DuplicateCandidate>();
    const add = (
      drug: { id: string; materialNo: string; nameEn: string },
      score: number,
      on: string,
    ) => {
      const existing = scored.get(drug.id);
      if (existing) {
        existing.score = Math.max(existing.score, score);
        if (!existing.matchedOn.includes(on)) existing.matchedOn.push(on);
      } else {
        scored.set(drug.id, {
          drugId: drug.id,
          materialNo: drug.materialNo,
          nameEn: drug.nameEn,
          score,
          matchedOn: [on],
        });
      }
    };

    if (normalized.materialNo) {
      const hit = byMaterialNo.get(normalized.materialNo);
      if (hit) add(hit, 100, 'materialNo');
    }
    if (normalized.barcode) {
      const hit = byBarcode.get(normalized.barcode);
      if (hit) add(hit, 80, 'barcode');
    }
    if (normalized.nameEn) {
      const hits = byNormalizedName.get(foldDrugNameVariants(normalized.nameEn)) ?? [];
      for (const hit of hits) add(hit, 50, 'nameEn');
    }

    return [...scored.values()]
      .filter((c) => c.score >= 50)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  // ── Preview / listing ────────────────────────────────────────────────

  async preview(id: string, status?: string) {
    await this.requireBatch(id);
    if (status && !IMPORT_ROW_STATUSES.includes(status as (typeof IMPORT_ROW_STATUSES)[number])) {
      throw new BadRequestException(`Unknown row status: ${status}`);
    }
    return this.prisma.drugImportRow.findMany({
      where: { batchId: id, status: status as Prisma.EnumImportRowStatusFilter['equals'] },
      orderBy: { rowNumber: 'asc' },
      take: 500,
    });
  }

  listBatches(status?: string) {
    if (
      status &&
      !IMPORT_BATCH_STATUSES.includes(status as (typeof IMPORT_BATCH_STATUSES)[number])
    ) {
      throw new BadRequestException(`Unknown batch status: ${status}`);
    }
    return this.prisma.drugImportBatch.findMany({
      where: status
        ? { status: status as Prisma.EnumImportBatchStatusFilter['equals'] }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  getBatch(id: string) {
    return this.requireBatch(id);
  }

  // ── Row resolution ───────────────────────────────────────────────────

  async resolveRow(
    actor: AuthUser,
    rowId: string,
    dto: ResolveImportRowDto,
    meta: { ip?: string },
  ) {
    const row = await this.prisma.drugImportRow.findUnique({ where: { id: rowId } });
    if (!row) throw new NotFoundException('Import row not found');
    if (row.status !== 'DUPLICATE') {
      throw new BadRequestException('Only rows flagged as DUPLICATE can be resolved');
    }
    if ((dto.resolution === 'LINK_EXISTING' || dto.resolution === 'MERGE') && !dto.linkedDrugId) {
      throw new BadRequestException(`${dto.resolution} requires linkedDrugId`);
    }

    const updated = await this.prisma.drugImportRow.update({
      where: { id: rowId },
      data: { resolution: dto.resolution, linkedDrugId: dto.linkedDrugId },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.import.row_resolve',
      entityType: 'drug_import_row',
      entityId: rowId,
      after: dto,
      ...meta,
    });
    return updated;
  }

  // ── Approval ─────────────────────────────────────────────────────────

  async approve(actor: AuthUser, id: string, meta: { ip?: string }) {
    const batch = await this.requireBatch(id);
    if (batch.status !== 'VALIDATED') {
      throw new BadRequestException(`Cannot approve a batch in status ${batch.status}`);
    }
    const unresolved = await this.prisma.drugImportRow.count({
      where: { batchId: id, status: 'DUPLICATE', resolution: null },
    });
    if (unresolved > 0) {
      throw new UnprocessableEntityException(
        `${unresolved} duplicate row(s) still need resolution before approval`,
      );
    }

    const updated = await this.prisma.drugImportBatch.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: actor.userId, approvedAt: new Date() },
    });
    await this.timeline.record({
      entityType: 'drug_import_batch',
      entityId: id,
      eventType: 'import_approved',
      actorId: actor.userId,
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.import.batch_approve',
      entityType: 'drug_import_batch',
      entityId: id,
      ...meta,
    });
    return updated;
  }

  // ── Execution ────────────────────────────────────────────────────────

  async execute(actor: AuthUser, id: string, meta: { ip?: string }) {
    const batch = await this.requireBatch(id);
    if (batch.status !== 'APPROVED') {
      throw new BadRequestException(`Cannot execute a batch in status ${batch.status}`);
    }
    await this.prisma.drugImportBatch.update({ where: { id }, data: { status: 'EXECUTING' } });

    const rows = await this.prisma.drugImportRow.findMany({
      where: { batchId: id },
      orderBy: { rowNumber: 'asc' },
    });

    let importedRows = 0;
    let failedRows = 0;

    for (const row of rows) {
      if (row.status === 'INVALID') continue;
      if (
        row.status === 'DUPLICATE' &&
        (row.resolution === 'REJECT_ROW' || row.resolution === 'DEFER_REVIEW')
      ) {
        await this.prisma.drugImportRow.update({
          where: { id: row.id },
          data: { status: 'SKIPPED' },
        });
        continue;
      }

      const normalized = (row.normalizedDataJson ?? {}) as Partial<Record<ImportableField, string>>;
      try {
        if (
          row.status === 'DUPLICATE' &&
          (row.resolution === 'LINK_EXISTING' || row.resolution === 'MERGE')
        ) {
          if (!row.linkedDrugId) throw new Error('Missing linkedDrugId for resolved duplicate');
          // Conservative enrichment only — never overwrite existing
          // non-null fields on the linked drug ("prevent silent data loss").
          const target = await this.prisma.drug.findUnique({ where: { id: row.linkedDrugId } });
          if (!target) throw new Error('Linked drug no longer exists');
          const fill: Prisma.DrugUpdateInput = {};
          if (!target.nameAr && normalized.nameAr) fill.nameAr = normalized.nameAr;
          if (!target.brand && normalized.brand) fill.brand = normalized.brand;
          if (!target.barcode && normalized.barcode) fill.barcode = normalized.barcode;
          if (!target.strengthText && normalized.strengthText)
            fill.strengthText = normalized.strengthText;
          if (!target.activeIngredient && normalized.activeIngredient) {
            fill.activeIngredient = normalized.activeIngredient;
          }
          if (Object.keys(fill).length) {
            await this.prisma.drug.update({
              where: { id: row.linkedDrugId },
              data: { ...fill, updatedById: actor.userId },
            });
          }
          await this.prisma.drugImportRow.update({
            where: { id: row.id },
            data: { status: 'IMPORTED', linkedDrugId: row.linkedDrugId },
          });
        } else {
          const created = await this.prisma.drug.create({
            data: {
              materialNo: normalized.materialNo!,
              nameEn: normalized.nameEn!,
              nameAr: normalized.nameAr,
              brand: normalized.brand,
              barcode: normalized.barcode,
              strengthText: normalized.strengthText,
              activeIngredient: normalized.activeIngredient,
              sourceSystem: 'staged_import',
              sourceRecordId: batch.id,
              createdById: actor.userId,
            },
          });
          await this.prisma.drugImportRow.update({
            where: { id: row.id },
            data: { status: 'IMPORTED', linkedDrugId: created.id },
          });
        }
        importedRows++;
      } catch (err) {
        failedRows++;
        await this.prisma.drugImportRow.update({
          where: { id: row.id },
          data: {
            status: 'FAILED',
            validationErrorsJson: [
              { field: '_execute', message: String((err as Error).message), severity: 'error' },
            ] as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }

    const updated = await this.prisma.drugImportBatch.update({
      where: { id },
      data: {
        status: failedRows > 0 && importedRows === 0 ? 'FAILED' : 'COMPLETED',
        importedRows,
        failedRows,
        completedAt: new Date(),
      },
    });
    await this.timeline.record({
      entityType: 'drug_import_batch',
      entityId: id,
      eventType: 'import_executed',
      actorId: actor.userId,
      payload: { importedRows, failedRows },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.import.batch_execute',
      entityType: 'drug_import_batch',
      entityId: id,
      after: { importedRows, failedRows },
      ...meta,
    });
    return updated;
  }

  // ── Rollback ─────────────────────────────────────────────────────────

  async rollback(actor: AuthUser, id: string, meta: { ip?: string }) {
    const batch = await this.requireBatch(id);
    if (batch.status !== 'COMPLETED') {
      throw new BadRequestException(`Cannot roll back a batch in status ${batch.status}`);
    }

    const importedRows = await this.prisma.drugImportRow.findMany({
      where: { batchId: id, status: 'IMPORTED' },
    });
    // Only newly created drugs can be safely reversed — a LINK_EXISTING/
    // MERGE row modified a pre-existing drug in place with no before-
    // snapshot, so auto-reverting it risks silent data loss. Refuse
    // rather than guess.
    const unsafeToRevert = importedRows.filter(
      (r) => r.resolution === 'LINK_EXISTING' || r.resolution === 'MERGE',
    );
    if (unsafeToRevert.length) {
      throw new UnprocessableEntityException(
        `${unsafeToRevert.length} row(s) enriched existing drugs and cannot be auto-rolled-back; ` +
          'review manually (rows: ' +
          unsafeToRevert.map((r) => r.rowNumber).join(', ') +
          ')',
      );
    }

    const createdDrugIds = importedRows.map((r) => r.linkedDrugId).filter((v): v is string => !!v);
    await this.prisma.$transaction(async (tx) => {
      if (createdDrugIds.length) {
        await tx.drug.deleteMany({ where: { id: { in: createdDrugIds } } });
      }
      await tx.drugImportRow.updateMany({
        where: { batchId: id, status: 'IMPORTED' },
        data: { status: 'VALID', linkedDrugId: null },
      });
      await tx.drugImportBatch.update({
        where: { id },
        data: { status: 'ROLLED_BACK', rolledBackById: actor.userId, rolledBackAt: new Date() },
      });
    });

    await this.timeline.record({
      entityType: 'drug_import_batch',
      entityId: id,
      eventType: 'import_rolled_back',
      actorId: actor.userId,
      payload: { revertedDrugs: createdDrugIds.length },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.import.batch_rollback',
      entityType: 'drug_import_batch',
      entityId: id,
      after: { revertedDrugs: createdDrugIds.length },
      ...meta,
    });
    return this.requireBatch(id);
  }

  // ── Error report export (CSV injection-safe) ────────────────────────

  async errorReportCsv(id: string): Promise<string> {
    await this.requireBatch(id);
    const rows = await this.prisma.drugImportRow.findMany({
      where: { batchId: id, status: { in: ['INVALID', 'FAILED'] } },
      orderBy: { rowNumber: 'asc' },
    });
    const columns = ['rowNumber', 'status', 'errors', ...IMPORTABLE_FIELDS];
    const header = columns.map(sanitizeCsvCell).join(',');
    // Each mapped field is its own cell (not one JSON blob) so a
    // formula-triggering raw value (e.g. nameEn = "=cmd|...") is guarded
    // individually rather than hidden inside a JSON string that would
    // never itself start with =/+/-/@.
    const lines = rows.map((r) => {
      const errors = (r.validationErrorsJson as ValidationIssue[] | null) ?? [];
      const errorText = errors.map((e) => `${e.field}: ${e.message}`).join('; ');
      const normalized = (r.normalizedDataJson ?? {}) as Partial<Record<ImportableField, string>>;
      const cells = [
        String(r.rowNumber),
        r.status,
        errorText,
        ...IMPORTABLE_FIELDS.map((f) => normalized[f] ?? ''),
      ];
      return cells.map(sanitizeCsvCell).join(',');
    });
    return [header, ...lines].join('\r\n');
  }

  private async requireBatch(id: string) {
    const batch = await this.prisma.drugImportBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('Import batch not found');
    return batch;
  }
}
