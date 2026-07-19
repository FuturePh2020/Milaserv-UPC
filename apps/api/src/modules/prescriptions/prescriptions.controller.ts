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
import { CreatePrescriptionDto, ListPrescriptionsQueryDto } from './prescriptions.dto';
import { PrescriptionsService } from './prescriptions.service';
import { detectMimeFromMagicBytes } from './file-validation';
import { LocalDiskPrescriptionStorage } from './storage/prescription-storage';

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
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('file is required (multipart field "file")');
    return this.prescriptions.uploadPage(user, id, file, { ip: req.ip });
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
