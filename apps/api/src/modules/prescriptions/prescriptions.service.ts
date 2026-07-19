import { createHash } from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import { NumberingService } from '../numbering/numbering.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { RequestScope } from '../permissions/scope';
import { PrescriptionOcrQueueService } from './queue/prescription-ocr.queue';
import { PRESCRIPTION_STORAGE } from './storage/prescription-storage';
import type { PrescriptionStorageDriver } from './storage/prescription-storage';
import { newPrescriptionStorageKey } from './storage/prescription-storage';
import { validatePrescriptionFile } from './file-validation';
import type { CreatePrescriptionDto, ListPrescriptionsQueryDto } from './prescriptions.dto';

interface UploadedFileShape {
  originalname: string;
  buffer: Buffer;
}

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly queue: PrescriptionOcrQueueService,
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

  async uploadPage(
    actor: AuthUser,
    prescriptionId: string,
    file: UploadedFileShape,
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

    const lastPage = await this.prisma.prescriptionPage.findFirst({
      where: { prescriptionId },
      orderBy: { pageNumber: 'desc' },
      select: { pageNumber: true },
    });
    const pageNumber = (lastPage?.pageNumber ?? 0) + 1;

    const storageKey = newPrescriptionStorageKey(file.originalname);
    await this.storage.put(storageKey, file.buffer, validation.detectedMime);

    const page = await this.prisma.prescriptionPage.create({
      data: {
        prescriptionId,
        pageNumber,
        originalStorageKey: storageKey,
        contentHash,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'prescriptions.upload_page',
      entityType: 'prescription_page',
      entityId: page.id,
      after: { prescriptionId, pageNumber, detectedMime: validation.detectedMime },
      ...meta,
    });
    return {
      id: page.id,
      pageNumber,
      possibleDuplicateOfPrescriptionId: duplicate?.prescriptionId ?? null,
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
    for (const page of rx.pages) {
      await this.queue.enqueuePage(page.id);
    }
    await this.timeline.record({
      entityType: 'prescription',
      entityId: prescriptionId,
      eventType: 'submitted',
      actorId: actor.userId,
      payload: { pages: rx.pages.length },
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
          include: { textBlocks: { orderBy: { lineNumber: 'asc' } } },
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
}
