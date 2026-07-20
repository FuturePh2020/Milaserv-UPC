import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { DicReferenceService } from './dic-reference.service';
import {
  CreateActiveIngredientDto,
  CreateCountryDto,
  CreateDosageFormDto,
  CreateManufacturerDto,
  CreateMeasurementUnitDto,
  CreateTherapeuticClassDto,
  UpdateActiveIngredientDto,
  UpdateCountryDto,
  UpdateDosageFormDto,
  UpdateManufacturerDto,
  UpdateMeasurementUnitDto,
  UpdateTherapeuticClassDto,
} from './dic.dto';

/**
 * CR-002 Phase 4 — DIC Drug Master & Normalization Foundation (design
 * doc §4/§5/§9): controlled reference catalogs, distinct from the main
 * drug search/card routes in dic.controller.ts. Structural catalogs
 * (dosage forms/units/countries/therapeutic classes) are dic.admin-only
 * to mutate — changing them has a wide blast radius across every linked
 * drug. Manufacturers/active ingredients are dic.edit to create (routine
 * drug-entry work) but dic.admin to edit/deactivate an existing one.
 */
@Controller('dic/reference')
export class DicReferenceController {
  constructor(private readonly reference: DicReferenceService) {}

  @RequirePermission('dic.view')
  @Get('dosage-forms')
  listDosageForms() {
    return this.reference.listDosageForms();
  }

  @RequirePermission('dic.admin')
  @Post('dosage-forms')
  createDosageForm(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDosageFormDto,
    @Req() req: Request,
  ) {
    return this.reference.createDosageForm(user, dto, { ip: req.ip });
  }

  @RequirePermission('dic.admin')
  @Patch('dosage-forms/:id')
  updateDosageForm(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDosageFormDto,
    @Req() req: Request,
  ) {
    return this.reference.updateDosageForm(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('dic.view')
  @Get('units')
  listUnits() {
    return this.reference.listMeasurementUnits();
  }

  @RequirePermission('dic.admin')
  @Post('units')
  createUnit(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateMeasurementUnitDto,
    @Req() req: Request,
  ) {
    return this.reference.createMeasurementUnit(user, dto, { ip: req.ip });
  }

  @RequirePermission('dic.admin')
  @Patch('units/:id')
  updateUnit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateMeasurementUnitDto,
    @Req() req: Request,
  ) {
    return this.reference.updateMeasurementUnit(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('dic.view')
  @Get('countries')
  listCountries() {
    return this.reference.listCountries();
  }

  @RequirePermission('dic.admin')
  @Post('countries')
  createCountry(@CurrentUser() user: AuthUser, @Body() dto: CreateCountryDto, @Req() req: Request) {
    return this.reference.createCountry(user, dto, { ip: req.ip });
  }

  @RequirePermission('dic.admin')
  @Patch('countries/:id')
  updateCountry(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCountryDto,
    @Req() req: Request,
  ) {
    return this.reference.updateCountry(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('dic.view')
  @Get('manufacturers')
  listManufacturers(@Query('q') q?: string) {
    return this.reference.listManufacturers(q);
  }

  @RequirePermission('dic.edit')
  @Post('manufacturers')
  createManufacturer(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateManufacturerDto,
    @Req() req: Request,
  ) {
    return this.reference.createManufacturer(user, dto, { ip: req.ip });
  }

  @RequirePermission('dic.admin')
  @Patch('manufacturers/:id')
  updateManufacturer(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateManufacturerDto,
    @Req() req: Request,
  ) {
    return this.reference.updateManufacturer(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('dic.view')
  @Get('therapeutic-classes')
  listTherapeuticClasses() {
    return this.reference.listTherapeuticClasses();
  }

  @RequirePermission('dic.admin')
  @Post('therapeutic-classes')
  createTherapeuticClass(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTherapeuticClassDto,
    @Req() req: Request,
  ) {
    return this.reference.createTherapeuticClass(user, dto, { ip: req.ip });
  }

  @RequirePermission('dic.admin')
  @Patch('therapeutic-classes/:id')
  updateTherapeuticClass(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTherapeuticClassDto,
    @Req() req: Request,
  ) {
    return this.reference.updateTherapeuticClass(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('dic.view')
  @Get('active-ingredients')
  listActiveIngredients(@Query('q') q?: string) {
    return this.reference.listActiveIngredients(q);
  }

  @RequirePermission('dic.edit')
  @Post('active-ingredients')
  createActiveIngredient(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateActiveIngredientDto,
    @Req() req: Request,
  ) {
    return this.reference.createActiveIngredient(user, dto, { ip: req.ip });
  }

  @RequirePermission('dic.admin')
  @Patch('active-ingredients/:id')
  updateActiveIngredient(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateActiveIngredientDto,
    @Req() req: Request,
  ) {
    return this.reference.updateActiveIngredient(user, id, dto, { ip: req.ip });
  }
}
