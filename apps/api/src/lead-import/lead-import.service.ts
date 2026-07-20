import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { DuplicateHandling, ImportBatchStatus } from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS_CLIENT } from "../redis/redis.module";
import { AuditService } from "../audit/audit.service";
import { normalizePhone, isValidPhone } from "../common/utils/phone";
import { parseSpreadsheet, buildRejectedRowsWorkbook } from "./excel-parser.util";

export const LEAD_IMPORT_QUEUE = "lead-import";
const STAGING_TTL_SECONDS = 6 * 60 * 60;

export interface StagedLeadRow {
  rowNumber: number;
  customerName: string;
  primaryPhone: string;
  primaryPhoneNorm: string;
  secondaryPhone?: string;
  nationalOrInsId?: string;
  city?: string;
  area?: string;
  address?: string;
  externalReference?: string;
  source?: string;
  notes?: string;
  customFields: Record<string, unknown>;
  inFileDuplicate: boolean;
}

const CORE_FIELDS = [
  "customerName",
  "primaryPhone",
  "secondaryPhone",
  "nationalOrInsId",
  "city",
  "area",
  "address",
  "externalReference",
  "source",
  "notes",
];

@Injectable()
export class LeadImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(LEAD_IMPORT_QUEUE) private readonly queue: Queue,
  ) {}

  async preview(buffer: Buffer, fileName: string, partnerId: string) {
    const parsed = await parseSpreadsheet(buffer, fileName);
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      include: { columnMappings: true },
    });
    if (!partner) throw new NotFoundException("Partner not found");

    return {
      headers: parsed.headers,
      sampleRows: parsed.rows.slice(0, 10),
      totalRowsDetected: parsed.rows.length,
      requiredImportColumns: partner.requiredImportColumns,
      savedMappings: partner.columnMappings,
    };
  }

  async createBatch(params: {
    buffer: Buffer;
    fileName: string;
    fileSize: number;
    partnerId: string;
    categoryId: string;
    taskId?: string;
    mapping: Record<string, string>;
    duplicateHandling: DuplicateHandling;
    uploadedById: string;
  }) {
    const partner = await this.prisma.partner.findUnique({ where: { id: params.partnerId } });
    if (!partner) throw new NotFoundException("Partner not found");

    const category = await this.prisma.leadCategory.findUnique({ where: { id: params.categoryId } });
    if (!category) throw new NotFoundException("Lead category not found");

    if (!params.mapping.customerName || !params.mapping.primaryPhone) {
      throw new BadRequestException("Column mapping must include customerName and primaryPhone");
    }

    const parsed = await parseSpreadsheet(params.buffer, params.fileName);
    const requiredColumns: string[] =
      (partner.requiredImportColumns as string[] | null)?.length
        ? (partner.requiredImportColumns as string[])
        : ["customerName", "primaryPhone"];
    const duplicateRuleFields: string[] = (partner.duplicateRuleFields as string[] | null) ?? ["phone"];

    const staged: StagedLeadRow[] = [];
    const rejected: { rowNumber: number; rawData: Record<string, unknown>; reasons: string[] }[] = [];
    const seenKeys = new Set<string>();

    parsed.rows.forEach((rawRow, idx) => {
      const rowNumber = idx + 2; // header is row 1
      const reasons: string[] = [];

      const mapped: Record<string, string> = {};
      for (const field of CORE_FIELDS) {
        const sourceColumn = params.mapping[field];
        mapped[field] = sourceColumn ? (rawRow[sourceColumn] ?? "").trim() : "";
      }
      const customFields: Record<string, unknown> = {};
      for (const [field, sourceColumn] of Object.entries(params.mapping)) {
        if (!CORE_FIELDS.includes(field)) {
          customFields[field] = rawRow[sourceColumn];
        }
      }

      for (const req of requiredColumns) {
        if (!mapped[req] || mapped[req].length === 0) {
          reasons.push(`Missing required field: ${req}`);
        }
      }

      if (mapped.primaryPhone && !isValidPhone(mapped.primaryPhone)) {
        reasons.push("Invalid primary phone number");
      }

      const primaryPhoneNorm = normalizePhone(mapped.primaryPhone) ?? "";

      const dedupeKey = duplicateRuleFields
        .map((f) => {
          if (f === "phone") return primaryPhoneNorm;
          if (f === "externalReference") return mapped.externalReference;
          if (f === "nationalOrInsId") return mapped.nationalOrInsId;
          if (f === "partner") return params.partnerId;
          return "";
        })
        .join("|");

      const inFileDuplicate = dedupeKey.trim().length > 0 && seenKeys.has(dedupeKey);
      if (dedupeKey.trim().length > 0) seenKeys.add(dedupeKey);

      if (reasons.length > 0) {
        rejected.push({ rowNumber, rawData: rawRow, reasons });
        return;
      }

      staged.push({
        rowNumber,
        customerName: mapped.customerName,
        primaryPhone: mapped.primaryPhone,
        primaryPhoneNorm,
        secondaryPhone: mapped.secondaryPhone || undefined,
        nationalOrInsId: mapped.nationalOrInsId || undefined,
        city: mapped.city || undefined,
        area: mapped.area || undefined,
        address: mapped.address || undefined,
        externalReference: mapped.externalReference || undefined,
        source: mapped.source || undefined,
        notes: mapped.notes || undefined,
        customFields,
        inFileDuplicate,
      });
    });

    const batch = await this.prisma.leadImportBatch.create({
      data: {
        partnerId: params.partnerId,
        categoryId: params.categoryId,
        taskId: params.taskId,
        fileName: params.fileName,
        fileSize: params.fileSize,
        status: ImportBatchStatus.PENDING,
        duplicateHandling: params.duplicateHandling,
        columnMapping: params.mapping as any,
        totalRows: parsed.rows.length,
        successRows: staged.length,
        failedRows: rejected.length,
        duplicateRows: staged.filter((s) => s.inFileDuplicate).length,
        uploadedById: params.uploadedById,
      },
    });

    if (rejected.length > 0) {
      await this.prisma.rejectedImportRow.createMany({
        data: rejected.map((r) => ({
          batchId: batch.id,
          rowNumber: r.rowNumber,
          rawData: r.rawData as any,
          reasons: r.reasons as any,
        })),
      });
    }

    await this.redis.set(this.stagingKey(batch.id), JSON.stringify(staged), "EX", STAGING_TTL_SECONDS);

    await this.audit.log({
      action: "LEAD_IMPORT_UPLOAD",
      userId: params.uploadedById,
      entityType: "LeadImportBatch",
      entityId: batch.id,
      metadata: { fileName: params.fileName, totalRows: parsed.rows.length, rejected: rejected.length },
    });

    return this.getBatch(batch.id);
  }

  async commit(batchId: string, actorId: string) {
    const batch = await this.prisma.leadImportBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException("Import batch not found");
    if (batch.status !== ImportBatchStatus.PENDING) {
      throw new BadRequestException(`Batch cannot be committed from status ${batch.status}`);
    }

    const staged = await this.redis.get(this.stagingKey(batchId));
    if (!staged) {
      throw new BadRequestException("Staged import data expired. Please re-upload the file.");
    }

    await this.prisma.leadImportBatch.update({
      where: { id: batchId },
      data: { status: ImportBatchStatus.PROCESSING },
    });

    await this.audit.log({
      action: "LEAD_IMPORT_COMMIT",
      userId: actorId,
      entityType: "LeadImportBatch",
      entityId: batchId,
    });

    await this.queue.add("process-batch", { batchId }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });

    return this.getBatch(batchId);
  }

  async cancel(batchId: string, actorId: string) {
    const batch = await this.prisma.leadImportBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException("Import batch not found");
    if (batch.status !== ImportBatchStatus.PENDING) {
      throw new BadRequestException("Only pending batches (not yet processed) can be cancelled");
    }
    await this.prisma.leadImportBatch.update({ where: { id: batchId }, data: { status: ImportBatchStatus.CANCELLED } });
    await this.redis.del(this.stagingKey(batchId));
    await this.audit.log({
      action: "LEAD_IMPORT_CANCEL",
      userId: actorId,
      entityType: "LeadImportBatch",
      entityId: batchId,
    });
    return this.getBatch(batchId);
  }

  async listBatches(params: { partnerId?: string; status?: string }) {
    return this.prisma.leadImportBatch.findMany({
      where: { partnerId: params.partnerId, status: params.status as any },
      include: { partner: { select: { id: true, name: true, code: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async getBatch(id: string) {
    const batch = await this.prisma.leadImportBatch.findUnique({
      where: { id },
      include: { partner: { select: { id: true, name: true, code: true } } },
    });
    if (!batch) throw new NotFoundException("Import batch not found");
    return batch;
  }

  async downloadRejectedRows(batchId: string) {
    const rows = await this.prisma.rejectedImportRow.findMany({ where: { batchId }, orderBy: { rowNumber: "asc" } });
    return buildRejectedRowsWorkbook(
      rows.map((r) => ({
        rowNumber: r.rowNumber,
        rawData: r.rawData as Record<string, unknown>,
        reasons: r.reasons as string[],
      })),
    );
  }

  private stagingKey(batchId: string) {
    return `import:staging:${batchId}`;
  }
}
