import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { DicQualityService } from './dic-quality.service';
import { MergeDrugDto, SetDataQualityStatusDto, UpdateDrugFieldsDto } from './dic.dto';

/**
 * CR-002 Phase 4 Step 6 — controlled drug merge (dic.admin), version-
 * checked structural-field edits (dic.edit), and the data-quality
 * dashboard/issue drill-down (dic.pharmacist_review).
 */
@Controller('dic')
export class DicQualityController {
  constructor(private readonly quality: DicQualityService) {}

  @RequirePermission('dic.admin')
  @Post('drugs/:id/merge')
  @HttpCode(200)
  merge(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MergeDrugDto,
    @Req() req: Request,
  ) {
    return this.quality.merge(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('dic.edit')
  @Patch('drugs/:id/fields')
  updateFields(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDrugFieldsDto,
    @Req() req: Request,
  ) {
    return this.quality.updateFields(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('dic.pharmacist_review')
  @Post('drugs/:id/quality/status')
  @HttpCode(200)
  setQualityStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SetDataQualityStatusDto,
    @Req() req: Request,
  ) {
    return this.quality.setQualityStatus(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('dic.pharmacist_review')
  @Get('quality/dashboard')
  dashboard() {
    return this.quality.dashboard();
  }

  @RequirePermission('dic.pharmacist_review')
  @Get('quality/issues')
  listIssues(@Query('rule') rule: string, @Query('limit') limit?: string) {
    return this.quality.listIssues(rule, limit ? Number(limit) : undefined);
  }
}
