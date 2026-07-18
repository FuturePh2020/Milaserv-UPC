import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import {
  CreateChangeRequestDto,
  DecideChangeRequestDto,
  ImportCoverageDto,
  ImportDrugsDto,
  SearchQueryDto,
} from './dic.dto';
import { DicService } from './dic.service';
import { DicImportService } from './dic-import.service';

@Controller('dic')
export class DicController {
  constructor(
    private readonly dic: DicService,
    private readonly importer: DicImportService,
  ) {}

  @RequirePermission('dic.view')
  @Get('catalogs')
  catalogs() {
    return this.dic.catalogs();
  }

  /** §15.1 search — also drives the auto-complete (small limit). */
  @RequirePermission('dic.view')
  @Get('search')
  search(@Query() q: SearchQueryDto) {
    return this.dic.search(q);
  }

  @RequirePermission('dic.view')
  @Get('drugs/:id')
  get(@Param('id') id: string) {
    return this.dic.get(id);
  }

  /** §21 DBS: live availability refresh (integrations spec J3). */
  @RequirePermission('dic.view')
  @Post('drugs/:id/refresh-availability')
  @HttpCode(200)
  refreshAvailability(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.dic.refreshAvailability(user, id, { ip: req.ip });
  }

  /** §15 master import — one chunk per call (spec H2). */
  @RequirePermission('dic.manage')
  @Post('import')
  @HttpCode(200)
  import(@CurrentUser() user: AuthUser, @Body() dto: ImportDrugsDto, @Req() req: Request) {
    return this.importer.importChunk(user, dto, { ip: req.ip });
  }

  /** §15.3 per-company coverage mapping (spec H3). */
  @RequirePermission('dic.manage')
  @Post('coverage/import')
  @HttpCode(200)
  importCoverage(
    @CurrentUser() user: AuthUser,
    @Body() dto: ImportCoverageDto,
    @Req() req: Request,
  ) {
    return this.importer.importCoverage(user, dto, { ip: req.ip });
  }

  // ── §15.3 approval workflow (spec H8) ──────────────────────────────

  @RequirePermission('dic.view')
  @Post('drugs/:id/change-request')
  createChangeRequest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateChangeRequestDto,
    @Req() req: Request,
  ) {
    return this.dic.createChangeRequest(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('dic.approve')
  @Get('change-requests')
  changeRequests(@Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    return this.dic.listChangeRequests(status);
  }

  @RequirePermission('dic.approve')
  @Post('change-requests/:id/decide')
  @HttpCode(200)
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DecideChangeRequestDto,
    @Req() req: Request,
  ) {
    return this.dic.decide(user, id, dto, { ip: req.ip });
  }
}
