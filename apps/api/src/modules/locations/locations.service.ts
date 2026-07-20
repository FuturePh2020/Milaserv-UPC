import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { matchCityByText, matchDistrictByText } from './branch-location-matcher';
import { normalizeLocationArabic, normalizeLocationEnglish } from './location-normalizer';
import type {
  CreateCityDto,
  CreateDistrictDto,
  CreateLocationAliasDto,
  CreateRegionDto,
  UpdateCityDto,
  UpdateDistrictDto,
  UpdateRegionDto,
} from './locations.dto';

/**
 * Phase 6 §5 — Location hierarchy reference CRUD (Region → City →
 * District) plus the Branch-to-hierarchy backfill matcher. Mirrors
 * DicReferenceService's shape: controlled catalogs, every mutation
 * audited, nothing free-text on Branch is ever overwritten — only the
 * additive locationCityId/locationDistrictId pointers are touched.
 */
@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Regions ──────────────────────────────────────────────────────────

  listRegions() {
    return this.prisma.region.findMany({ orderBy: { nameEn: 'asc' } });
  }

  async createRegion(actor: AuthUser, dto: CreateRegionDto, meta: { ip?: string }) {
    const region = await this.prisma.region.create({ data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'location.region_create',
      entityType: 'region',
      entityId: region.id,
      after: dto,
      ...meta,
    });
    return region;
  }

  async updateRegion(actor: AuthUser, id: string, dto: UpdateRegionDto, meta: { ip?: string }) {
    const before = await this.prisma.region.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Region not found');
    const region = await this.prisma.region.update({ where: { id }, data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'location.region_update',
      entityType: 'region',
      entityId: id,
      before,
      after: dto,
      ...meta,
    });
    return region;
  }

  // ── Cities ───────────────────────────────────────────────────────────

  listCities(regionId?: string) {
    return this.prisma.city.findMany({
      where: regionId ? { regionId } : undefined,
      orderBy: { nameEn: 'asc' },
      include: { region: true },
    });
  }

  async createCity(actor: AuthUser, dto: CreateCityDto, meta: { ip?: string }) {
    const region = await this.prisma.region.findUnique({ where: { id: dto.regionId } });
    if (!region) throw new BadRequestException('Unknown regionId');
    const city = await this.prisma.city.create({
      data: {
        code: dto.code,
        regionId: dto.regionId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        normalizedNameEn: normalizeLocationEnglish(dto.nameEn),
        normalizedNameAr: normalizeLocationArabic(dto.nameAr),
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        timezone: dto.timezone ?? null,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'location.city_create',
      entityType: 'city',
      entityId: city.id,
      after: dto,
      ...meta,
    });
    return city;
  }

  async updateCity(actor: AuthUser, id: string, dto: UpdateCityDto, meta: { ip?: string }) {
    const before = await this.prisma.city.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('City not found');
    if (dto.regionId) {
      const region = await this.prisma.region.findUnique({ where: { id: dto.regionId } });
      if (!region) throw new BadRequestException('Unknown regionId');
    }
    const city = await this.prisma.city.update({
      where: { id },
      data: {
        regionId: dto.regionId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        normalizedNameEn: dto.nameEn ? normalizeLocationEnglish(dto.nameEn) : undefined,
        normalizedNameAr: dto.nameAr ? normalizeLocationArabic(dto.nameAr) : undefined,
        latitude: dto.latitude,
        longitude: dto.longitude,
        timezone: dto.timezone,
        active: dto.active,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'location.city_update',
      entityType: 'city',
      entityId: id,
      before,
      after: dto,
      ...meta,
    });
    return city;
  }

  // ── Districts ────────────────────────────────────────────────────────

  listDistricts(cityId?: string) {
    return this.prisma.district.findMany({
      where: cityId ? { cityId } : undefined,
      orderBy: { nameEn: 'asc' },
      include: { city: true },
    });
  }

  async createDistrict(actor: AuthUser, dto: CreateDistrictDto, meta: { ip?: string }) {
    const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
    if (!city) throw new BadRequestException('Unknown cityId');
    const district = await this.prisma.district.create({
      data: {
        code: dto.code,
        cityId: dto.cityId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        normalizedNameEn: normalizeLocationEnglish(dto.nameEn),
        normalizedNameAr: normalizeLocationArabic(dto.nameAr),
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'location.district_create',
      entityType: 'district',
      entityId: district.id,
      after: dto,
      ...meta,
    });
    return district;
  }

  async updateDistrict(actor: AuthUser, id: string, dto: UpdateDistrictDto, meta: { ip?: string }) {
    const before = await this.prisma.district.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('District not found');
    if (dto.cityId) {
      const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
      if (!city) throw new BadRequestException('Unknown cityId');
    }
    const district = await this.prisma.district.update({
      where: { id },
      data: {
        cityId: dto.cityId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        normalizedNameEn: dto.nameEn ? normalizeLocationEnglish(dto.nameEn) : undefined,
        normalizedNameAr: dto.nameAr ? normalizeLocationArabic(dto.nameAr) : undefined,
        latitude: dto.latitude,
        longitude: dto.longitude,
        active: dto.active,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'location.district_update',
      entityType: 'district',
      entityId: id,
      before,
      after: dto,
      ...meta,
    });
    return district;
  }

  // ── Aliases ──────────────────────────────────────────────────────────

  listAliases(entityType?: 'CITY' | 'DISTRICT', entityId?: string) {
    return this.prisma.locationAlias.findMany({
      where: { entityType, entityId },
      orderBy: { alias: 'asc' },
    });
  }

  async createAlias(actor: AuthUser, dto: CreateLocationAliasDto, meta: { ip?: string }) {
    if (dto.entityType === 'CITY') {
      const city = await this.prisma.city.findUnique({ where: { id: dto.entityId } });
      if (!city) throw new BadRequestException('Unknown entityId for CITY alias');
    } else {
      const district = await this.prisma.district.findUnique({ where: { id: dto.entityId } });
      if (!district) throw new BadRequestException('Unknown entityId for DISTRICT alias');
    }
    const normalizedAlias =
      dto.language === 'ar' ? normalizeLocationArabic(dto.alias) : normalizeLocationEnglish(dto.alias);
    const alias = await this.prisma.locationAlias.create({
      data: {
        entityType: dto.entityType,
        entityId: dto.entityId,
        alias: dto.alias,
        normalizedAlias,
        language: dto.language,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'location.alias_create',
      entityType: 'location_alias',
      entityId: alias.id,
      after: dto,
      ...meta,
    });
    return alias;
  }

  // ── Branch backfill ──────────────────────────────────────────────────

  /**
   * Matches every Branch's free-text city/district onto the structured
   * hierarchy — additive only, never touches the free-text columns
   * themselves. Skips branches already MANUALLY_CONFIRMED. Exact
   * normalized-name or alias match only; anything ambiguous or
   * unmatched is flagged NEEDS_REVIEW rather than guessed, mirroring
   * DIC's "never silently overwrite" merge discipline.
   */
  async backfillBranchLocations(
    actor: AuthUser,
    meta: { ip?: string },
  ): Promise<{ autoMatched: number; needsReview: number; unresolved: number; skipped: number }> {
    const [branches, skipped, cities, aliases] = await Promise.all([
      this.prisma.branch.findMany({
        where: { locationMatchStatus: { not: 'MANUALLY_CONFIRMED' }, deletedAt: null },
        select: { id: true, city: true, district: true },
      }),
      this.prisma.branch.count({
        where: { locationMatchStatus: 'MANUALLY_CONFIRMED', deletedAt: null },
      }),
      this.prisma.city.findMany({ where: { active: true } }),
      this.prisma.locationAlias.findMany({ where: { active: true, entityType: 'CITY' } }),
    ]);

    let autoMatched = 0;
    let needsReview = 0;
    let unresolved = 0;

    for (const branch of branches) {
      const cityText = branch.city?.trim();
      if (!cityText) {
        unresolved++;
        continue;
      }
      const matchedCity = matchCityByText(cityText, cities, aliases);
      if (!matchedCity) {
        await this.prisma.branch.update({
          where: { id: branch.id },
          data: { locationMatchStatus: 'NEEDS_REVIEW' },
        });
        needsReview++;
        continue;
      }

      const districtText = branch.district?.trim();
      let matchedDistrictId: string | null = null;
      if (districtText) {
        const districts = await this.prisma.district.findMany({
          where: { cityId: matchedCity.id, active: true },
        });
        matchedDistrictId = matchDistrictByText(districtText, districts)?.id ?? null;
      }

      await this.prisma.branch.update({
        where: { id: branch.id },
        data: {
          locationCityId: matchedCity.id,
          locationDistrictId: matchedDistrictId,
          locationMatchStatus: 'AUTO_MATCHED',
        },
      });
      autoMatched++;
    }

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'location.backfill_branches',
      entityType: 'branch',
      after: { autoMatched, needsReview, unresolved, skipped, totalProcessed: branches.length },
      ...meta,
    });

    return { autoMatched, needsReview, unresolved, skipped };
  }

  /** Data-quality snapshot for the location-hierarchy backfill — read-only. */
  async locationDataQuality() {
    const [total, byStatus, missingCoords] = await Promise.all([
      this.prisma.branch.count({ where: { deletedAt: null } }),
      this.prisma.branch.groupBy({
        by: ['locationMatchStatus'],
        where: { deletedAt: null },
        _count: true,
      }),
      this.prisma.branch.count({
        where: { deletedAt: null, OR: [{ latitude: null }, { longitude: null }] },
      }),
    ]);
    return {
      totalBranches: total,
      byMatchStatus: Object.fromEntries(byStatus.map((r) => [r.locationMatchStatus, r._count])),
      missingCoordinates: missingCoords,
    };
  }
}
