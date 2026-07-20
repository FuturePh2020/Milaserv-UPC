import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import { PermissionsService } from '../permissions/permissions.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { CreateRoleDto, GrantDto, UpdateRoleDto } from './roles.dto';

const ROLE_INCLUDE = {
  permissions: { include: { permission: true } },
  _count: { select: { users: true } },
} as const;

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly permissions: PermissionsService,
  ) {}

  /** The full permission catalog — drives the role editor matrix. */
  catalog() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { key: 'asc' }] });
  }

  list() {
    return this.prisma.role.findMany({
      where: { deletedAt: null },
      orderBy: [{ isSystem: 'desc' }, { key: 'asc' }],
      include: ROLE_INCLUDE,
    });
  }

  async get(id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null },
      include: ROLE_INCLUDE,
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  private async grantsToRows(grants: GrantDto[]) {
    const perms = await this.prisma.permission.findMany({
      where: { key: { in: grants.map((g) => g.permissionKey) } },
    });
    const byKey = new Map(perms.map((p) => [p.key, p.id]));
    return grants.map((g) => {
      const permissionId = byKey.get(g.permissionKey);
      if (!permissionId) {
        throw new BadRequestException(`Unknown permission: ${g.permissionKey}`);
      }
      return {
        permissionId,
        dataScope: g.dataScope,
        scopeTeamIds: g.dataScope === 'MULTIPLE_TEAMS' ? (g.scopeTeamIds ?? []) : [],
      };
    });
  }

  async create(actor: AuthUser, dto: CreateRoleDto, meta: { ip?: string }) {
    const existing = await this.prisma.role.findUnique({ where: { key: dto.key } });
    if (existing) throw new ConflictException('Role key already exists');

    const rows = await this.grantsToRows(dto.grants ?? []);
    const role = await this.prisma.role.create({
      data: {
        key: dto.key,
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        isSystem: false,
        permissions: { create: rows },
      },
      include: ROLE_INCLUDE,
    });

    await this.permissions.invalidateAll();
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'role.create',
      entityType: 'role',
      entityId: role.id,
      after: { key: dto.key, grants: dto.grants },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'role',
      entityId: role.id,
      eventType: 'created',
      actorId: actor.userId,
    });
    return role;
  }

  async update(actor: AuthUser, id: string, dto: UpdateRoleDto, meta: { ip?: string }) {
    const before = await this.get(id);

    const rows = dto.grants ? await this.grantsToRows(dto.grants) : undefined;
    const role = await this.prisma.$transaction(async (tx) => {
      if (rows) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: rows.map((r) => ({ ...r, roleId: id })) });
      }
      return tx.role.update({
        where: { id },
        data: { nameAr: dto.nameAr, nameEn: dto.nameEn },
        include: ROLE_INCLUDE,
      });
    });

    await this.permissions.invalidateAll();
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'role.update',
      entityType: 'role',
      entityId: id,
      before: {
        nameAr: before.nameAr,
        nameEn: before.nameEn,
        grants: before.permissions.map((p) => ({
          permissionKey: p.permission.key,
          dataScope: p.dataScope,
        })),
      },
      after: dto,
      ...meta,
    });
    await this.timeline.record({
      entityType: 'role',
      entityId: id,
      eventType: 'updated',
      actorId: actor.userId,
      payload: dto,
    });
    return role;
  }

  async archive(actor: AuthUser, id: string, meta: { ip?: string }) {
    const role = await this.get(id);
    // System roles come from the blueprint (§6) — they can be re-scoped but
    // never deleted.
    if (role.isSystem) throw new BadRequestException('System roles cannot be deleted');
    if (role._count.users > 0) {
      throw new ConflictException('Unassign this role from its users first');
    }

    await this.prisma.role.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.permissions.invalidateAll();
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'role.archive',
      entityType: 'role',
      entityId: id,
      before: { key: role.key },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'role',
      entityId: id,
      eventType: 'archived',
      actorId: actor.userId,
    });
  }
}
