import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type {
  AssignCapabilityDto,
  CreateCapabilityDto,
  CreateServiceAreaDto,
  UpdateServiceAreaDto,
  UpsertSpecialHoursDto,
  UpsertWeeklyHoursDto,
} from './branch-extensions.dto';

/**
 * Phase 6 §7/§8/§10 — Branch operational extensions consumed by the
 * fulfillment engine's Stage 3 (operational eligibility): weekly/
 * special hours, service areas, and capability assignments. Kept
 * separate from BranchesService (which owns the Branch record itself
 * and the locator), mirroring how BranchImportService is split out.
 */
@Injectable()
export class BranchExtensionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async assertBranchExists(branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, deletedAt: null } });
    if (!branch) throw new NotFoundException('Branch not found');
  }

  // ── Weekly hours ─────────────────────────────────────────────────────

  listWeeklyHours(branchId: string) {
    return this.prisma.branchWorkingHours.findMany({
      where: { branchId, active: true },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async upsertWeeklyHours(
    actor: AuthUser,
    branchId: string,
    dto: UpsertWeeklyHoursDto,
    meta: { ip?: string },
  ) {
    await this.assertBranchExists(branchId);
    const existing = await this.prisma.branchWorkingHours.findFirst({
      where: { branchId, dayOfWeek: dto.dayOfWeek, active: true },
    });
    const data = {
      opensAt: dto.opensAt ?? null,
      closesAt: dto.closesAt ?? null,
      secondShiftOpensAt: dto.secondShiftOpensAt ?? null,
      secondShiftClosesAt: dto.secondShiftClosesAt ?? null,
      isClosed: dto.isClosed ?? false,
    };
    const row = existing
      ? await this.prisma.branchWorkingHours.update({ where: { id: existing.id }, data })
      : await this.prisma.branchWorkingHours.create({
          data: { branchId, dayOfWeek: dto.dayOfWeek, ...data },
        });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'branch.weekly_hours_set',
      entityType: 'branch',
      entityId: branchId,
      after: dto,
      ...meta,
    });
    return row;
  }

  // ── Special hours ────────────────────────────────────────────────────

  listSpecialHours(branchId: string) {
    return this.prisma.branchSpecialHours.findMany({
      where: { branchId, active: true },
      orderBy: { date: 'asc' },
    });
  }

  async upsertSpecialHours(
    actor: AuthUser,
    branchId: string,
    dto: UpsertSpecialHoursDto,
    meta: { ip?: string },
  ) {
    await this.assertBranchExists(branchId);
    const date = new Date(dto.date);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid date');
    const row = await this.prisma.branchSpecialHours.upsert({
      where: { branchId_date: { branchId, date } },
      update: {
        opensAt: dto.opensAt ?? null,
        closesAt: dto.closesAt ?? null,
        isClosed: dto.isClosed ?? false,
        reason: dto.reason ?? null,
        active: true,
      },
      create: {
        branchId,
        date,
        opensAt: dto.opensAt ?? null,
        closesAt: dto.closesAt ?? null,
        isClosed: dto.isClosed ?? false,
        reason: dto.reason ?? null,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'branch.special_hours_set',
      entityType: 'branch',
      entityId: branchId,
      after: dto,
      ...meta,
    });
    return row;
  }

  // ── Service areas ────────────────────────────────────────────────────

  listServiceAreas(branchId: string) {
    return this.prisma.branchServiceArea.findMany({
      where: { branchId },
      include: { city: true, district: true },
      orderBy: { priority: 'desc' },
    });
  }

  async createServiceArea(
    actor: AuthUser,
    branchId: string,
    dto: CreateServiceAreaDto,
    meta: { ip?: string },
  ) {
    await this.assertBranchExists(branchId);
    if (dto.serviceAreaType === 'CITY' && !dto.cityId) {
      throw new BadRequestException('cityId is required for a CITY service area');
    }
    if (dto.serviceAreaType === 'DISTRICT' && !dto.districtId) {
      throw new BadRequestException('districtId is required for a DISTRICT service area');
    }
    if (
      dto.serviceAreaType === 'RADIUS' &&
      (dto.radiusKm == null || dto.centerLatitude == null || dto.centerLongitude == null)
    ) {
      throw new BadRequestException('radiusKm, centerLatitude and centerLongitude are required for a RADIUS service area');
    }
    const area = await this.prisma.branchServiceArea.create({
      data: { branchId, ...dto },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'branch.service_area_create',
      entityType: 'branch_service_area',
      entityId: area.id,
      after: dto,
      ...meta,
    });
    return area;
  }

  async updateServiceArea(
    actor: AuthUser,
    branchId: string,
    id: string,
    dto: UpdateServiceAreaDto,
    meta: { ip?: string },
  ) {
    const before = await this.prisma.branchServiceArea.findFirst({ where: { id, branchId } });
    if (!before) throw new NotFoundException('Service area not found');
    const area = await this.prisma.branchServiceArea.update({ where: { id }, data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'branch.service_area_update',
      entityType: 'branch_service_area',
      entityId: id,
      before,
      after: dto,
      ...meta,
    });
    return area;
  }

  // ── Capabilities ─────────────────────────────────────────────────────

  listCapabilities() {
    return this.prisma.branchCapability.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
  }

  async createCapability(actor: AuthUser, dto: CreateCapabilityDto, meta: { ip?: string }) {
    const capability = await this.prisma.branchCapability.create({ data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'branch.capability_create',
      entityType: 'branch_capability',
      entityId: capability.id,
      after: dto,
      ...meta,
    });
    return capability;
  }

  listBranchCapabilities(branchId: string) {
    return this.prisma.branchCapabilityAssignment.findMany({
      where: { branchId, active: true },
      include: { capability: true },
    });
  }

  async assignCapability(
    actor: AuthUser,
    branchId: string,
    dto: AssignCapabilityDto,
    meta: { ip?: string },
  ) {
    await this.assertBranchExists(branchId);
    const capability = await this.prisma.branchCapability.findUnique({ where: { id: dto.capabilityId } });
    if (!capability) throw new BadRequestException('Unknown capabilityId');
    const assignment = await this.prisma.branchCapabilityAssignment.upsert({
      where: { branchId_capabilityId: { branchId, capabilityId: dto.capabilityId } },
      update: { active: true },
      create: { branchId, capabilityId: dto.capabilityId },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'branch.capability_assign',
      entityType: 'branch',
      entityId: branchId,
      after: dto,
      ...meta,
    });
    return assignment;
  }

  async unassignCapability(
    actor: AuthUser,
    branchId: string,
    capabilityId: string,
    meta: { ip?: string },
  ) {
    const assignment = await this.prisma.branchCapabilityAssignment.findUnique({
      where: { branchId_capabilityId: { branchId, capabilityId } },
    });
    if (!assignment) throw new NotFoundException('Capability not assigned to this branch');
    await this.prisma.branchCapabilityAssignment.update({
      where: { id: assignment.id },
      data: { active: false },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'branch.capability_unassign',
      entityType: 'branch',
      entityId: branchId,
      before: { capabilityId },
      ...meta,
    });
  }
}
