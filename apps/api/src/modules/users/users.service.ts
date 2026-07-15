import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import type { Env } from '../../core/config/env';
import { ENV } from '../../core/config/config.module';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import { PermissionsService } from '../permissions/permissions.service';
import type { RequestScope } from '../permissions/scope';
import type { AuthUser } from '../auth/current-user.decorator';
import { skipTake, toPage } from '../../core/pagination';
import type {
  CreateUserDto,
  ListUsersQueryDto,
  SetUserRolesDto,
  SetUserStatusDto,
  UpdateUserDto,
} from './users.dto';

const USER_SELECT = {
  id: true,
  email: true,
  nameAr: true,
  nameEn: true,
  phone: true,
  status: true,
  lastSignInAt: true,
  mustChangePassword: true,
  createdAt: true,
  department: { select: { id: true, code: true, nameAr: true, nameEn: true } },
  roles: { select: { role: { select: { id: true, key: true, nameAr: true, nameEn: true } } } },
  teams: {
    select: { role: true, team: { select: { id: true, nameAr: true, nameEn: true } } },
  },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly permissions: PermissionsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Translate the resolved data scope (§6.1) into a user where-filter. */
  private scopeWhere(scope: RequestScope): Prisma.UserWhereInput {
    switch (scope.scope) {
      case 'ALL_DATA':
        return {};
      case 'DEPARTMENT':
        return scope.context.departmentId
          ? { departmentId: scope.context.departmentId }
          : { id: scope.context.userId };
      case 'MULTIPLE_TEAMS':
        return { teams: { some: { teamId: { in: scope.teamIds ?? [] } } } };
      case 'MY_TEAM':
        return scope.context.teamIds.length
          ? { teams: { some: { teamId: { in: scope.context.teamIds } } } }
          : { id: scope.context.userId };
      case 'MY_RECORDS':
      // BRANCH/PARTNER inactive until Phase 2+ masters exist:
      case 'BRANCH':
      case 'PARTNER':
        return { id: scope.context.userId };
    }
  }

  async list(scope: RequestScope, q: ListUsersQueryDto) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...this.scopeWhere(scope),
      ...(q.status ? { status: q.status } : {}),
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.q
        ? {
            OR: [
              { email: { contains: q.q, mode: 'insensitive' } },
              { nameAr: { contains: q.q, mode: 'insensitive' } },
              { nameEn: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { createdAt: 'desc' },
        ...skipTake(q),
      }),
      this.prisma.user.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  async get(scope: RequestScope, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, ...this.scopeWhere(scope) },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(actor: AuthUser, scope: RequestScope, dto: CreateUserDto, meta: { ip?: string }) {
    if (dto.temporaryPassword.length < this.env.PASSWORD_MIN_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${this.env.PASSWORD_MIN_LENGTH} characters`,
      );
    }
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    // Assigning roles at creation requires the dedicated permission (§19.2).
    if (dto.roleIds?.length && !scope.context.permissions['user.assign_roles']) {
      throw new ForbiddenException('Missing permission: user.assign_roles');
    }
    if (dto.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, deletedAt: null },
      });
      if (!dept) throw new NotFoundException('Department not found');
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await argon2.hash(dto.temporaryPassword),
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        phone: dto.phone,
        departmentId: dto.departmentId,
        mustChangePassword: true,
        ...(dto.roleIds?.length
          ? { roles: { create: dto.roleIds.map((roleId) => ({ roleId })) } }
          : {}),
      },
      select: USER_SELECT,
    });

    await this.permissions.invalidateAll();
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      after: { email: dto.email, departmentId: dto.departmentId, roleIds: dto.roleIds },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'user',
      entityId: user.id,
      eventType: 'created',
      actorId: actor.userId,
    });
    return user;
  }

  async update(
    actor: AuthUser,
    scope: RequestScope,
    id: string,
    dto: UpdateUserDto,
    meta: { ip?: string },
  ) {
    const before = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, ...this.scopeWhere(scope) },
    });
    if (!before) throw new NotFoundException('User not found');

    if (dto.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, deletedAt: null },
      });
      if (!dept) throw new NotFoundException('Department not found');
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: dto,
      select: USER_SELECT,
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      before: {
        nameAr: before.nameAr,
        nameEn: before.nameEn,
        phone: before.phone,
        departmentId: before.departmentId,
      },
      after: dto,
      ...meta,
    });
    await this.timeline.record({
      entityType: 'user',
      entityId: id,
      eventType: 'updated',
      actorId: actor.userId,
      payload: dto,
    });
    return user;
  }

  async setStatus(
    actor: AuthUser,
    scope: RequestScope,
    id: string,
    dto: SetUserStatusDto,
    meta: { ip?: string },
  ) {
    if (id === actor.userId) {
      throw new BadRequestException('You cannot change your own status');
    }
    const before = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, ...this.scopeWhere(scope) },
    });
    if (!before) throw new NotFoundException('User not found');

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.user.update({ where: { id }, data: { status: dto.status } }),
    ];
    if (dto.status === 'INACTIVE') {
      // Deactivation locks the user out immediately, not at token expiry.
      ops.push(
        this.prisma.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      );
    }
    await this.prisma.$transaction(ops);

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: dto.status === 'INACTIVE' ? 'user.deactivate' : 'user.activate',
      entityType: 'user',
      entityId: id,
      before: { status: before.status },
      after: { status: dto.status },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'user',
      entityId: id,
      eventType: dto.status === 'INACTIVE' ? 'deactivated' : 'activated',
      actorId: actor.userId,
    });
    return this.get(scope, id);
  }

  async setRoles(
    actor: AuthUser,
    scope: RequestScope,
    id: string,
    dto: SetUserRolesDto,
    meta: { ip?: string },
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, ...this.scopeWhere(scope) },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException('User not found');

    const roles = await this.prisma.role.findMany({
      where: { id: { in: dto.roleIds }, deletedAt: null },
    });
    if (roles.length !== dto.roleIds.length) {
      throw new BadRequestException('One or more roles do not exist');
    }

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({
        data: dto.roleIds.map((roleId) => ({ userId: id, roleId })),
      }),
    ]);
    await this.permissions.invalidateAll();

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'user.roles_change',
      entityType: 'user',
      entityId: id,
      before: { roles: user.roles.map((r) => r.role.key) },
      after: { roles: roles.map((r) => r.key) },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'user',
      entityId: id,
      eventType: 'roles_changed',
      actorId: actor.userId,
      payload: { roles: roles.map((r) => r.key) },
    });
    return this.get(scope, id);
  }
}
