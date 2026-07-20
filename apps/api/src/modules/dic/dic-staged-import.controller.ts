import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { DicStagedImportService } from './dic-staged-import.service';
import { CreateImportBatchDto, ResolveImportRowDto, SetImportMappingDto } from './dic.dto';

/**
 * CR-002 Phase 4 Step 5 — staged Excel import (design doc §7/§20/§21):
 * upload → map columns → validate (dry run + duplicate detection) →
 * resolve duplicates → approve → execute → (optionally) roll back.
 * Everything here is dic.import_staged, except rollback which the
 * permission table assigns to dic.admin ("roll back imports").
 */
@Controller('dic/import/staged')
export class DicStagedImportController {
  constructor(private readonly imports: DicStagedImportService) {}

  @RequirePermission('dic.import_staged')
  @Get('batches')
  listBatches(@Query('status') status?: string) {
    return this.imports.listBatches(status);
  }

  @RequirePermission('dic.import_staged')
  @Post('batches')
  createBatch(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateImportBatchDto,
    @Req() req: Request,
  ) {
    return this.imports.createBatch(user, dto, { ip: req.ip });
  }

  @RequirePermission('dic.import_staged')
  @Get('batches/:id')
  getBatch(@Param('id') id: string) {
    return this.imports.getBatch(id);
  }

  @RequirePermission('dic.import_staged')
  @Patch('batches/:id/mapping')
  setMapping(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SetImportMappingDto,
    @Req() req: Request,
  ) {
    return this.imports.setMapping(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('dic.import_staged')
  @Post('batches/:id/validate')
  @HttpCode(200)
  validate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.imports.validate(user, id, { ip: req.ip });
  }

  @RequirePermission('dic.import_staged')
  @Get('batches/:id/preview')
  preview(@Param('id') id: string, @Query('status') status?: string) {
    return this.imports.preview(id, status);
  }

  @RequirePermission('dic.import_staged')
  @Patch('rows/:rowId/resolve')
  resolveRow(
    @CurrentUser() user: AuthUser,
    @Param('rowId') rowId: string,
    @Body() dto: ResolveImportRowDto,
    @Req() req: Request,
  ) {
    return this.imports.resolveRow(user, rowId, dto, { ip: req.ip });
  }

  @RequirePermission('dic.import_staged')
  @Post('batches/:id/approve')
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.imports.approve(user, id, { ip: req.ip });
  }

  @RequirePermission('dic.import_staged')
  @Post('batches/:id/execute')
  @HttpCode(200)
  execute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.imports.execute(user, id, { ip: req.ip });
  }

  @RequirePermission('dic.admin')
  @Post('batches/:id/rollback')
  @HttpCode(200)
  rollback(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.imports.rollback(user, id, { ip: req.ip });
  }

  @RequirePermission('dic.import_staged')
  @Get('batches/:id/error-report.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="import-errors.csv"')
  errorReport(@Param('id') id: string) {
    return this.imports.errorReportCsv(id);
  }
}
