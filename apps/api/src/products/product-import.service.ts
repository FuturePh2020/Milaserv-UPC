import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EventSource, ImportBatchStatus, ProductImportBehavior } from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";
import { TimelineService } from "../timeline/timeline.service";
import { AuditService } from "../audit/audit.service";
import { parseSpreadsheet, buildRejectedRowsWorkbook } from "../lead-import/excel-parser.util";

const IMPORT_FIELDS = [
  "itemCode",
  "barcode",
  "arabicName",
  "englishName",
  "scientificName",
  "activeIngredient",
  "category",
  "subcategory",
  "dosageForm",
  "strength",
  "unit",
  "packSize",
  "manufacturer",
  "defaultPrice",
  "currency",
  "cashAvailable",
  "insuranceAvailable",
  "isActive",
  "notes",
];

function parseBool(value: string | undefined, fallback = true): boolean {
  if (value === undefined || value === "") return fallback;
  return ["true", "1", "yes", "y"].includes(value.trim().toLowerCase());
}

@Injectable()
export class ProductImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
  ) {}

  async preview(buffer: Buffer, fileName: string) {
    const parsed = await parseSpreadsheet(buffer, fileName);
    return { headers: parsed.headers, sampleRows: parsed.rows.slice(0, 10), totalRowsDetected: parsed.rows.length, importFields: IMPORT_FIELDS };
  }

  async commit(params: {
    buffer: Buffer;
    fileName: string;
    fileSize: number;
    mapping: Record<string, string>;
    behavior: string;
    uploadedById: string;
  }) {
    const parsed = await parseSpreadsheet(params.buffer, params.fileName);
    if (!params.mapping.itemCode) {
      throw new BadRequestException("Column mapping must include itemCode");
    }

    const rejected: { rowNumber: number; rawData: Record<string, unknown>; reasons: string[] }[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (let idx = 0; idx < parsed.rows.length; idx++) {
      const rawRow = parsed.rows[idx];
      const rowNumber = idx + 2;
      const reasons: string[] = [];

      const mapped: Record<string, string> = {};
      for (const field of IMPORT_FIELDS) {
        const col = params.mapping[field];
        mapped[field] = col ? (rawRow[col] ?? "").trim() : "";
      }

      const itemCode = mapped.itemCode.trim();
      if (!itemCode) reasons.push("Missing required field: itemCode");
      if (!mapped.arabicName && !mapped.englishName) reasons.push("Arabic or English Item Name must be provided");
      if (mapped.defaultPrice && Number.isNaN(Number(mapped.defaultPrice))) reasons.push("Default Price must be numeric");

      if (reasons.length > 0) {
        rejected.push({ rowNumber, rawData: rawRow, reasons });
        continue;
      }

      const data = {
        itemCode,
        barcode: mapped.barcode || undefined,
        arabicName: mapped.arabicName || undefined,
        englishName: mapped.englishName || undefined,
        scientificName: mapped.scientificName || undefined,
        activeIngredient: mapped.activeIngredient || undefined,
        strength: mapped.strength || undefined,
        packSize: mapped.packSize || undefined,
        defaultPrice: mapped.defaultPrice ? Number(mapped.defaultPrice) : undefined,
        currency: mapped.currency || undefined,
        cashAvailable: parseBool(mapped.cashAvailable),
        insuranceAvailable: parseBool(mapped.insuranceAvailable),
        isActive: parseBool(mapped.isActive),
        notes: mapped.notes || undefined,
      };

      const existingByCode = await this.prisma.product.findUnique({ where: { itemCode } });
      const existingByBarcode = data.barcode
        ? await this.prisma.product.findUnique({ where: { barcode: data.barcode } })
        : null;

      try {
        switch (params.behavior) {
          case ProductImportBehavior.CREATE_ONLY:
          case ProductImportBehavior.REJECT_DUPLICATES:
            if (existingByCode || existingByBarcode) {
              rejected.push({ rowNumber, rawData: rawRow, reasons: ["Item Code or Barcode already exists"] });
              continue;
            }
            await this.prisma.product.create({ data: { ...data, createdById: params.uploadedById } });
            created++;
            break;
          case ProductImportBehavior.SKIP_DUPLICATES:
            if (existingByCode || existingByBarcode) {
              skipped++;
              continue;
            }
            await this.prisma.product.create({ data: { ...data, createdById: params.uploadedById } });
            created++;
            break;
          case ProductImportBehavior.UPDATE_BY_CODE:
            if (!existingByCode) {
              rejected.push({ rowNumber, rawData: rawRow, reasons: ["No existing item with this Item Code to update"] });
              continue;
            }
            await this.prisma.product.update({ where: { id: existingByCode.id }, data: { ...data, updatedById: params.uploadedById } });
            updated++;
            break;
          case ProductImportBehavior.UPDATE_BY_BARCODE:
            if (!existingByBarcode) {
              rejected.push({ rowNumber, rawData: rawRow, reasons: ["No existing item with this Barcode to update"] });
              continue;
            }
            await this.prisma.product.update({ where: { id: existingByBarcode.id }, data: { ...data, updatedById: params.uploadedById } });
            updated++;
            break;
          case ProductImportBehavior.CREATE_AND_UPDATE:
          default:
            if (existingByCode || existingByBarcode) {
              const target = existingByCode ?? existingByBarcode!;
              await this.prisma.product.update({ where: { id: target.id }, data: { ...data, updatedById: params.uploadedById } });
              updated++;
            } else {
              await this.prisma.product.create({ data: { ...data, createdById: params.uploadedById } });
              created++;
            }
            break;
        }
      } catch (err: any) {
        rejected.push({ rowNumber, rawData: rawRow, reasons: [err?.message ?? "Unknown error"] });
      }
    }

    const batch = await this.prisma.productImportBatch.create({
      data: {
        fileName: params.fileName,
        fileSize: params.fileSize,
        status: ImportBatchStatus.COMPLETED,
        behavior: params.behavior as any,
        totalRows: parsed.rows.length,
        createdRows: created,
        updatedRows: updated,
        skippedRows: skipped,
        rejectedRows: rejected.length,
        uploadedById: params.uploadedById,
        completedAt: new Date(),
      },
    });

    if (rejected.length > 0) {
      await this.prisma.productImportRowError.createMany({
        data: rejected.map((r) => ({ batchId: batch.id, rowNumber: r.rowNumber, rawData: r.rawData as any, reasons: r.reasons as any })),
      });
    }

    await this.timeline.record({
      entityType: "ProductImportBatch",
      entityId: batch.id,
      eventType: "PRODUCT_IMPORTED",
      actorUserId: params.uploadedById,
      newValue: { created, updated, skipped, rejected: rejected.length },
      source: EventSource.IMPORT,
    });
    await this.audit.log({
      action: "PRODUCT_IMPORT",
      userId: params.uploadedById,
      entityType: "ProductImportBatch",
      entityId: batch.id,
      metadata: { created, updated, skipped, rejected: rejected.length },
    });

    return batch;
  }

  async listBatches() {
    return this.prisma.productImportBatch.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  }

  async downloadRejectedRows(batchId: string) {
    const rows = await this.prisma.productImportRowError.findMany({ where: { batchId }, orderBy: { rowNumber: "asc" } });
    if (rows.length === 0) {
      const batch = await this.prisma.productImportBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException("Import batch not found");
    }
    return buildRejectedRowsWorkbook(
      rows.map((r) => ({ rowNumber: r.rowNumber, rawData: r.rawData as Record<string, unknown>, reasons: r.reasons as string[] })),
    );
  }
}
