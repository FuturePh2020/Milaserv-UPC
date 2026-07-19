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
import type { PagePreprocessResult } from '../python-ocr-client.service';
import { PreprocessingConfigService } from '../preprocessing-config.service';
import { PRESCRIPTION_STORAGE } from '../storage/prescription-storage';
import type { PrescriptionStorageDriver } from '../storage/prescription-storage';
import { newPrescriptionStorageKey } from '../storage/prescription-storage';
import { PRESCRIPTION_QUEUE_REDIS } from './queue-redis.provider';
import { PRESCRIPTION_OCR_QUEUE_NAME } from './prescription-ocr.queue';
import type { PrescriptionOcrJobData } from './prescription-ocr.queue';

const SIGNED_URL_TTL_SECONDS = 300;

/** PrescriptionPageImageVersion.versionType values this worker writes,
 * in storage order — ORIGINAL is registered once up front, the rest come
 * back (optionally) from the Sprint OCR-02 preprocessing engine. */
const VERSION_KEYS = ['ROTATED', 'CROPPED', 'ENHANCED', 'OCR_READY'] as const;

/**
 * The BullMQ consumer for `prescription-ocr` (design spec §3 stages 3–15).
 * quality gate (Sprint OCR-01, unchanged) → preprocess (Sprint OCR-02's
 * real 18-step image-processing & quality engine — versions + metrics
 * persisted, IMAGE_REUPLOAD_REQUIRED if the score is below threshold) →
 * detect-and-recognize (still Sprint OCR-01's mock — no real OCR text
 * recognition ships until Sprint OCR-03) → persist OCRTextBlock rows →
 * detect-candidates → persist PrescriptionDrugCandidate rows, every one
 * defaulting to NEEDS_PHARMACIST_REVIEW since no real matching engine
 * exists yet (that's Sprint OCR-05/06).
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
    private readonly preprocessingConfig: PreprocessingConfigService,
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

    // Sprint OCR-02: register the original as version 0 — never
    // overwritten by anything the preprocessing engine produces below.
    await this.prisma.prescriptionPageImageVersion.upsert({
      where: {
        prescriptionPageId_versionType_sourcePageIndex: {
          prescriptionPageId: pageId,
          versionType: 'ORIGINAL',
          sourcePageIndex: 0,
        },
      },
      update: {},
      create: {
        prescriptionPageId: pageId,
        versionType: 'ORIGINAL',
        storageKey: page.originalStorageKey,
      },
    });

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

    // ── Stage: preprocess (CR-001 Sprint OCR-02 — 18-step image-
    // processing & quality engine). No OCR text recognition happens
    // here; that stays in the (still-mocked) stage below, unchanged. ──
    const preprocessingStartedAt = new Date();
    await this.prisma.prescriptionPage.update({
      where: { id: pageId },
      data: { processingStatus: 'PREPROCESSING', preprocessingStartedAt },
    });
    const config = await this.preprocessingConfig.resolve();
    const pre = await this.pythonOcr.preprocess(originalUrl, config);
    await this.storeImageVersions(pageId, pre);

    const preprocessingCompletedAt = new Date();
    await this.prisma.prescriptionPage.update({
      where: { id: pageId },
      data: {
        orientation: Math.round(pre.metrics.rotationAngle),
        rotationAngle: pre.metrics.rotationAngle,
        blurScore: pre.metrics.blurScore,
        brightnessScore: pre.metrics.brightnessScore,
        contrastScore: pre.metrics.contrastScore,
        noiseScore: pre.metrics.noiseScore,
        cropConfidence: pre.metrics.cropConfidence,
        finalQualityScore: pre.qualityScore,
        qualityStatus: pre.qualityStatus,
        preprocessingVersion: config.version,
        preprocessingDuration: pre.processingDurationMs,
        preprocessingCompletedAt,
      },
    });
    this.logger.log(
      `page ${pageId} preprocessed in ${pre.processingDurationMs}ms — ` +
        `quality ${pre.qualityScore}/100 (${pre.qualityStatus}), ` +
        `stages=[${pre.stagesApplied.join(',')}]` +
        (pre.processorFailures.length ? `, failures=[${pre.processorFailures.join(';')}]` : ''),
    );
    if (pre.processorFailures.length) {
      await this.timeline.record({
        entityType: 'prescription_page',
        entityId: pageId,
        eventType: 'preprocessing_processor_failures',
        payload: { failures: pre.processorFailures },
      });
    }

    if (pre.qualityStatus === 'REUPLOAD_REQUIRED') {
      await this.prisma.prescriptionPage.update({
        where: { id: pageId },
        data: { processingStatus: 'IMAGE_REUPLOAD_REQUIRED' },
      });
      await this.timeline.record({
        entityType: 'prescription_page',
        entityId: pageId,
        eventType: 'image_reupload_required',
        payload: {
          qualityScore: pre.qualityScore,
          qualityStatus: pre.qualityStatus,
          source: 'preprocessing_engine',
        },
      });
      await this.finalizePrescriptionIfDone(page.prescriptionId);
      return;
    }

    // Transient — the design spec's "READY FOR OCR" workflow state,
    // between PREPROCESSING and Sprint OCR-01's (still-mocked) text
    // extraction stage.
    await this.prisma.prescriptionPage.update({
      where: { id: pageId },
      data: { processingStatus: 'READY_FOR_OCR' },
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

  /** Sprint OCR-02 — writes each version the preprocessing engine
   *  returned to storage and records it, never touching the ORIGINAL row
   *  registered before the pipeline ran. Idempotent under BullMQ retries
   *  via the (pageId, versionType, sourcePageIndex) unique constraint. */
  private async storeImageVersions(pageId: string, pre: PagePreprocessResult): Promise<void> {
    for (const key of VERSION_KEYS) {
      const version = pre.versions[key];
      if (!version) continue;
      const buffer = Buffer.from(version.imageBase64, 'base64');
      const storageKey = newPrescriptionStorageKey(`${pageId}-${key.toLowerCase()}.png`);
      await this.storage.put(storageKey, buffer, 'image/png');
      await this.prisma.prescriptionPageImageVersion.upsert({
        where: {
          prescriptionPageId_versionType_sourcePageIndex: {
            prescriptionPageId: pageId,
            versionType: key,
            sourcePageIndex: 0,
          },
        },
        update: { storageKey, width: version.width, height: version.height },
        create: {
          prescriptionPageId: pageId,
          versionType: key,
          storageKey,
          width: version.width,
          height: version.height,
        },
      });
      if (key === 'ENHANCED') {
        await this.prisma.prescriptionPage.update({
          where: { id: pageId },
          data: { enhancedStorageKey: storageKey },
        });
      }
    }
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
