import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { skipTake, toPage } from '../../core/pagination';
import { SettingsService } from '../settings/settings.service';
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

    const candidates = await this.prisma.branch.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        latitude: { not: null },
        longitude: { not: null },
      },
      include: { branchType: true },
    });

    const now = new Date();
    const ranked = candidates
      .map((b) => ({ branch: b, distanceKm: haversineKm(q.lat, q.lng, b.latitude!, b.longitude!) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, maxResults)
      .map(({ branch, distanceKm }) => {
        const open = isOpen(branch.workingHours, now);
        let deliveryEtaMinutes: number | null = null;
        let deliveryUnavailableReason: string | null = null;
        if (branch.deliveryCovered !== true) deliveryUnavailableReason = 'NOT_COVERED';
        else if (distanceKm > maxKm) deliveryUnavailableReason = 'OUT_OF_RANGE';
        else if (!open) deliveryUnavailableReason = 'CLOSED';
        else deliveryEtaMinutes = Math.round(baseMinutes + distanceKm * minutesPerKm);
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

    return { at: { lat: q.lat, lng: q.lng }, results: ranked };
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

/** Working hours { from, to } — absent = always open; overnight supported (G6). */
function isOpen(workingHours: unknown, now: Date): boolean {
  const wh = workingHours as { from?: string; to?: string } | null;
  if (!wh?.from || !wh?.to) return true;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const parse = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const from = parse(wh.from);
  const to = parse(wh.to);
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}
