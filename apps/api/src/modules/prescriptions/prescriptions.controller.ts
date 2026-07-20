import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../../core/auth/public.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { PermissionScope } from '../permissions/permission-scope.decorator';
import type { RequestScope } from '../permissions/scope';
import {
  ConfirmCropDto,
  CorrectOcrBlockDto,
  CreatePrescriptionDto,
  ListPrescriptionsQueryDto,
  UploadPageDto,
} from './prescriptions.dto';
import { PrescriptionsService } from './prescriptions.service';
import { detectMimeFromMagicBytes } from './file-validation';
import { LocalDiskPrescriptionStorage } from './storage/prescription-storage';
import { DrugMatchReviewService } from './matching/drug-match-review.service';
import {
  MarkNotMedicationDto,
  RejectCandidateDto,
  SelectDrugManuallyDto,
} from './matching/drug-match-review.dto';

interface UploadedFileShape {
  originalname: string;
  buffer: Buffer;
}

/**
 * CR-001 Prescription Intelligence Engine — Sprint OCR-01 (design spec §5).
 * Routes live at /prescriptions, distinct from the Phase 10 /ocr/* module
 * kept running unchanged until the OCR-12 migration.
 */
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(
    private readonly prescriptions: PrescriptionsService,
    private readonly localStorage: LocalDiskPrescriptionStorage,
    private readonly drugMatchReview: DrugMatchReviewService,
  ) {}

  @RequirePermission('ocr.view')
  @Get('config')
  config() {
    return this.prescriptions.config();
  }

  @RequirePermission('ocr.upload')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePrescriptionDto, @Req() req: Request) {
    return this.prescriptions.create(user, dto, { ip: req.ip });
  }

  @RequirePermission('ocr.upload')
  @Post(':id/pages')
  @UseInterceptors(FileInterceptor('file'))
  uploadPage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileShape | undefined,
    @Body() dto: UploadPageDto,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('file is required (multipart field "file")');
    return this.prescriptions.uploadPage(user, id, file, dto, { ip: req.ip });
  }

  /** CR-001 Sprint OCR-02 Extension — confirms a page's crop, either by
   *  picking one or more detected candidate regions or by a manual
   *  override box (design doc: "Prescription Region Detector"). */
  @RequirePermission('ocr.upload')
  @Post(':id/pages/:pageId/crop')
  confirmCrop(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('pageId') pageId: string,
    @Body() dto: ConfirmCropDto,
    @Req() req: Request,
  ) {
    return this.prescriptions.confirmCrop(user, id, pageId, dto, { ip: req.ip });
  }

  @RequirePermission('ocr.upload')
  @Post(':id/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.prescriptions.submit(user, id, { ip: req.ip });
  }

  @RequirePermission('ocr.view')
  @Get()
  list(@PermissionScope() scope: RequestScope, @Query() q: ListPrescriptionsQueryDto) {
    return this.prescriptions.list(scope, q);
  }

  @RequirePermission('ocr.view')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.prescriptions.get(id);
  }

  /** CR-001 Sprint OCR-02 — image inspection: every stored version
   *  (Original/Rotated/Cropped/Enhanced/OCR-ready) as signed URLs. */
  @RequirePermission('ocr.view')
  @Get(':id/images')
  getImages(@Param('id') id: string) {
    return this.prescriptions.getImages(id);
  }

  /** CR-001 Sprint OCR-02 Extension — the raw original for a single page,
   *  usable before preprocessing has run (the crop/preview workspace). */
  @RequirePermission('ocr.view')
  @Get(':id/pages/:pageId/original')
  getPageOriginal(@Param('id') id: string, @Param('pageId') pageId: string) {
    return this.prescriptions.getPageOriginal(id, pageId);
  }

  /** CR-001 Sprint OCR-02 — the 0-100 quality score and sub-metrics. */
  @RequirePermission('ocr.view')
  @Get(':id/quality')
  getQuality(@Param('id') id: string) {
    return this.prescriptions.getQuality(id);
  }

  /** CR-001 Sprint OCR-02 — pipeline run metadata (version, duration,
   *  timestamps, processor failures). */
  @RequirePermission('ocr.view')
  @Get(':id/preprocessing')
  getPreprocessing(@Param('id') id: string) {
    return this.prescriptions.getPreprocessing(id);
  }

  /** CR-001 Sprint OCR-03 — the current OCR run's text blocks plus their
   *  correction history (OCR Results Viewer). */
  @RequirePermission('ocr.view')
  @Get(':id/pages/:pageId/text')
  getPageText(@Param('id') id: string, @Param('pageId') pageId: string) {
    return this.prescriptions.getPageText(id, pageId);
  }

  /** CR-001 Sprint OCR-03 — Manual OCR Review Foundation: mark a text
   *  block correct/unreadable/irrelevant and/or store a corrected reading,
   *  without ever mutating what OCR actually produced. */
  @RequirePermission('ocr.review')
  @Post(':id/pages/:pageId/blocks/:blockId/correct')
  correctBlock(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('pageId') pageId: string,
    @Param('blockId') blockId: string,
    @Body() dto: CorrectOcrBlockDto,
    @Req() req: Request,
  ) {
    return this.prescriptions.correctBlock(user, id, pageId, blockId, dto, { ip: req.ip });
  }

  /** CR-001 Sprint OCR-03 — OCR Reprocessing: runs a brand-new OCR pass
   *  synchronously and records it as a new PrescriptionOcrRun, never
   *  overwriting any prior run. */
  @RequirePermission('ocr.review')
  @Post(':id/pages/:pageId/rerun-ocr')
  @HttpCode(200)
  rerunOcr(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('pageId') pageId: string,
    @Req() req: Request,
  ) {
    return this.prescriptions.rerunOcr(user, id, pageId, { ip: req.ip });
  }

  // ── CR-001 Phase 5 — Intelligent OCR-to-Drug Matching Engine ─────────

  /** The latest DrugMatchRun (or a specific historical one via
   *  `?runId=`) and its medication lines/ranked candidates, with every
   *  score/evidence/conflict field the engine produced — never hidden
   *  behind backend-only logs (design summary §23). */
  @RequirePermission('ocr.view')
  @Get(':id/drug-matches')
  getDrugMatches(@Param('id') id: string, @Query('runId') runId?: string) {
    return this.drugMatchReview.getDrugMatches(id, runId);
  }

  /** Every DrugMatchRun ever created for this prescription, newest
   *  first — none are ever deleted (design summary §20). */
  @RequirePermission('ocr.view')
  @Get(':id/drug-matches/runs')
  listDrugMatchRuns(@Param('id') id: string) {
    return this.drugMatchReview.listRuns(id);
  }

  /** Manually triggers a full reprocess — a fresh DrugMatchRun across
   *  every page, alongside every prior run. */
  @RequirePermission('ocr.review')
  @Post(':id/drug-matches/reprocess')
  @HttpCode(200)
  reprocessDrugMatches(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.drugMatchReview.reprocess(user, id, { ip: req.ip });
  }

  /** A pharmacist confirms one of the engine's ranked candidates as the
   *  correct drug for this medication line. */
  @RequirePermission('ocr.review')
  @Post(':id/medication-lines/:lineId/candidates/:candidateId/confirm')
  @HttpCode(200)
  confirmCandidate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Param('candidateId') candidateId: string,
    @Req() req: Request,
  ) {
    return this.drugMatchReview.confirmCandidate(user, id, lineId, candidateId, { ip: req.ip });
  }

  /** A pharmacist rejects one specific candidate — the line's overall
   *  status is unaffected; another candidate or a manual selection is
   *  still needed. */
  @RequirePermission('ocr.review')
  @Post(':id/medication-lines/:lineId/candidates/:candidateId/reject')
  @HttpCode(200)
  rejectCandidate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Param('candidateId') candidateId: string,
    @Body() dto: RejectCandidateDto,
    @Req() req: Request,
  ) {
    return this.drugMatchReview.rejectCandidate(user, id, lineId, candidateId, dto, { ip: req.ip });
  }

  /** For when none of the engine's candidates are right — a pharmacist
   *  picks a real DIC drug directly. */
  @RequirePermission('ocr.review')
  @Post(':id/medication-lines/:lineId/select-drug')
  @HttpCode(200)
  selectDrugManually(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: SelectDrugManuallyDto,
    @Req() req: Request,
  ) {
    return this.drugMatchReview.selectDrugManually(user, id, lineId, dto, { ip: req.ip });
  }

  /** A pharmacist flags a segmented line as not actually a medication
   *  (a segmenter false positive). */
  @RequirePermission('ocr.review')
  @Post(':id/medication-lines/:lineId/mark-not-medication')
  @HttpCode(200)
  markNotMedication(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: MarkNotMedicationDto,
    @Req() req: Request,
  ) {
    return this.drugMatchReview.markNotMedication(user, id, lineId, dto, { ip: req.ip });
  }

  /**
   * The local-disk driver's "signed URL" — see
   * LocalDiskPrescriptionStorage's doc comment for why this is @Public():
   * a valid, unexpired HMAC signature is the authorization for this
   * narrow window, exactly like a real S3 presigned URL. Only ever
   * reachable via a link this API itself issued after a permission check.
   */
  @Public()
  @Get('files/:encodedKey')
  async serveFile(
    @Param('encodedKey') encodedKey: string,
    @Query('exp') expParam: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    const key = Buffer.from(encodedKey, 'base64url').toString('utf8');
    const exp = Number(expParam);
    if (!Number.isFinite(exp) || !sig || !this.localStorage.verify(key, exp, sig)) {
      throw new ForbiddenException('Invalid or expired file link');
    }
    const data = await this.prescriptions.readFile(key);
    res.setHeader('Content-Type', detectMimeFromMagicBytes(data) ?? 'application/octet-stream');
    // Helmet's default Cross-Origin-Resource-Policy: same-origin blocks the
    // frontend (a different origin/port in dev) from embedding this in an
    // <img> tag. Safe to loosen only here: this route's own HMAC-signed,
    // short-TTL token is the real access control, exactly like a real S3
    // presigned URL, which carries no CORP restriction by default either.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(data);
  }
}
