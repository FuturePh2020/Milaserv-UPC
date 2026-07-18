import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type { Env } from '../../../core/config/env';
import { ENV } from '../../../core/config/config.module';
import { SettingsService } from '../../settings/settings.service';
import { TimelineService } from '../../timeline/timeline.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PythonOcrClientService } from '../python-ocr-client.service';
import { PRESCRIPTION_STORAGE } from '../storage/prescription-storage';
import type { PrescriptionStorageDriver } from '../storage/prescription-storage';
import { PRESCRIPTION_QUEUE_REDIS } from './queue-redis.provider';
import { PRESCRIPTION_OCR_QUEUE_NAME } from './prescription-ocr.queue';
import type { PrescriptionOcrJobData } from './prescription-ocr.queue';

const SIGNED_URL_TTL_SECONDS = 300;

/**
 * The BullMQ consumer for `prescription-ocr` (design spec §3 stages 3–15,
 * Sprint OCR-01 scope). Runs the deterministic mock pipeline end-to-end:
 * quality gate → (mock) preprocess → detect-and-recognize → persist
 * OCRTextBlock rows → detect-candidates → persist PrescriptionDrugCandidate
 * rows, every one defaulting to NEEDS_PHARMACIST_REVIEW since no real
 * matching engine exists yet (that's Sprint OCR-05/06).
 */
@Injectable()
export class PrescriptionOcrWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrescriptionOcrWorkerService.name);
  private worker: Worker<PrescriptionOcrJobData> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PRESCRIPTION_QUEUE_REDIS) private readonly redis: Redis,
    @Inject(PRESCRIPTION_STORAGE) private readonly storage: PrescriptionStorageDriver,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly timeline: TimelineService,
    private readonly notifications: NotificationsService,
    private readonly pythonOcr: PythonOcrClientService,
  ) {}

  onModuleInit() {
    if (!this.env.PRESCRIPTION_OCR_WORKER_ENABLED) return;
    this.worker = new Worker<PrescriptionOcrJobData>(
      PRESCRIPTION_OCR_QUEUE_NAME,
      (job) => this.processPage(job),
      { connection: this.redis.duplicate(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
      if (exhausted) {
        // Every retry is already handled by BullMQ's own backoff — this
        // only fires once, on the truly final attempt (design spec §10:
        // "retry policies and a dead-letter queue").
        void this.markPageFailed(job.data.pageId, err.message).catch((e: unknown) =>
          this.logger.error(`Failed to record terminal failure for page ${job.data.pageId}`, e),
        );
      }
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async processPage(job: Job<PrescriptionOcrJobData>): Promise<void> {
    const { pageId } = job.data;
    const page = await this.prisma.prescriptionPage.findUnique({ where: { id: pageId } });
    if (!page) return; // page was deleted — nothing to do
    // Idempotency guard: a page already in a terminal state was already
    // handled by a prior attempt/duplicate enqueue.
    if (
      page.processingStatus === 'COMPLETED' ||
      page.processingStatus === 'IMAGE_REUPLOAD_REQUIRED'
    ) {
      return;
    }

    const originalUrl = await this.storage.getSignedUrl(
      page.originalStorageKey,
      SIGNED_URL_TTL_SECONDS,
    );

    // ── Stage: quality gate ───────────────────────────────────────────
    await this.prisma.prescriptionPage.update({
      where: { id: pageId },
      data: { processingStatus: 'ANALYZING_QUALITY' },
    });
    const quality = await this.pythonOcr.analyzeQuality(originalUrl);
    const minQuality = Number(await this.settings.resolve('prescriptions.ocr.quality_minimum'));
    if (quality.qualityScore < minQuality) {
      await this.prisma.prescriptionPage.update({
        where: { id: pageId },
        data: {
          imageQualityScore: quality.qualityScore,
          processingStatus: 'IMAGE_REUPLOAD_REQUIRED',
        },
      });
      await this.timeline.record({
        entityType: 'prescription_page',
        entityId: pageId,
        eventType: 'image_reupload_required',
        payload: { qualityScore: quality.qualityScore, issues: quality.issues },
      });
      await this.finalizePrescriptionIfDone(page.prescriptionId);
      return;
    }
    await this.prisma.prescriptionPage.update({
      where: { id: pageId },
      data: { imageQualityScore: quality.qualityScore },
    });

    // ── Stage: preprocess ──────────────────────────────────────────────
    await this.prisma.prescriptionPage.update({
      where: { id: pageId },
      data: { processingStatus: 'PREPROCESSING' },
    });
    const pre = await this.pythonOcr.preprocess(originalUrl);
    await this.prisma.prescriptionPage.update({
      where: { id: pageId },
      data: { orientation: pre.orientation },
    });

    // ── Stage: detect + recognize ───────────────────────────────────────
    await this.prisma.prescriptionPage.update({
      where: { id: pageId },
      data: { processingStatus: 'EXTRACTING_TEXT' },
    });
    const recognized = await this.pythonOcr.detectAndRecognize(originalUrl);
    await this.prisma.$transaction(async (tx) => {
      await tx.oCRTextBlock.deleteMany({ where: { prescriptionPageId: pageId } });
      if (recognized.blocks.length) {
        await tx.oCRTextBlock.createMany({
          data: recognized.blocks.map((b) => ({
            prescriptionPageId: pageId,
            rawText: b.rawText,
            normalizedText: b.normalizedText,
            boundingBox: b.boundingBox,
            language: b.language,
            ocrConfidence: b.confidence,
            lineNumber: b.lineNumber,
          })),
        });
      }
    });
    if (recognized.detectedLanguage) {
      await this.prisma.prescription.update({
        where: { id: page.prescriptionId },
        data: { detectedLanguage: recognized.detectedLanguage },
      });
    }

    // ── Stage: medicine-line / candidate detection ──────────────────────
    await this.prisma.prescriptionPage.update({
      where: { id: pageId },
      data: { processingStatus: 'DETECTING_CANDIDATES' },
    });
    const blocks = await this.prisma.oCRTextBlock.findMany({
      where: { prescriptionPageId: pageId },
      orderBy: { lineNumber: 'asc' },
    });
    if (blocks.length) {
      const candidates = await this.pythonOcr.detectCandidates(
        blocks.map((b) => ({
          rawText: b.rawText,
          normalizedText: b.normalizedText ?? b.rawText,
          boundingBox: (b.boundingBox as Record<string, number>) ?? {},
          language: b.language ?? 'en',
          confidence: b.ocrConfidence ?? 0,
          lineNumber: b.lineNumber,
        })),
      );
      for (const line of candidates.candidateLines) {
        const block = blocks[line.blockIndex];
        if (!block) continue;
        await this.prisma.oCRTextBlock.update({
          where: { id: block.id },
          data: { isMedicineLine: true },
        });
        // No matching engine yet (Sprint OCR-05/06) — every candidate the
        // pipeline creates is unmatched and defaults to
        // NEEDS_PHARMACIST_REVIEW; this is the safety rule, not a gap:
        // nothing is ever auto-confirmed without a matcher to back it.
        await this.prisma.prescriptionDrugCandidate.create({
          data: {
            prescriptionId: page.prescriptionId,
            ocrTextBlockId: block.id,
            extractedDrugText: line.extractedDrugText,
            extractedStrength: line.extractedStrength ?? null,
            extractedDosageForm: line.extractedDosageForm ?? null,
          },
        });
      }
    }

    await this.prisma.prescriptionPage.update({
      where: { id: pageId },
      data: { processingStatus: 'COMPLETED' },
    });
    await this.timeline.record({
      entityType: 'prescription_page',
      entityId: pageId,
      eventType: 'processing_completed',
      payload: { blocks: blocks.length, provider: recognized.providerUsed },
    });
    await this.finalizePrescriptionIfDone(page.prescriptionId);
  }

  private async markPageFailed(pageId: string, error: string) {
    const page = await this.prisma.prescriptionPage.update({
      where: { id: pageId },
      data: { processingStatus: 'FAILED', processingError: error.slice(0, 1000) },
    });
    await this.timeline.record({
      entityType: 'prescription_page',
      entityId: pageId,
      eventType: 'processing_failed',
      payload: { error },
    });
    await this.finalizePrescriptionIfDone(page.prescriptionId);
  }

  /** Rolls the prescription from EXTRACTING to REVIEW once every page has
   *  reached a terminal state — atomic via the WHERE guard, so a race
   *  between sibling pages' jobs finalizes exactly once (design spec §3,
   *  §8.2: any outcome — success, reupload, or failure — always surfaces
   *  to a human, never silently vanishes). */
  private async finalizePrescriptionIfDone(prescriptionId: string) {
    const pages = await this.prisma.prescriptionPage.findMany({
      where: { prescriptionId },
      select: { processingStatus: true },
    });
    const terminal = new Set(['COMPLETED', 'IMAGE_REUPLOAD_REQUIRED', 'FAILED']);
    if (pages.length === 0 || !pages.every((p) => terminal.has(p.processingStatus))) return;

    const result = await this.prisma.prescription.updateMany({
      where: { id: prescriptionId, status: 'EXTRACTING' },
      data: { status: 'REVIEW', completedAt: new Date() },
    });
    if (result.count === 0) return; // already finalized by a sibling page

    const rx = await this.prisma.prescription.findUniqueOrThrow({ where: { id: prescriptionId } });
    await this.timeline.record({
      entityType: 'prescription',
      entityId: prescriptionId,
      eventType: 'pipeline_completed',
    });
    await this.notifications.notify({
      userId: rx.uploadedById,
      type: 'prescription.ready_for_review',
      titleAr: `الوصفة ${rx.number} جاهزة للمراجعة`,
      titleEn: `Prescription ${rx.number} is ready for review`,
      payload: { entityType: 'prescription', entityId: prescriptionId },
    });
  }
}
