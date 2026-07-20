import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import Redis from "ioredis";
import { DuplicateHandling, ImportBatchStatus, LeadWorkflowStatus } from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS_CLIENT } from "../redis/redis.module";
import { AuditService } from "../audit/audit.service";
import { LEAD_IMPORT_QUEUE, StagedLeadRow } from "./lead-import.service";

const CHUNK_SIZE = 500;

@Processor(LEAD_IMPORT_QUEUE)
export class LeadImportProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job<{ batchId: string }>) {
    const { batchId } = job.data;
    const batch = await this.prisma.leadImportBatch.findUnique({ where: { id: batchId } });
    if (!batch) {
      this.logger.warn(`Batch ${batchId} not found, skipping`);
      return;
    }

    try {
      const raw = await this.redis.get(`import:staging:${batchId}`);
      const staged: StagedLeadRow[] = raw ? JSON.parse(raw) : [];

      const duplicateRuleFields = (
        (await this.prisma.partner.findUnique({ where: { id: batch.partnerId } }))?.duplicateRuleFields as
          | string[]
          | null
      ) ?? ["phone"];

      const existingPhones = new Set(
        (
          await this.prisma.lead.findMany({
            where: { partnerId: batch.partnerId, primaryPhoneNorm: { in: staged.map((s) => s.primaryPhoneNorm).filter(Boolean) } },
            select: { primaryPhoneNorm: true },
          })
        ).map((l) => l.primaryPhoneNorm),
      );
      const existingRefs = duplicateRuleFields.includes("externalReference")
        ? new Set(
            (
              await this.prisma.lead.findMany({
                where: {
                  partnerId: batch.partnerId,
                  externalReference: { in: staged.map((s) => s.externalReference).filter(Boolean) as string[] },
                },
                select: { externalReference: true },
              })
            ).map((l) => l.externalReference),
          )
        : new Set<string | null>();
      const existingNationalIds = duplicateRuleFields.includes("nationalOrInsId")
        ? new Set(
            (
              await this.prisma.lead.findMany({
                where: {
                  partnerId: batch.partnerId,
                  nationalOrInsId: { in: staged.map((s) => s.nationalOrInsId).filter(Boolean) as string[] },
                },
                select: { nationalOrInsId: true },
              })
            ).map((l) => l.nationalOrInsId),
          )
        : new Set<string | null>();

      let inserted = 0;
      let duplicatesFound = 0;
      let skipped = 0;

      const toInsert: any[] = [];
      for (const row of staged) {
        const isDbDuplicate =
          (row.primaryPhoneNorm && existingPhones.has(row.primaryPhoneNorm)) ||
          (row.externalReference && existingRefs.has(row.externalReference)) ||
          (row.nationalOrInsId && existingNationalIds.has(row.nationalOrInsId));
        const isDuplicate = Boolean(isDbDuplicate) || row.inFileDuplicate;

        if (isDuplicate) {
          duplicatesFound += 1;
          if (batch.duplicateHandling === DuplicateHandling.SKIP) {
            skipped += 1;
            continue;
          }
        }

        toInsert.push({
          externalReference: row.externalReference,
          customerName: row.customerName,
          primaryPhone: row.primaryPhone,
          primaryPhoneNorm: row.primaryPhoneNorm,
          secondaryPhone: row.secondaryPhone,
          nationalOrInsId: row.nationalOrInsId,
          city: row.city,
          area: row.area,
          address: row.address,
          source: row.source,
          notes: row.notes,
          customFields: row.customFields as any,
          categoryId: batch.categoryId,
          partnerId: batch.partnerId,
          taskId: batch.taskId,
          batchId: batch.id,
          // isDuplicate also gates visibility to distribution/dashboard
          // queries (both hard-filter isDuplicate=false) — a row imported
          // with duplicateHandling=IMPORT ("import anyway") must stay
          // eligible for normal distribution, so it can't carry the same
          // flag a SKIP/MARK_FOR_REVIEW duplicate does even though it was
          // detected as one.
          isDuplicate: isDuplicate && batch.duplicateHandling !== DuplicateHandling.IMPORT,
          workflowStatus:
            isDuplicate && batch.duplicateHandling === DuplicateHandling.MARK_FOR_REVIEW
              ? LeadWorkflowStatus.DUPLICATE
              : LeadWorkflowStatus.NEW,
        });
      }

      for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
        const chunk = toInsert.slice(i, i + CHUNK_SIZE);
        await this.prisma.lead.createMany({ data: chunk });
        inserted += chunk.length;
      }

      await this.prisma.leadImportBatch.update({
        where: { id: batchId },
        data: {
          status: ImportBatchStatus.COMPLETED,
          successRows: inserted,
          duplicateRows: duplicatesFound,
          failedRows: batch.failedRows + skipped,
          completedAt: new Date(),
        },
      });

      await this.audit.log({
        action: "LEAD_IMPORT_COMMIT",
        userId: batch.uploadedById,
        entityType: "LeadImportBatch",
        entityId: batchId,
        metadata: { inserted, duplicatesFound, skipped },
      });

      await this.redis.del(`import:staging:${batchId}`);
    } catch (error: any) {
      this.logger.error(`Failed processing batch ${batchId}: ${error.message}`, error.stack);
      await this.prisma.leadImportBatch.update({
        where: { id: batchId },
        data: { status: ImportBatchStatus.FAILED, errorSummary: String(error.message).slice(0, 1000) },
      });
      throw error;
    }
  }
}
