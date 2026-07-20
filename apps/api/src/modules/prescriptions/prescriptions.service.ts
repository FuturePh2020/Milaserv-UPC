import { createHash } from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import { NumberingService } from '../numbering/numbering.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { RequestScope } from '../permissions/scope';
import { PrescriptionOcrQueueService } from './queue/prescription-ocr.queue';
import { PrescriptionOcrWorkerService } from './queue/prescription-ocr.worker';
import { DrugMatchingEngine } from './matching/drug-matching.engine';
import { PythonOcrClientService } from './python-ocr-client.service';
import type { DetectRegionResult, PrescriptionSourceType } from './python-ocr-client.service';
import { RegionDetectionConfigService } from './region-detection-config.service';
import { PRESCRIPTION_STORAGE } from './storage/prescription-storage';
import type { PrescriptionStorageDriver } from './storage/prescription-storage';
import { newPrescriptionStorageKey } from './storage/prescription-storage';
import { validatePrescriptionFile } from './file-validation';
import type {
  ConfirmCropDto,
  CorrectOcrBlockDto,
  CreatePrescriptionDto,
  ListPrescriptionsQueryDto,
  UploadPageDto,
} from './prescriptions.dto';

interface UploadedFileShape {
  originalname: string;
  buffer: Buffer;
}

const REGION_DETECTION_SIGNED_URL_TTL_SECONDS = 300;
const MAX_PAGE_NUMBER_ATTEMPTS = 5;

/**
 * CR-001 Prescription Intelligence Engine — Sprint OCR-01
 * (docs/change-requests/CR-001-prescription-intelligence-engine.md).
 * Owns everything NestJS is responsible for per the design's service
 * boundaries (§2): auth/authz sit in the guards, this service handles
 * file registration, workflow, and user-facing responses. The actual
 * pixel/text pipeline runs in the Python service via the BullMQ worker.
 */
@Injectable()
export class PrescriptionsService {
  private readonly logger = new Logger(PrescriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly queue: PrescriptionOcrQueueService,
    private readonly worker: PrescriptionOcrWorkerService,
    private readonly drugMatchingEngine: DrugMatchingEngine,
    private readonly pythonOcr: PythonOcrClientService,
    private readonly regionDetectionConfig: RegionDetectionConfigService,
    @Inject(PRESCRIPTION_STORAGE) private readonly storage: PrescriptionStorageDriver,
  ) {}

  async config() {
    const [maxSizeMb, allowedMime] = await Promise.all([
      this.settings.resolve('prescriptions.upload.max_size_mb').then(Number),
      this.settings.resolve('prescriptions.upload.allowed_mime'),
    ]);
    return { maxSizeMb, allowedMime: allowedMime as string[] };
  }

  async create(actor: AuthUser, dto: CreatePrescriptionDto, meta: { ip?: string }) {
    const number = await this.numbering.next('ocr.number.format', 'prescription');
    const rx = await this.prisma.prescription.create({
      data: {
        number,
        uploadedById: actor.userId,
        note: dto.note ?? null,
        source: dto.source ?? null,
      },
    });
    await this.timeline.record({
      entityType: 'prescription',
      entityId: rx.id,
      eventType: 'created',
      actorId: actor.userId,
      payload: { number, engine: 'cr001' },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'prescriptions.create',
      entityType: 'prescription',
      entityId: rx.id,
      after: { number },
      ...meta,
    });
    return rx;
  }

  /** CR-001 Sprint OCR-02 Extension — never lets a region-detection
   *  outage block an upload; on any failure the safe default is to defer
   *  to a human (manualCropRequired: true), same fail-open-to-review
   *  posture as the rest of this pipeline. */
  private async detectRegionSafely(signedUrl: string): Promise<DetectRegionResult> {
    try {
      const config = await this.regionDetectionConfig.resolve();
      if (!config.enabled) {
        return {
          sourceTypeHint: 'UNKNOWN',
          screenshotDetected: false,
          screenshotConfidence: 0,
          screenshotApplicationHint: null,
          originalWidth: 0,
          originalHeight: 0,
          regions: [],
          bestRegionIndex: null,
          manualCropRequired: true,
        };
      }
      return await this.pythonOcr.detectRegion(signedUrl, config);
    } catch (err) {
      this.logger.warn(`region detection failed, deferring to manual crop: ${String(err)}`);
      return {
        sourceTypeHint: 'UNKNOWN',
        screenshotDetected: false,
        screenshotConfidence: 0,
        screenshotApplicationHint: null,
        originalWidth: 0,
        originalHeight: 0,
        regions: [],
        bestRegionIndex: null,
        manualCropRequired: true,
      };
    }
  }

  /** DropZone fires one upload request per file in parallel (design doc:
   *  "drop multiple files") — concurrent calls for the same prescription
   *  race on "what's the next pageNumber", so a plain read-then-create
   *  can lose to a sibling request and hit the (prescriptionId,
   *  pageNumber) unique constraint. Retries with a fresh read on exactly
   *  that collision instead of failing the whole upload. */
  private async createPageWithNextNumber(
    prescriptionId: string,
    data: Omit<Prisma.PrescriptionPageUncheckedCreateInput, 'prescriptionId' | 'pageNumber'>,
  ) {
    for (let attempt = 1; ; attempt++) {
      const lastPage = await this.prisma.prescriptionPage.findFirst({
        where: { prescriptionId },
        orderBy: { pageNumber: 'desc' },
        select: { pageNumber: true },
      });
      const pageNumber = (lastPage?.pageNumber ?? 0) + 1;
      try {
        return await this.prisma.prescriptionPage.create({
          data: { ...data, prescriptionId, pageNumber },
        });
      } catch (err) {
        const isPageNumberConflict =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          (err.meta?.target as string[] | undefined)?.includes('pageNumber');
        if (!isPageNumberConflict || attempt >= MAX_PAGE_NUMBER_ATTEMPTS) throw err;
      }
    }
  }

  async uploadPage(
    actor: AuthUser,
    prescriptionId: string,
    file: UploadedFileShape,
    dto: UploadPageDto,
    meta: { ip?: string },
  ) {
    const rx = await this.prisma.prescription.findUnique({ where: { id: prescriptionId } });
    if (!rx) throw new NotFoundException('Prescription not found');
    if (rx.status !== 'UPLOADED') {
      throw new UnprocessableEntityException(
        `Cannot add pages to a prescription that is ${rx.status.toLowerCase()}`,
      );
    }

    const [maxSizeMb, allowedMime] = await Promise.all([
      this.settings.resolve('prescriptions.upload.max_size_mb').then(Number),
      this.settings.resolve('prescriptions.upload.allowed_mime') as Promise<string[]>,
    ]);
    const validation = validatePrescriptionFile({
      buffer: file.buffer,
      maxSizeMb,
      allowedMime,
    });
    if (!validation.ok) throw new BadRequestException(validation.reason);

    const contentHash = createHash('sha256').update(file.buffer).digest('hex');
    // Flagged, never silently deduplicated (design spec §11) — the caller
    // decides what to do with this hint.
    const duplicate = await this.prisma.prescriptionPage.findFirst({
      where: { contentHash, prescriptionId: { not: prescriptionId } },
      orderBy: { createdAt: 'desc' },
      select: { prescriptionId: true },
    });

    const storageKey = newPrescriptionStorageKey(file.originalname);
    await this.storage.put(storageKey, file.buffer, validation.detectedMime);

    // CR-001 Sprint OCR-02 Extension — Universal Image Intake: find the
    // probable prescription region before anything else runs (design
    // doc: "Backend Upload Flow" steps 5-8), synchronously, so the
    // response can already tell the caller whether a manual crop will be
    // needed.
    const signedUrl = await this.storage.getSignedUrl(
      storageKey,
      REGION_DETECTION_SIGNED_URL_TTL_SECONDS,
    );
    const detection = await this.detectRegionSafely(signedUrl);
    const bestRegion =
      detection.bestRegionIndex !== null ? detection.regions[detection.bestRegionIndex] : null;
    // Auto-accepted only when a confident best region exists — otherwise
    // the page waits at manualCropRequired until a human confirms
    // (design doc: "Low-confidence crops require manual confirmation").
    const autoAcceptedCropBox =
      bestRegion && !detection.manualCropRequired
        ? { x: bestRegion.x, y: bestRegion.y, width: bestRegion.width, height: bestRegion.height }
        : null;

    const page = await this.createPageWithNextNumber(prescriptionId, {
      originalStorageKey: storageKey,
      contentHash,
      sourceType: detection.sourceTypeHint as PrescriptionSourceType,
      screenshotDetected: detection.screenshotDetected,
      screenshotApplicationHint: detection.screenshotApplicationHint,
      detectedDocumentRegionJson: (bestRegion ?? undefined) as Prisma.InputJsonValue | undefined,
      regionDetectionConfidence: bestRegion?.confidence ?? null,
      manualCropRequired: detection.manualCropRequired,
      manualCropJson: (autoAcceptedCropBox ?? undefined) as Prisma.InputJsonValue | undefined,
      clipboardPasted: dto.clipboardPasted ?? false,
      originalWidth: detection.originalWidth || null,
      originalHeight: detection.originalHeight || null,
      selectedRegionIndex: autoAcceptedCropBox ? detection.bestRegionIndex : null,
      regions: detection.regions.length
        ? {
            create: detection.regions.map((r) => ({
              regionIndex: r.regionIndex,
              boundingBoxJson: { x: r.x, y: r.y, width: r.width, height: r.height },
              confidence: r.confidence,
              regionType: r.regionType,
              selected: r.regionIndex === detection.bestRegionIndex && !!autoAcceptedCropBox,
            })),
          }
        : undefined,
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'prescriptions.upload_page',
      entityType: 'prescription_page',
      entityId: page.id,
      after: {
        prescriptionId,
        pageNumber: page.pageNumber,
        detectedMime: validation.detectedMime,
        sourceType: detection.sourceTypeHint,
        screenshotDetected: detection.screenshotDetected,
        manualCropRequired: detection.manualCropRequired,
        regionCount: detection.regions.length,
      },
      ...meta,
    });
    return {
      id: page.id,
      pageNumber: page.pageNumber,
      possibleDuplicateOfPrescriptionId: duplicate?.prescriptionId ?? null,
      sourceType: detection.sourceTypeHint,
      screenshotDetected: detection.screenshotDetected,
      screenshotApplicationHint: detection.screenshotApplicationHint,
      manualCropRequired: detection.manualCropRequired,
      regionCount: detection.regions.length,
    };
  }

  async submit(actor: AuthUser, prescriptionId: string, meta: { ip?: string }) {
    const rx = await this.prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: { pages: true },
    });
    if (!rx) throw new NotFoundException('Prescription not found');
    if (rx.status !== 'UPLOADED') {
      throw new UnprocessableEntityException(`Prescription is ${rx.status.toLowerCase()}`);
    }
    if (rx.pages.length === 0) {
      throw new BadRequestException('Attach at least one page before submitting');
    }

    const updated = await this.prisma.prescription.update({
      where: { id: prescriptionId },
      data: { status: 'EXTRACTING' },
    });
    // CR-001 Sprint OCR-02 Extension — pages still awaiting manual crop
    // confirmation are left un-queued; confirmCrop() enqueues them
    // individually once a human resolves the crop.
    const readyPages = rx.pages.filter((p) => !p.manualCropRequired);
    for (const page of readyPages) {
      await this.queue.enqueuePage(page.id);
    }
    await this.timeline.record({
      entityType: 'prescription',
      entityId: prescriptionId,
      eventType: 'submitted',
      actorId: actor.userId,
      payload: { pages: rx.pages.length, queued: readyPages.length },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'prescriptions.submit',
      entityType: 'prescription',
      entityId: prescriptionId,
      after: { pages: rx.pages.length },
      ...meta,
    });
    // Edge case: every page needs manual crop, so no worker job will
    // ever run to trigger finalization — check right away instead of
    // leaving the prescription stuck in EXTRACTING forever.
    await this.worker.finalizePrescriptionIfDone(prescriptionId);
    return updated;
  }

  private async scopeFilter(scope: RequestScope): Promise<Prisma.PrescriptionWhereInput> {
    const self = scope.context.userId;
    switch (scope.scope) {
      case 'ALL_DATA':
      case 'BRANCH':
      case 'PARTNER':
        return {};
      case 'DEPARTMENT': {
        if (!scope.context.departmentId) return { uploadedById: self };
        const users = await this.prisma.user.findMany({
          where: { departmentId: scope.context.departmentId },
          select: { id: true },
        });
        return { uploadedById: { in: [...users.map((u) => u.id), self] } };
      }
      case 'MULTIPLE_TEAMS':
      case 'MY_TEAM': {
        const teamIds =
          scope.scope === 'MULTIPLE_TEAMS' ? (scope.teamIds ?? []) : scope.context.teamIds;
        const users = await this.prisma.user.findMany({
          where: { teams: { some: { teamId: { in: teamIds } } } },
          select: { id: true },
        });
        return { uploadedById: { in: [...users.map((u) => u.id), self] } };
      }
      default:
        return { uploadedById: self };
    }
  }

  async list(scope: RequestScope, q: ListPrescriptionsQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where: Prisma.PrescriptionWhereInput = {
      ...(await this.scopeFilter(scope)),
      ...(q.status ? { status: q.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.prescription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { pages: true, drugCandidates: true } },
        },
      }),
      this.prisma.prescription.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(id: string) {
    const rx = await this.prisma.prescription.findUnique({
      where: { id },
      include: {
        pages: {
          orderBy: { pageNumber: 'asc' },
          include: {
            textBlocks: { orderBy: { lineNumber: 'asc' } },
            regions: { orderBy: { regionIndex: 'asc' } },
          },
        },
        drugCandidates: {
          orderBy: { createdAt: 'asc' },
          include: {
            matchedDrug: {
              select: {
                id: true,
                materialNo: true,
                nameEn: true,
                nameAr: true,
                priceWithTax: true,
              },
            },
          },
        },
      },
    });
    if (!rx) throw new NotFoundException('Prescription not found');
    return rx;
  }

  /** Serves file bytes for a signed local-disk URL (design spec §9). The
   *  caller (controller) has already verified the HMAC + expiry. */
  async readFile(storageKey: string): Promise<Buffer> {
    return this.storage.get(storageKey);
  }

  /** CR-001 Sprint OCR-02 Extension — a signed URL to the raw uploaded
   *  file, straight from originalStorageKey. Distinct from getImages():
   *  a page still awaiting manual crop confirmation is never enqueued, so
   *  the worker never registers its PrescriptionPageImageVersion(ORIGINAL)
   *  row — the crop/preview workspace needs the original before that. */
  async getPageOriginal(id: string, pageId: string) {
    const page = await this.prisma.prescriptionPage.findUnique({ where: { id: pageId } });
    if (!page || page.prescriptionId !== id) {
      throw new NotFoundException('Prescription page not found');
    }
    const url = await this.storage.getSignedUrl(
      page.originalStorageKey,
      REGION_DETECTION_SIGNED_URL_TTL_SECONDS,
    );
    return { pageId, url, width: page.originalWidth, height: page.originalHeight };
  }

  /** CR-001 Sprint OCR-02 Extension — resolves a page's crop, either by
   *  picking one or more detected candidate regions or by a manual
   *  override box (design doc: "Prescription Region Detector" — "Allows
   *  manual correction when automatic detection is uncertain").
   *  Selecting more than one region spawns additional sibling pages, one
   *  per extra region, cropped independently (design doc: "Allow
   *  processing of multiple regions as separate pages"). */
  async confirmCrop(
    actor: AuthUser,
    prescriptionId: string,
    pageId: string,
    dto: ConfirmCropDto,
    meta: { ip?: string },
  ) {
    const hasRegionSelection = !!dto.selectedRegionIndices?.length;
    const hasManualBox = !!dto.manualCropBox;
    if (hasRegionSelection === hasManualBox) {
      throw new BadRequestException(
        'Provide exactly one of selectedRegionIndices or manualCropBox',
      );
    }

    const page = await this.prisma.prescriptionPage.findUnique({
      where: { id: pageId },
      include: { regions: true },
    });
    if (!page || page.prescriptionId !== prescriptionId) {
      throw new NotFoundException('Prescription page not found');
    }
    if (!page.manualCropRequired) {
      throw new UnprocessableEntityException('This page does not require crop confirmation');
    }
    const rx = await this.prisma.prescription.findUniqueOrThrow({
      where: { id: prescriptionId },
    });

    let primaryCropBox: { x: number; y: number; width: number; height: number };
    let primarySelectedRegionIndex: number | null = null;
    const spawnedPageIds: string[] = [];

    if (hasManualBox) {
      primaryCropBox = dto.manualCropBox!;
      await this.prisma.prescriptionPage.update({
        where: { id: pageId },
        data: {
          manualCropJson: primaryCropBox,
          manualCropRequired: false,
          selectedRegionIndex: null,
        },
      });
    } else {
      const regionsByIndex = new Map(page.regions.map((r) => [r.regionIndex, r]));
      const indices = dto.selectedRegionIndices!;
      for (const index of indices) {
        if (!regionsByIndex.has(index)) {
          throw new BadRequestException(`Unknown region index ${index}`);
        }
      }
      // Validated non-empty above (@ArrayNotEmpty on the DTO + the loop
      // that just ran) — TS can't see that, hence the assertion.
      const firstIndex: number = indices[0]!;
      const restIndices = indices.slice(1);
      const firstRegion = regionsByIndex.get(firstIndex)!;
      primaryCropBox = firstRegion.boundingBoxJson as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      primarySelectedRegionIndex = firstIndex;

      await this.prisma.prescriptionPage.update({
        where: { id: pageId },
        data: {
          manualCropJson: primaryCropBox,
          manualCropRequired: false,
          selectedRegionIndex: firstIndex,
        },
      });
      await this.prisma.prescriptionRegion.update({
        where: { id: firstRegion.id },
        data: { selected: true, processingStatus: 'SELECTED' },
      });

      // Every additional selected region becomes its own sibling page,
      // cropped from the same uploaded file — never re-processing the
      // primary page's chosen region twice.
      for (const index of restIndices) {
        const region = regionsByIndex.get(index)!;
        const newPage = await this.createPageWithNextNumber(prescriptionId, {
          originalStorageKey: page.originalStorageKey,
          contentHash: page.contentHash,
          sourceType: page.sourceType,
          screenshotDetected: page.screenshotDetected,
          screenshotApplicationHint: page.screenshotApplicationHint,
          originalWidth: page.originalWidth,
          originalHeight: page.originalHeight,
          manualCropJson: region.boundingBoxJson as Prisma.InputJsonValue,
          manualCropRequired: false,
          selectedRegionIndex: index,
          regionDetectionConfidence: region.confidence,
        });
        await this.prisma.prescriptionRegion.update({
          where: { id: region.id },
          data: { selected: true, processingStatus: 'SPAWNED_PAGE', spawnedPageId: newPage.id },
        });
        spawnedPageIds.push(newPage.id);
      }
    }

    await this.timeline.record({
      entityType: 'prescription_page',
      entityId: pageId,
      eventType: 'crop_confirmed',
      actorId: actor.userId,
      payload: {
        method: hasManualBox ? 'manual' : 'region_selection',
        selectedRegionIndex: primarySelectedRegionIndex,
        spawnedPageCount: spawnedPageIds.length,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'prescriptions.confirm_crop',
      entityType: 'prescription_page',
      entityId: pageId,
      after: { cropBox: primaryCropBox, spawnedPageIds },
      ...meta,
    });

    // Already submitted — enqueue right away, whether the prescription is
    // still EXTRACTING or already reached REVIEW (the degenerate "every
    // page needed manual crop" case finalizes to REVIEW immediately with
    // nothing queued yet — see PrescriptionOcrWorkerService's doc
    // comment). If still UPLOADED, submit() will pick these pages up
    // (manualCropRequired is now false) when the caller eventually
    // submits.
    if (rx.status !== 'UPLOADED') {
      await this.queue.enqueuePage(pageId);
      for (const spawnedId of spawnedPageIds) {
        await this.queue.enqueuePage(spawnedId);
      }
    }

    return {
      pageId,
      manualCropRequired: false,
      cropBox: primaryCropBox,
      spawnedPageIds,
      prescriptionStatus: rx.status,
    };
  }

  private async requirePages(id: string) {
    const rx = await this.prisma.prescription.findUnique({
      where: { id },
      include: { pages: { orderBy: { pageNumber: 'asc' }, include: { imageVersions: true } } },
    });
    if (!rx) throw new NotFoundException('Prescription not found');
    return rx;
  }

  /** CR-001 Sprint OCR-02 — every stored image version per page, as
   *  short-TTL signed URLs (design spec §9: never a permanent/public
   *  link). Original is always present and is never overwritten. */
  async getImages(id: string) {
    const rx = await this.requirePages(id);
    const pages = await Promise.all(
      rx.pages.map(async (page) => ({
        pageId: page.id,
        pageNumber: page.pageNumber,
        versions: await Promise.all(
          page.imageVersions.map(async (v) => ({
            versionType: v.versionType,
            url: await this.storage.getSignedUrl(v.storageKey, 300),
            width: v.width,
            height: v.height,
          })),
        ),
      })),
    );
    return { prescriptionId: id, pages };
  }

  /** CR-001 Sprint OCR-02 — the 0-100 aggregate quality score and its
   *  sub-metric breakdown per page, plus Sprint OCR-01's coarse
   *  pre-preprocessing gate score for continuity. */
  async getQuality(id: string) {
    const rx = await this.requirePages(id);
    return {
      prescriptionId: id,
      pages: rx.pages.map((page) => ({
        pageId: page.id,
        pageNumber: page.pageNumber,
        imageQualityScore: page.imageQualityScore,
        finalQualityScore: page.finalQualityScore,
        qualityStatus: page.qualityStatus,
        blurScore: page.blurScore,
        brightnessScore: page.brightnessScore,
        contrastScore: page.contrastScore,
        noiseScore: page.noiseScore,
        rotationAngle: page.rotationAngle,
        cropConfidence: page.cropConfidence,
        processingStatus: page.processingStatus,
      })),
    };
  }

  /** CR-001 Sprint OCR-02 — pipeline run metadata: version, duration,
   *  timestamps, and any processor failures logged during the run
   *  (design spec: "Log: Processing duration, Processor execution time,
   *  Quality score, Processor failures"). */
  async getPreprocessing(id: string) {
    const rx = await this.requirePages(id);
    const pages = await Promise.all(
      rx.pages.map(async (page) => {
        const failureEvent = await this.prisma.timelineEvent.findFirst({
          where: {
            entityType: 'prescription_page',
            entityId: page.id,
            eventType: 'preprocessing_processor_failures',
          },
          orderBy: { createdAt: 'desc' },
        });
        return {
          pageId: page.id,
          pageNumber: page.pageNumber,
          preprocessingVersion: page.preprocessingVersion,
          preprocessingDuration: page.preprocessingDuration,
          preprocessingStartedAt: page.preprocessingStartedAt,
          preprocessingCompletedAt: page.preprocessingCompletedAt,
          processingStatus: page.processingStatus,
          processingError: page.processingError,
          processorFailures:
            (failureEvent?.payload as { failures?: string[] } | null)?.failures ?? [],
        };
      }),
    );
    return { prescriptionId: id, pages };
  }

  private async requirePage(prescriptionId: string, pageId: string) {
    const page = await this.prisma.prescriptionPage.findUnique({ where: { id: pageId } });
    if (!page || page.prescriptionId !== prescriptionId) {
      throw new NotFoundException('Prescription page not found');
    }
    return page;
  }

  /** CR-001 Sprint OCR-03 — OCR Results Viewer data (design doc §14): the
   *  *current* run's text blocks (never a mix of runs — see
   *  PrescriptionOcrWorkerService.runOcrPipeline's doc comment), each
   *  block's own correction history, and the page-level OCR summary. */
  async getPageText(id: string, pageId: string) {
    const page = await this.requirePage(id, pageId);
    if (!page.currentOcrRunId) {
      return {
        pageId,
        run: null,
        blocks: [] as unknown[],
        rawPageText: page.rawPageText,
        normalizedPageText: page.normalizedPageText,
        ocrPageConfidence: page.ocrPageConfidence,
        requiresOcrReview: page.requiresOcrReview,
      };
    }
    const [run, blocks] = await Promise.all([
      this.prisma.prescriptionOcrRun.findUnique({ where: { id: page.currentOcrRunId } }),
      this.prisma.oCRTextBlock.findMany({
        where: { ocrRunId: page.currentOcrRunId },
        orderBy: { lineNumber: 'asc' },
        include: { corrections: { orderBy: { createdAt: 'desc' } } },
      }),
    ]);
    return {
      pageId,
      run,
      blocks,
      rawPageText: page.rawPageText,
      normalizedPageText: page.normalizedPageText,
      ocrPageConfidence: page.ocrPageConfidence,
      requiresOcrReview: page.requiresOcrReview,
    };
  }

  /** CR-001 Sprint OCR-03 — Manual OCR Review Foundation (design doc
   *  §15): records a reviewer's verdict on one text block. Deliberately
   *  does not touch DrugAlias/matching or the block's own text — this is
   *  the review record only; the block's rawText/normalizedText stay
   *  exactly what OCR produced (design doc: "corrected text stored
   *  separately").
   *
   *  CR-001 Phase 5 — a correction can change what the matching engine
   *  would segment/extract from this page, so it triggers a scoped
   *  re-match limited to this one page (design summary §24: "re-run
   *  scoped to the line") once the correction itself is recorded. Runs
   *  synchronously, same rationale as rerunOcr() below — a single
   *  reviewer action, not the automatic pipeline — and never touches any
   *  other page's already-matched lines. */
  async correctBlock(
    actor: AuthUser,
    prescriptionId: string,
    pageId: string,
    blockId: string,
    dto: CorrectOcrBlockDto,
    meta: { ip?: string },
  ) {
    await this.requirePage(prescriptionId, pageId);
    const block = await this.prisma.oCRTextBlock.findUnique({ where: { id: blockId } });
    if (!block || block.prescriptionPageId !== pageId) {
      throw new NotFoundException('OCR text block not found');
    }
    if (!dto.markedAs && dto.correctedText === undefined) {
      throw new BadRequestException('Provide markedAs and/or correctedText');
    }
    const correction = await this.prisma.oCRCorrection.create({
      data: {
        ocrTextBlockId: blockId,
        originalOCRText: block.rawText,
        correctedText: dto.correctedText ?? null,
        markedAs: dto.markedAs ?? null,
        correctedById: actor.userId,
        correctionReason: dto.reason ?? null,
      },
    });
    await this.timeline.record({
      entityType: 'prescription_page',
      entityId: pageId,
      eventType: 'ocr_block_corrected',
      actorId: actor.userId,
      payload: {
        blockId,
        markedAs: dto.markedAs ?? null,
        hasTextEdit: dto.correctedText !== undefined,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'prescriptions.correct_ocr_block',
      entityType: 'ocr_text_block',
      entityId: blockId,
      after: { markedAs: dto.markedAs ?? null, correctedText: dto.correctedText ?? null },
      ...meta,
    });
    await this.drugMatchingEngine.run(prescriptionId, actor.userId, { pageIds: [pageId] });
    return correction;
  }

  /** CR-001 Sprint OCR-03 — manual OCR re-run (design doc §16): runs
   *  synchronously (like confirmCrop()/uploadPage()'s other Python calls)
   *  rather than through BullMQ, since it's a single reviewer-initiated
   *  action, not part of the automatic pipeline. Every prior run's blocks
   *  stay in place — this only adds a new run and repoints the page's
   *  "current" pointer at it. */
  async rerunOcr(actor: AuthUser, prescriptionId: string, pageId: string, meta: { ip?: string }) {
    await this.requirePage(prescriptionId, pageId);
    const outcome = await this.worker.rerunOcr(pageId, actor.userId);
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'prescriptions.rerun_ocr',
      entityType: 'prescription_page',
      entityId: pageId,
      after: {
        runId: outcome.run.id,
        runNumber: outcome.run.runNumber,
        blockCount: outcome.blockCount,
        pageConfidence: outcome.pageConfidence,
      },
      ...meta,
    });
    return outcome;
  }
}
