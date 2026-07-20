import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { skipTake, toPage } from '../../core/pagination';
import { SettingsService } from '../settings/settings.service';
import { resolveBranchOpenStatus, type LegacyWorkingHours } from './branch-hours-resolver';
import type {
  CreateBranchDto,
  ListBranchesQueryDto,
  NearestQueryDto,
  UpdateBranchDto,
} from './branches.dto';

/**
 * Minimal Branch Directory (ticketing spec §2, subset of blueprint §16.1).
 * Master data: visible to any holder of branch.view regardless of data scope;
 * BRANCH data-scope filtering activates with partner/branch scoping (Phase 3+).
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly settings: SettingsService,
  ) {}

  types() {
    return this.prisma.branchType.findMany({ where: { active: true }, orderBy: { key: 'asc' } });
  }

  async list(q: ListBranchesQueryDto) {
    const where: Prisma.BranchWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.region ? { region: q.region } : {}),
      ...(q.typeKey ? { branchTypeKey: q.typeKey } : {}),
      ...(q.q
        ? {
            OR: [
              { code: { contains: q.q, mode: 'insensitive' } },
              { nameAr: { contains: q.q, mode: 'insensitive' } },
              { nameEn: { contains: q.q, mode: 'insensitive' } },
              { city: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({
        where,
        include: { branchType: true },
        orderBy: { code: 'asc' },
        ...skipTake(q),
      }),
      this.prisma.branch.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  async get(id: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id, deletedAt: null } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async create(actor: AuthUser, dto: CreateBranchDto, meta: { ip?: string }) {
    const existing = await this.prisma.branch.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Branch code already exists');

    const branch = await this.prisma.branch.create({ data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'branch.create',
      entityType: 'branch',
      entityId: branch.id,
      after: dto,
      ...meta,
    });
    await this.timeline.record({
      entityType: 'branch',
      entityId: branch.id,
      eventType: 'created',
      actorId: actor.userId,
    });
    return branch;
  }

  async update(actor: AuthUser, id: string, dto: UpdateBranchDto, meta: { ip?: string }) {
    const before = await this.get(id);
    const branch = await this.prisma.branch.update({ where: { id }, data: dto });

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'branch.update',
      entityType: 'branch',
      entityId: id,
      before: {
        nameAr: before.nameAr,
        nameEn: before.nameEn,
        supervisorName: before.supervisorName,
        supervisorEmail: before.supervisorEmail,
        supervisorPhone: before.supervisorPhone,
        status: before.status,
      },
      after: dto,
      ...meta,
    });
    // Supervisor changes matter for §9.8 history — record them distinctly.
    if (
      dto.supervisorName !== undefined ||
      dto.supervisorEmail !== undefined ||
      dto.supervisorPhone !== undefined
    ) {
      await this.timeline.record({
        entityType: 'branch',
        entityId: id,
        eventType: 'supervisor_changed',
        actorId: actor.userId,
        payload: {
          from: { name: before.supervisorName, email: before.supervisorEmail },
          to: { name: branch.supervisorName, email: branch.supervisorEmail },
        },
      });
    } else {
      await this.timeline.record({
        entityType: 'branch',
        entityId: id,
        eventType: 'updated',
        actorId: actor.userId,
        payload: dto,
      });
    }
    return branch;
  }

  async archive(actor: AuthUser, id: string, meta: { ip?: string }) {
    const branch = await this.get(id);
    await this.prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'branch.archive',
      entityType: 'branch',
      entityId: id,
      before: { code: branch.code },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'branch',
      entityId: id,
      eventType: 'archived',
      actorId: actor.userId,
    });
  }

  // ── Locator & Delivery Estimator (§16.3, spec G5/G6) ───────────────

  async nearest(q: NearestQueryDto) {
    const [maxResults, baseMinutes, minutesPerKm, maxKm] = await Promise.all([
      this.settings.resolve('branch.locator.max_results').then(Number),
      this.settings.resolve('branch.delivery.base_minutes').then(Number),
      this.settings.resolve('branch.delivery.minutes_per_km').then(Number),
      this.settings.resolve('branch.delivery.max_km').then(Number),
    ]);

    // Phase 6 §5 upgrade: a GiST-indexed earthdistance query narrows
    // ~600+ branches down to `maxResults` inside Postgres — never a
    // full-table scan pulled into Node. `earth_box(...) @>` is the
    // documented index-accelerated pre-filter (bounding box wide enough
    // to cover all of Saudi Arabia); the exact `earth_distance` then
    // orders the pre-filtered set. Falls back to the old full-scan
    // Haversine path if the extension isn't present (e.g. a fresh
    // environment that hasn't run this phase's migration yet).
    const KSA_BOUNDING_RADIUS_METERS = 2_000_000;
    let candidateIdsInOrder: { id: string; distanceKm: number }[];
    try {
      candidateIdsInOrder = await this.prisma.$queryRaw<{ id: string; distanceKm: number }[]>`
        SELECT id, earth_distance(ll_to_earth(${q.lat}, ${q.lng}), ll_to_earth(latitude, longitude)) / 1000.0 AS "distanceKm"
        FROM "Branch"
        WHERE "deletedAt" IS NULL
          AND status = 'ACTIVE'
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND earth_box(ll_to_earth(${q.lat}, ${q.lng}), ${KSA_BOUNDING_RADIUS_METERS}) @> ll_to_earth(latitude, longitude)
        ORDER BY "distanceKm" ASC
        LIMIT ${maxResults}
      `;
    } catch {
      const all = await this.prisma.branch.findMany({
        where: { deletedAt: null, status: 'ACTIVE', latitude: { not: null }, longitude: { not: null } },
        select: { id: true, latitude: true, longitude: true },
      });
      candidateIdsInOrder = all
        .map((b) => ({ id: b.id, distanceKm: haversineKm(q.lat, q.lng, b.latitude!, b.longitude!) }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, maxResults);
    }

    const branchRows = await this.prisma.branch.findMany({
      where: { id: { in: candidateIdsInOrder.map((c) => c.id) } },
      include: { branchType: true, weeklyHours: { where: { active: true } }, specialHours: { where: { active: true } } },
    });
    const branchById = new Map(branchRows.map((b) => [b.id, b]));
    const top = candidateIdsInOrder
      .map((c) => ({ branch: branchById.get(c.id)!, distanceKm: c.distanceKm }))
      .filter((c) => c.branch);

    const now = new Date();

    // §21 Google Maps connector (integrations spec J6): driving distances
    // when configured; straight-line math is always the fallback.
    const driving = await this.drivingDistances(q.lat, q.lng, top);
    const distanceSource = driving ? 'maps' : 'straight_line';

    const ranked = top
      .map(({ branch, distanceKm }) => {
        const road = driving?.get(branch.id);
        return { branch, distanceKm: road?.km ?? distanceKm, driveMinutes: road?.minutes ?? null };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .map(({ branch, distanceKm, driveMinutes }) => {
        const open = resolveBranchOpenStatus(
          branch.workingHours as LegacyWorkingHours | null,
          branch.weeklyHours,
          branch.specialHours,
          now,
        );
        let deliveryEtaMinutes: number | null = null;
        let deliveryUnavailableReason: string | null = null;
        if (branch.deliveryCovered !== true) deliveryUnavailableReason = 'NOT_COVERED';
        else if (distanceKm > maxKm) deliveryUnavailableReason = 'OUT_OF_RANGE';
        else if (!open) deliveryUnavailableReason = 'CLOSED';
        else
          deliveryEtaMinutes = Math.round(
            baseMinutes + (driveMinutes ?? distanceKm * minutesPerKm),
          );
        return {
          id: branch.id,
          code: branch.code,
          nameAr: branch.nameAr,
          nameEn: branch.nameEn,
          city: branch.city,
          district: branch.district,
          region: branch.region,
          addressAr: branch.addressAr,
          addressEn: branch.addressEn,
          phone: branch.phone,
          mapUrl: branch.mapUrl,
          branchType: branch.branchType,
          latitude: branch.latitude,
          longitude: branch.longitude,
          distanceKm: Math.round(distanceKm * 100) / 100,
          open,
          deliveryEtaMinutes,
          deliveryUnavailableReason,
        };
      });

    return { at: { lat: q.lat, lng: q.lng }, distanceSource, results: ranked };
  }

  /** J6: POST origin+destinations to the maps bridge (3s timeout). Returns
   *  null on any failure — the caller falls back to straight-line math. */
  private async drivingDistances(
    lat: number,
    lng: number,
    top: { branch: { id: string; latitude: number | null; longitude: number | null } }[],
  ): Promise<Map<string, { km: number; minutes: number }> | null> {
    const endpoint = String(
      await this.settings.resolve('integrations.maps.endpoint').catch(() => ''),
    );
    if (!endpoint || top.length === 0) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat, lng },
          destinations: top.map(({ branch }) => ({
            id: branch.id,
            lat: branch.latitude,
            lng: branch.longitude,
          })),
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Maps endpoint returned HTTP ${res.status}`);
      const body = (await res.json()) as {
        distances?: { id: string; km: number; minutes: number }[];
      };
      if (!Array.isArray(body.distances) || body.distances.length === 0) return null;
      return new Map(
        body.distances
          .filter((d) => Number.isFinite(d.km) && Number.isFinite(d.minutes))
          .map((d) => [d.id, { km: d.km, minutes: d.minutes }]),
      );
    } catch {
      // Locator must never break because Maps is down (J6) — fall back.
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Great-circle distance — Google Maps integration is the Later upgrade (§21). */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

