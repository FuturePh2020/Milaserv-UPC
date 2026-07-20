import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { LocationsService } from './locations.service';
import {
  CreateCityDto,
  CreateDistrictDto,
  CreateLocationAliasDto,
  CreateRegionDto,
  UpdateCityDto,
  UpdateDistrictDto,
  UpdateRegionDto,
} from './locations.dto';

/**
 * Phase 6 — Location hierarchy reference CRUD. location.view to read,
 * location.manage to mutate — mirrors DicReferenceController's split
 * (structural catalogs are wide-blast-radius, so mutation is a single
 * higher-trust permission rather than split per-catalog like dic.edit
 * vs dic.admin, since geography carries none of DIC's patient-safety
 * stakes).
 */
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @RequirePermission('location.view')
  @Get('regions')
  listRegions() {
    return this.locations.listRegions();
  }

  @RequirePermission('location.manage')
  @Post('regions')
  createRegion(@CurrentUser() user: AuthUser, @Body() dto: CreateRegionDto, @Req() req: Request) {
    return this.locations.createRegion(user, dto, { ip: req.ip });
  }

  @RequirePermission('location.manage')
  @Patch('regions/:id')
  updateRegion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRegionDto,
    @Req() req: Request,
  ) {
    return this.locations.updateRegion(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('location.view')
  @Get('cities')
  listCities(@Query('regionId') regionId?: string) {
    return this.locations.listCities(regionId);
  }

  @RequirePermission('location.manage')
  @Post('cities')
  createCity(@CurrentUser() user: AuthUser, @Body() dto: CreateCityDto, @Req() req: Request) {
    return this.locations.createCity(user, dto, { ip: req.ip });
  }

  @RequirePermission('location.manage')
  @Patch('cities/:id')
  updateCity(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCityDto,
    @Req() req: Request,
  ) {
    return this.locations.updateCity(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('location.view')
  @Get('districts')
  listDistricts(@Query('cityId') cityId?: string) {
    return this.locations.listDistricts(cityId);
  }

  @RequirePermission('location.manage')
  @Post('districts')
  createDistrict(@CurrentUser() user: AuthUser, @Body() dto: CreateDistrictDto, @Req() req: Request) {
    return this.locations.createDistrict(user, dto, { ip: req.ip });
  }

  @RequirePermission('location.manage')
  @Patch('districts/:id')
  updateDistrict(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDistrictDto,
    @Req() req: Request,
  ) {
    return this.locations.updateDistrict(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('location.view')
  @Get('aliases')
  listAliases(
    @Query('entityType') entityType?: 'CITY' | 'DISTRICT',
    @Query('entityId') entityId?: string,
  ) {
    return this.locations.listAliases(entityType, entityId);
  }

  @RequirePermission('location.manage')
  @Post('aliases')
  createAlias(@CurrentUser() user: AuthUser, @Body() dto: CreateLocationAliasDto, @Req() req: Request) {
    return this.locations.createAlias(user, dto, { ip: req.ip });
  }

  @RequirePermission('location.manage')
  @Post('backfill-branches')
  backfillBranches(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.locations.backfillBranchLocations(user, { ip: req.ip });
  }

  @RequirePermission('location.view')
  @Get('data-quality')
  dataQuality() {
    return this.locations.locationDataQuality();
  }
}
