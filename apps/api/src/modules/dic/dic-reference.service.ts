import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { normalizeArabic } from './normalization/arabic';
import { foldDrugNameVariants } from './normalization/english';
import type {
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
 * CR-002 Phase 4 — DIC Drug Master & Normalization Foundation, design
 * doc §4/§5/§9. Controlled reference catalogs (dosage forms, units,
 * countries, manufacturers, therapeutic classes, active ingredients) —
 * never free text on Drug itself. Every mutation is audited with
 * before/after values, matching TicketConfigService's established
 * pattern for this codebase's other reference catalogs.
 */
@Injectable()
export class DicReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Dosage forms ─────────────────────────────────────────────────────

  listDosageForms() {
    return this.prisma.dosageForm.findMany({ orderBy: { nameEn: 'asc' } });
  }

  async createDosageForm(actor: AuthUser, dto: CreateDosageFormDto, meta: { ip?: string }) {
    const form = await this.prisma.dosageForm.create({
      data: {
        code: dto.code,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        normalizedNameEn: foldDrugNameVariants(dto.nameEn),
        normalizedNameAr: normalizeArabic(dto.nameAr),
        synonymsJson: (dto.synonyms ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.reference.dosage_form_create',
      entityType: 'dosage_form',
      entityId: form.id,
      after: dto,
      ...meta,
    });
    return form;
  }

  async updateDosageForm(
    actor: AuthUser,
    id: string,
    dto: UpdateDosageFormDto,
    meta: { ip?: string },
  ) {
    const before = await this.prisma.dosageForm.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Dosage form not found');
    const form = await this.prisma.dosageForm.update({
      where: { id },
      data: {
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        normalizedNameEn: dto.nameEn ? foldDrugNameVariants(dto.nameEn) : undefined,
        normalizedNameAr: dto.nameAr ? normalizeArabic(dto.nameAr) : undefined,
        synonymsJson: (dto.synonyms ?? undefined) as Prisma.InputJsonValue | undefined,
        active: dto.active,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.reference.dosage_form_update',
      entityType: 'dosage_form',
      entityId: id,
      before: { nameEn: before.nameEn, nameAr: before.nameAr, active: before.active },
      after: dto,
      ...meta,
    });
    return form;
  }

  // ── Measurement units ────────────────────────────────────────────────

  listMeasurementUnits() {
    return this.prisma.measurementUnit.findMany({ orderBy: { code: 'asc' } });
  }

  async createMeasurementUnit(
    actor: AuthUser,
    dto: CreateMeasurementUnitDto,
    meta: { ip?: string },
  ) {
    const unit = await this.prisma.measurementUnit.create({ data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.reference.unit_create',
      entityType: 'measurement_unit',
      entityId: unit.id,
      after: dto,
      ...meta,
    });
    return unit;
  }

  async updateMeasurementUnit(
    actor: AuthUser,
    id: string,
    dto: UpdateMeasurementUnitDto,
    meta: { ip?: string },
  ) {
    const before = await this.prisma.measurementUnit.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Measurement unit not found');
    const unit = await this.prisma.measurementUnit.update({ where: { id }, data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.reference.unit_update',
      entityType: 'measurement_unit',
      entityId: id,
      before: { nameEn: before.nameEn, nameAr: before.nameAr, active: before.active },
      after: dto,
      ...meta,
    });
    return unit;
  }

  // ── Countries ─────────────────────────────────────────────────────────

  listCountries() {
    return this.prisma.country.findMany({ orderBy: { nameEn: 'asc' } });
  }

  async createCountry(actor: AuthUser, dto: CreateCountryDto, meta: { ip?: string }) {
    const country = await this.prisma.country.create({
      data: { ...dto, isoCode: dto.isoCode.toUpperCase() },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.reference.country_create',
      entityType: 'country',
      entityId: country.id,
      after: dto,
      ...meta,
    });
    return country;
  }

  async updateCountry(actor: AuthUser, id: string, dto: UpdateCountryDto, meta: { ip?: string }) {
    const before = await this.prisma.country.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Country not found');
    const country = await this.prisma.country.update({ where: { id }, data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.reference.country_update',
      entityType: 'country',
      entityId: id,
      before: { nameEn: before.nameEn, nameAr: before.nameAr, active: before.active },
      after: dto,
      ...meta,
    });
    return country;
  }

  // ── Manufacturers ─────────────────────────────────────────────────────

  listManufacturers(q?: string) {
    return this.prisma.manufacturer.findMany({
      where: q
        ? { normalizedNameEn: { contains: foldDrugNameVariants(q), mode: 'insensitive' } }
        : undefined,
      include: { country: true },
      orderBy: { nameEn: 'asc' },
      take: 100,
    });
  }

  async createManufacturer(actor: AuthUser, dto: CreateManufacturerDto, meta: { ip?: string }) {
    const manufacturer = await this.prisma.manufacturer.create({
      data: {
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        normalizedNameEn: foldDrugNameVariants(dto.nameEn),
        normalizedNameAr: dto.nameAr ? normalizeArabic(dto.nameAr) : null,
        countryId: dto.countryId,
        sourceSystem: 'manual',
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.reference.manufacturer_create',
      entityType: 'manufacturer',
      entityId: manufacturer.id,
      after: dto,
      ...meta,
    });
    return manufacturer;
  }

  async updateManufacturer(
    actor: AuthUser,
    id: string,
    dto: UpdateManufacturerDto,
    meta: { ip?: string },
  ) {
    const before = await this.prisma.manufacturer.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Manufacturer not found');
    const manufacturer = await this.prisma.manufacturer.update({
      where: { id },
      data: {
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        normalizedNameEn: dto.nameEn ? foldDrugNameVariants(dto.nameEn) : undefined,
        normalizedNameAr: dto.nameAr ? normalizeArabic(dto.nameAr) : undefined,
        countryId: dto.countryId,
        active: dto.active,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.reference.manufacturer_update',
      entityType: 'manufacturer',
      entityId: id,
      before: { nameEn: before.nameEn, nameAr: before.nameAr, active: before.active },
      after: dto,
      ...meta,
    });
    return manufacturer;
  }

  // ── Therapeutic classes ─────────────────────────────────────────────────

  listTherapeuticClasses() {
    return this.prisma.therapeuticClass.findMany({ orderBy: { nameEn: 'asc' } });
  }

  async createTherapeuticClass(
    actor: AuthUser,
    dto: CreateTherapeuticClassDto,
    meta: { ip?: string },
  ) {
    const cls = await this.prisma.therapeuticClass.create({ data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.reference.therapeutic_class_create',
      entityType: 'therapeutic_class',
      entityId: cls.id,
      after: dto,
      ...meta,
    });
    return cls;
  }

  async updateTherapeuticClass(
    actor: AuthUser,
    id: string,
    dto: UpdateTherapeuticClassDto,
    meta: { ip?: string },
  ) {
    const before = await this.prisma.therapeuticClass.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Therapeutic class not found');
    if (dto.parentId === id) {
      throw new BadRequestException('A therapeutic class cannot be its own parent');
    }
    const cls = await this.prisma.therapeuticClass.update({ where: { id }, data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.reference.therapeutic_class_update',
      entityType: 'therapeutic_class',
      entityId: id,
      before: { nameEn: before.nameEn, nameAr: before.nameAr, active: before.active },
      after: dto,
      ...meta,
    });
    return cls;
  }

  // ── Active ingredients ───────────────────────────────────────────────

  listActiveIngredients(q?: string) {
    return this.prisma.activeIngredient.findMany({
      where: q
        ? { normalizedScientificNameEn: { contains: foldDrugNameVariants(q), mode: 'insensitive' } }
        : undefined,
      orderBy: { scientificNameEn: 'asc' },
      take: 100,
    });
  }

  async createActiveIngredient(
    actor: AuthUser,
    dto: CreateActiveIngredientDto,
    meta: { ip?: string },
  ) {
    const ingredient = await this.prisma.activeIngredient.create({
      data: {
        scientificNameEn: dto.scientificNameEn,
        scientificNameAr: dto.scientificNameAr,
        normalizedScientificNameEn: foldDrugNameVariants(dto.scientificNameEn),
        normalizedScientificNameAr: dto.scientificNameAr
          ? normalizeArabic(dto.scientificNameAr)
          : null,
        searchNameEn: foldDrugNameVariants(dto.scientificNameEn),
        searchNameAr: dto.scientificNameAr ? normalizeArabic(dto.scientificNameAr) : null,
        abbreviation: dto.abbreviation,
        atcCode: dto.atcCode,
        createdById: actor.userId,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.reference.active_ingredient_create',
      entityType: 'active_ingredient',
      entityId: ingredient.id,
      after: dto,
      ...meta,
    });
    return ingredient;
  }

  async updateActiveIngredient(
    actor: AuthUser,
    id: string,
    dto: UpdateActiveIngredientDto,
    meta: { ip?: string },
  ) {
    const before = await this.prisma.activeIngredient.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Active ingredient not found');
    const ingredient = await this.prisma.activeIngredient.update({
      where: { id },
      data: {
        scientificNameEn: dto.scientificNameEn,
        scientificNameAr: dto.scientificNameAr,
        normalizedScientificNameEn: dto.scientificNameEn
          ? foldDrugNameVariants(dto.scientificNameEn)
          : undefined,
        normalizedScientificNameAr: dto.scientificNameAr
          ? normalizeArabic(dto.scientificNameAr)
          : undefined,
        searchNameEn: dto.scientificNameEn ? foldDrugNameVariants(dto.scientificNameEn) : undefined,
        searchNameAr: dto.scientificNameAr ? normalizeArabic(dto.scientificNameAr) : undefined,
        abbreviation: dto.abbreviation,
        atcCode: dto.atcCode,
        active: dto.active,
        updatedById: actor.userId,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.reference.active_ingredient_update',
      entityType: 'active_ingredient',
      entityId: id,
      before: {
        scientificNameEn: before.scientificNameEn,
        scientificNameAr: before.scientificNameAr,
        active: before.active,
      },
      after: dto,
      ...meta,
    });
    return ingredient;
  }
}
