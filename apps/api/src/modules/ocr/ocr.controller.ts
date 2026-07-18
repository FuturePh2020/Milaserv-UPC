import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { PermissionScope } from '../permissions/permission-scope.decorator';
import type { RequestScope } from '../permissions/scope';
import {
  AddLineDto,
  ConfirmPrescriptionDto,
  CreatePrescriptionDto,
  DecideLineDto,
  ListPrescriptionsQueryDto,
  RejectPrescriptionDto,
} from './ocr.dto';
import { OcrService } from './ocr.service';

@Controller('ocr')
export class OcrController {
  constructor(private readonly ocr: OcrService) {}

  /** §17 upload flow: create shell → attach file → submit (spec I2). */
  @RequirePermission('ocr.upload')
  @Post('prescriptions')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePrescriptionDto, @Req() req: Request) {
    return this.ocr.create(user, dto, { ip: req.ip });
  }

  @RequirePermission('ocr.upload')
  @Post('prescriptions/:id/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.ocr.submit(user, id, { ip: req.ip });
  }

  @RequirePermission('ocr.view')
  @Get('prescriptions')
  list(@PermissionScope() scope: RequestScope, @Query() q: ListPrescriptionsQueryDto) {
    return this.ocr.list(scope, q);
  }

  @RequirePermission('ocr.view')
  @Get('prescriptions/:id')
  get(@Param('id') id: string) {
    return this.ocr.get(id);
  }

  // ── §17 human review — always required (spec I4) ───────────────────

  @RequirePermission('ocr.review')
  @Post('prescriptions/:id/lines')
  addLine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddLineDto,
    @Req() req: Request,
  ) {
    return this.ocr.addLine(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('ocr.review')
  @Post('lines/:lineId/decide')
  @HttpCode(200)
  decideLine(
    @CurrentUser() user: AuthUser,
    @Param('lineId') lineId: string,
    @Body() dto: DecideLineDto,
    @Req() req: Request,
  ) {
    return this.ocr.decideLine(user, lineId, dto, { ip: req.ip });
  }

  @RequirePermission('ocr.review')
  @Post('prescriptions/:id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ConfirmPrescriptionDto,
    @Req() req: Request,
  ) {
    return this.ocr.confirm(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('ocr.review')
  @Post('prescriptions/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RejectPrescriptionDto,
    @Req() req: Request,
  ) {
    return this.ocr.reject(user, id, dto, { ip: req.ip });
  }
}
