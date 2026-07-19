import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import type { Prisma, PrescriptionOcrRun } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type { Env } from '../../../core/config/env';
import { ENV } from '../../../core/config/config.module';
import { SettingsService } from '../../settings/settings.service';
import { TimelineService } from '../../timeline/timeline.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PythonOcrClientService } from '../python-ocr-client.service';
import type { PagePreprocessResult } from '../python-ocr-client.service';
import { PreprocessingConfigService } from '../preprocessing-config.service';
import { OcrConfigService } from '../ocr-config.service';
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

/** Preference order for the image OCR actually runs against — the
 * OCR-ready version if the preprocessing engine produced one, falling
 * back through progressively less-processed versions, and only down to
 * the raw original if nothing else exists (design brief: "use Phase 2's
 * OCR-ready images, not originals, unless an intentional fallback"). */
const OCR_IMAGE_PRIORITY = ['OCR_READY', 'ENHANCED', 'CROPPED', 'ROTATED'] as const;

interface OcrRunOutcome {
  run: PrescriptionOcrRun;
  blockCount: number;
  pageConfidence: number;
  requiresOcrReview: boolean;
}

/**
 * The BullMQ consumer for `prescription-ocr` (design spec §3 stages 3–15).
 * quality gate (Sprint OCR-01, unchanged) → preprocess (Sprint OCR-02's
 * real 18-step image-processing & quality engine — versions + metrics
 * persisted, IMAGE_REUPLOAD_REQUIRED if the score is below threshold) →
 * detect-and-recognize (Sprint OCR-03 — real PaddleOCR-backed text
 * recognition against the OCR-ready image, run-history-tracked via
 * PrescriptionOcrRun; never overwrites a prior run's OCRTextBlock rows) →
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
    private readonly ocrConfig: OcrConfigService,
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
    // Defensive: a page still awaiting manual crop confirmation should
    // never have been enqueued (submit()/confirmCrop() gate this) — if
    // it was anyway, don't run the pipeline against un-cropped chrome.
    if (page.manualCropRequired) {
      this.logger.warn(`page ${pageId} was queued while still awaiting manual crop — skipping`);
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
    // CR-001 Sprint OCR-02 Extension — a confirmed region/manual crop
    // (design doc: "Prescription Region Detector") is applied before the
    // 18-step pipeline runs, so screenshot chrome never reaches OCR.
    const cropBox = page.manualCropJson as {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
    const pre = await this.pythonOcr.preprocess(originalUrl, config, cropBox);
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

    // ── Stage: detect + recognize (CR-001 Sprint OCR-03 — real PaddleOCR-
    // backed recognition, run against the best available OCR-ready image,
    // never the raw original unless nothing else was produced). ──
    await this.prisma.prescriptionPage.update({
      where: { id: pageId },
      data: { processingStatus: 'EXTRACTING_TEXT' },
    });
    const ocrImageUrl = await this.resolveOcrImageUrl(pageId, originalUrl);
    const ocrOutcome = await this.runOcrPipeline(
      pageId,
      page.prescriptionId,
      ocrImageUrl,
      'initial',
      null,
    );

    // ── Stage: medicine-line / candidate detection ──────────────────────
    await this.prisma.prescriptionPage.update({
      where: { id: pageId },
      data: { processingStatus: 'DETECTING_CANDIDATES' },
    });
    // Scoped to this run's own blocks — reprocessing never deletes prior
    // runs' rows, so an unscoped findMany would mix runs together.
    const blocks = await this.prisma.oCRTextBlock.findMany({
      where: { prescriptionPageId: pageId, ocrRunId: ocrOutcome.run.id },
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
      payload: {
        blocks: blocks.length,
        provider: ocrOutcome.run.providerName,
        requiresOcrReview: ocrOutcome.requiresOcrReview,
      },
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

  /** CR-001 Sprint OCR-03 — the OCR-ready image's signed URL, falling
   *  back through progressively less-processed versions and only down to
   *  `originalUrl` (already signed by the caller) if the preprocessing
   *  engine produced nothing usable. */
  private async resolveOcrImageUrl(pageId: string, originalUrl: string): Promise<string> {
    const versions = await this.prisma.prescriptionPageImageVersion.findMany({
      where: { prescriptionPageId: pageId },
    });
    const byType = new Map(versions.map((v) => [v.versionType, v]));
    for (const type of OCR_IMAGE_PRIORITY) {
      const v = byType.get(type);
      if (v) return this.storage.getSignedUrl(v.storageKey, SIGNED_URL_TTL_SECONDS);
    }
    return originalUrl;
  }

  /** CR-001 Sprint OCR-03 — runs one OCR pass against `imageUrl` and
   *  persists it as a new, immutable PrescriptionOcrRun with its own
   *  OCRTextBlock rows (design doc §16: "never silently overwrite
   *  previous OCR runs"). Shared by the automatic pipeline (`trigger:
   *  "initial"`) and the manual re-run endpoint (`trigger:
   *  "manual_rerun"`) so both go through identical persistence. On a real
   *  provider/service failure the run is recorded FAILED and the error is
   *  rethrown — the caller decides what that means for the surrounding
   *  pipeline (BullMQ retry for the automatic path; a clean HTTP error
   *  for a manual re-run). */
  private async runOcrPipeline(
    pageId: string,
    prescriptionId: string,
    imageUrl: string,
    trigger: 'initial' | 'manual_rerun',
    requestedById: string | null,
  ): Promise<OcrRunOutcome> {
    const config = await this.ocrConfig.resolve();
    const runNumber =
      (await this.prisma.prescriptionOcrRun.count({ where: { prescriptionPageId: pageId } })) + 1;
    const run = await this.prisma.prescriptionOcrRun.create({
      data: {
        prescriptionPageId: pageId,
        runNumber,
        providerName: config.provider || 'auto',
        trigger,
        settingsSnapshotJson: config as unknown as Prisma.InputJsonValue,
        status: 'RUNNING',
        requestedById: requestedById ?? undefined,
      },
    });
    const startedAt = new Date();

    let recognized: Awaited<ReturnType<PythonOcrClientService['detectAndRecognize']>>;
    try {
      recognized = await this.pythonOcr.detectAndRecognize(imageUrl, config.provider || undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.prescriptionOcrRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          failureCode: 'OCR_SERVICE_ERROR',
          failureReason: message.slice(0, 1000),
        },
      });
      await this.prisma.prescriptionPage.update({
        where: { id: pageId },
        data: { ocrFailureCode: 'OCR_SERVICE_ERROR', ocrFailureReason: message.slice(0, 1000) },
      });
      await this.timeline.record({
        entityType: 'prescription_page',
        entityId: pageId,
        eventType: 'ocr_run_failed',
        payload: { runNumber, trigger, error: message },
      });
      throw err;
    }

    // Best-effort model metadata for the audit trail (design doc §16
    // "run number/provider/model/settings-snapshot") — never allowed to
    // fail the run itself; a probe outage just leaves modelInfoJson null.
    let modelInfoJson: Record<string, unknown> | null = null;
    try {
      const status = await this.pythonOcr.getProviderStatus(recognized.providerUsed);
      modelInfoJson = { models: status.models ?? {}, device: status.device ?? null };
    } catch (err) {
      this.logger.warn(
        `could not fetch provider status for ${recognized.providerUsed}: ${String(err)}`,
      );
    }

    if (recognized.blocks.length) {
      await this.prisma.oCRTextBlock.createMany({
        data: recognized.blocks.map((b) => ({
          prescriptionPageId: pageId,
          ocrRunId: run.id,
          rawText: b.rawText,
          normalizedText: b.normalizedText,
          boundingBox: b.boundingBox,
          language: b.language,
          ocrConfidence: b.confidence,
          lineNumber: b.lineNumber,
          blockIndex: b.blockIndex ?? 0,
          boundingPolygonJson: (b.boundingPolygon ?? undefined) as
            Prisma.InputJsonValue | undefined,
          detectedScript: b.script ?? null,
          textDirection: b.direction ?? null,
          recognitionCandidatesJson: (b.recognitionCandidates ?? undefined) as
            Prisma.InputJsonValue | undefined,
          providerName: recognized.providerUsed,
          modelName: b.script
            ? (modelInfoJson?.models as Record<string, string>)?.[b.script]
            : null,
        })),
      });
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const pageConfidence = recognized.blocks.length
      ? Math.round(
          (recognized.blocks.reduce((sum, b) => sum + b.confidence, 0) / recognized.blocks.length) *
            100,
        )
      : 0;
    const requiresOcrReview =
      recognized.blocks.length === 0 || pageConfidence < config.reviewConfidenceThreshold;

    const updatedRun = await this.prisma.prescriptionOcrRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        completedAt,
        durationMs,
        blockCount: recognized.blocks.length,
        pageConfidence,
        modelInfoJson: (modelInfoJson ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    const sortedByLine = [...recognized.blocks].sort((a, b) => a.lineNumber - b.lineNumber);
    await this.prisma.prescriptionPage.update({
      where: { id: pageId },
      data: {
        currentOcrRunId: run.id,
        ocrProviderName: recognized.providerUsed,
        ocrModelInfoJson: (modelInfoJson ?? undefined) as Prisma.InputJsonValue | undefined,
        ocrStartedAt: startedAt,
        ocrCompletedAt: completedAt,
        ocrDurationMs: durationMs,
        ocrBlockCount: recognized.blocks.length,
        ocrPageConfidence: pageConfidence,
        rawPageText: sortedByLine.map((b) => b.rawText).join('\n'),
        normalizedPageText: sortedByLine.map((b) => b.normalizedText).join('\n'),
        requiresOcrReview,
        ocrFailureCode: null,
        ocrFailureReason: null,
      },
    });
    if (recognized.detectedLanguage) {
      await this.prisma.prescription.update({
        where: { id: prescriptionId },
        data: { detectedLanguage: recognized.detectedLanguage },
      });
    }
    await this.timeline.record({
      entityType: 'prescription_page',
      entityId: pageId,
      eventType: 'ocr_run_completed',
      payload: {
        runNumber,
        trigger,
        provider: recognized.providerUsed,
        blockCount: recognized.blocks.length,
        pageConfidence,
        requiresOcrReview,
      },
    });

    return {
      run: updatedRun,
      blockCount: recognized.blocks.length,
      pageConfidence,
      requiresOcrReview,
    };
  }

  /** CR-001 Sprint OCR-03 — manual re-run entry point (design doc §16),
   *  called from PrescriptionsService's `POST .../rerun-ocr` endpoint.
   *  Public so the controller path never has to reach into BullMQ for
   *  something that's meant to run synchronously, mirroring how
   *  confirmCrop()/submit() already call finalizePrescriptionIfDone()
   *  directly. Requires the page to have already gone through
   *  preprocessing at least once (there is otherwise no image to run OCR
   *  against). */
  async rerunOcr(pageId: string, requestedById: string): Promise<OcrRunOutcome> {
    const page = await this.prisma.prescriptionPage.findUnique({ where: { id: pageId } });
    if (!page) throw new Error(`Prescription page ${pageId} not found`);
    const originalUrl = await this.storage.getSignedUrl(
      page.originalStorageKey,
      SIGNED_URL_TTL_SECONDS,
    );
    const imageUrl = await this.resolveOcrImageUrl(pageId, originalUrl);
    return this.runOcrPipeline(
      pageId,
      page.prescriptionId,
      imageUrl,
      'manual_rerun',
      requestedById,
    );
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
   *  either reached a terminal state OR is still waiting on a human to
   *  confirm its crop — atomic via the WHERE guard, so a race between
   *  sibling pages' jobs finalizes exactly once (design spec §3, §8.2:
   *  any outcome — success, reupload, or failure — always surfaces to a
   *  human, never silently vanishes). A page awaiting manual crop counts
   *  as "resolved for now": REVIEW is exactly where a reviewer would go
   *  to confirm that crop anyway, and once confirmed+enqueued its own
   *  completion re-runs this check (public — also called directly from
   *  PrescriptionsService.submit()/confirmCrop() for the edge case where
   *  every page needs manual crop and no worker job ever runs). */
  async finalizePrescriptionIfDone(prescriptionId: string) {
    const pages = await this.prisma.prescriptionPage.findMany({
      where: { prescriptionId },
      select: { processingStatus: true, manualCropRequired: true },
    });
    const terminal = new Set(['COMPLETED', 'IMAGE_REUPLOAD_REQUIRED', 'FAILED']);
    const resolved = (p: (typeof pages)[number]) =>
      terminal.has(p.processingStatus) || p.manualCropRequired;
    if (pages.length === 0 || !pages.every(resolved)) return;

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
