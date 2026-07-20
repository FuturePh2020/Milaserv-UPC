import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { BranchExtensionsService } from './branch-extensions.service';
import {
  AssignCapabilityDto,
  CreateCapabilityDto,
  CreateServiceAreaDto,
  UpdateServiceAreaDto,
  UpsertSpecialHoursDto,
  UpsertWeeklyHoursDto,
} from './branch-extensions.dto';

/**
 * Phase 6 §7/§8/§10 — sub-resources of Branch, reusing branch.view/
 * branch.manage (no new permission keys — this is an extension of the
 * existing Branch Center admin surface, not a new domain).
 */
@Controller('branches')
export class BranchExtensionsController {
  constructor(private readonly extensions: BranchExtensionsService) {}

  @RequirePermission('branch.view')
  @Get('capabilities')
  listCapabilities() {
    return this.extensions.listCapabilities();
  }

  @RequirePermission('branch.manage')
  @Post('capabilities')
  createCapability(@CurrentUser() user: AuthUser, @Body() dto: CreateCapabilityDto, @Req() req: Request) {
    return this.extensions.createCapability(user, dto, { ip: req.ip });
  }

  @RequirePermission('branch.view')
  @Get(':id/weekly-hours')
  listWeeklyHours(@Param('id') id: string) {
    return this.extensions.listWeeklyHours(id);
  }

  @RequirePermission('branch.manage')
  @Post(':id/weekly-hours')
  upsertWeeklyHours(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpsertWeeklyHoursDto,
    @Req() req: Request,
  ) {
    return this.extensions.upsertWeeklyHours(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('branch.view')
  @Get(':id/special-hours')
  listSpecialHours(@Param('id') id: string) {
    return this.extensions.listSpecialHours(id);
  }

  @RequirePermission('branch.manage')
  @Post(':id/special-hours')
  upsertSpecialHours(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpsertSpecialHoursDto,
    @Req() req: Request,
  ) {
    return this.extensions.upsertSpecialHours(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('branch.view')
  @Get(':id/service-areas')
  listServiceAreas(@Param('id') id: string) {
    return this.extensions.listServiceAreas(id);
  }

  @RequirePermission('branch.manage')
  @Post(':id/service-areas')
  createServiceArea(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateServiceAreaDto,
    @Req() req: Request,
  ) {
    return this.extensions.createServiceArea(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('branch.manage')
  @Patch(':id/service-areas/:areaId')
  updateServiceArea(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('areaId') areaId: string,
    @Body() dto: UpdateServiceAreaDto,
    @Req() req: Request,
  ) {
    return this.extensions.updateServiceArea(user, id, areaId, dto, { ip: req.ip });
  }

  @RequirePermission('branch.view')
  @Get(':id/capabilities')
  listBranchCapabilities(@Param('id') id: string) {
    return this.extensions.listBranchCapabilities(id);
  }

  @RequirePermission('branch.manage')
  @Post(':id/capabilities')
  assignCapability(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AssignCapabilityDto,
    @Req() req: Request,
  ) {
    return this.extensions.assignCapability(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('branch.manage')
  @Delete(':id/capabilities/:capabilityId')
  @HttpCode(204)
  unassignCapability(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('capabilityId') capabilityId: string,
    @Req() req: Request,
  ) {
    return this.extensions.unassignCapability(user, id, capabilityId, { ip: req.ip });
  }
}
