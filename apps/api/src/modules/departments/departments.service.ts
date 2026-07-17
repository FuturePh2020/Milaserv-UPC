import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import type { RequestScope } from '../permissions/scope';
import type { AuthUser } from '../auth/current-user.decorator';
import type { PaginationQuery } from '../../core/pagination';
import { skipTake, toPage } from '../../core/pagination';
import type { CreateDepartmentDto, UpdateDepartmentDto } from './departments.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
  ) {}

  /** Translate the resolved data scope (§6.1) into a where-filter. */
  private scopeWhere(scope: RequestScope): Prisma.DepartmentWhereInput {
    switch (scope.scope) {
      case 'ALL_DATA':
        return {};
      case 'DEPARTMENT':
      case 'MULTIPLE_TEAMS':
      case 'MY_TEAM':
      case 'MY_RECORDS':
      case 'BRANCH': // BRANCH/PARTNER have no org mapping until Phase 2+ masters exist
      case 'PARTNER':
        return scope.context.departmentId ? { id: scope.context.departmentId } : { id: 'none' };
    }
  }

  async list(scope: RequestScope, q: PaginationQuery) {
    const where: Prisma.DepartmentWhereInput = { deletedAt: null, ...this.scopeWhere(scope) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.department.findMany({
        where,
        orderBy: { code: 'asc' },
        include: { _count: { select: { teams: { where: { deletedAt: null } } } } },
        ...skipTake(q),
      }),
      this.prisma.department.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  async get(scope: RequestScope, id: string) {
    const dept = await this.prisma.department.findFirst({
      where: { id, deletedAt: null, ...this.scopeWhere(scope) },
      include: { teams: { where: { deletedAt: null } } },
    });
    if (!dept) throw new NotFoundException('Department not found');
    return dept;
  }

  async create(actor: AuthUser, dto: CreateDepartmentDto, meta: { ip?: string }) {
    const existing = await this.prisma.department.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Department code already exists');

    const dept = await this.prisma.department.create({ data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'department.create',
      entityType: 'department',
      entityId: dept.id,
      after: dto,
      ...meta,
    });
    await this.timeline.record({
      entityType: 'department',
      entityId: dept.id,
      eventType: 'created',
      actorId: actor.userId,
    });
    return dept;
  }

  async update(actor: AuthUser, id: string, dto: UpdateDepartmentDto, meta: { ip?: string }) {
    const before = await this.prisma.department.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Department not found');

    const dept = await this.prisma.department.update({ where: { id }, data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'department.update',
      entityType: 'department',
      entityId: id,
      before: { nameAr: before.nameAr, nameEn: before.nameEn, status: before.status },
      after: dto,
      ...meta,
    });
    await this.timeline.record({
      entityType: 'department',
      entityId: id,
      eventType: 'updated',
      actorId: actor.userId,
      payload: dto,
    });
    return dept;
  }

  async archive(actor: AuthUser, id: string, meta: { ip?: string }) {
    const dept = await this.prisma.department.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { teams: { where: { deletedAt: null } } } } },
    });
    if (!dept) throw new NotFoundException('Department not found');
    if (dept._count.teams > 0) {
      throw new ConflictException('Archive or move its teams first');
    }

    await this.prisma.department.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'department.archive',
      entityType: 'department',
      entityId: id,
      before: { code: dept.code },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'department',
      entityId: id,
      eventType: 'archived',
      actorId: actor.userId,
    });
  }
}
