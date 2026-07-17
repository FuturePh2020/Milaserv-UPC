import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import type { RequestScope } from '../permissions/scope';
import type { AuthUser } from '../auth/current-user.decorator';
import type { PaginationQuery } from '../../core/pagination';
import { skipTake, toPage } from '../../core/pagination';
import type { AddMemberDto, CreateTeamDto, UpdateTeamDto } from './teams.dto';

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Translate the resolved data scope (§6.1) into a team where-filter. */
  private scopeWhere(scope: RequestScope): Prisma.TeamWhereInput {
    switch (scope.scope) {
      case 'ALL_DATA':
        return {};
      case 'DEPARTMENT':
        return scope.context.departmentId
          ? { departmentId: scope.context.departmentId }
          : { id: 'none' };
      case 'MULTIPLE_TEAMS':
        return { id: { in: scope.teamIds ?? [] } };
      case 'MY_TEAM':
      case 'MY_RECORDS':
      case 'BRANCH': // BRANCH/PARTNER inactive until Phase 2+ masters exist
      case 'PARTNER':
        return { id: { in: scope.context.teamIds } };
    }
  }

  /** Throws unless the team is inside the actor's resolved scope. */
  private async assertInScope(scope: RequestScope, teamId: string) {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, deletedAt: null, ...this.scopeWhere(scope) },
    });
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  async list(scope: RequestScope, q: PaginationQuery) {
    const where: Prisma.TeamWhereInput = { deletedAt: null, ...this.scopeWhere(scope) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        where,
        orderBy: { nameEn: 'asc' },
        include: {
          department: { select: { id: true, code: true, nameAr: true, nameEn: true } },
          _count: { select: { members: true } },
        },
        ...skipTake(q),
      }),
      this.prisma.team.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  async get(scope: RequestScope, id: string) {
    const team = await this.prisma.team.findFirst({
      where: { id, deletedAt: null, ...this.scopeWhere(scope) },
      include: {
        department: { select: { id: true, code: true, nameAr: true, nameEn: true } },
        members: {
          include: {
            user: { select: { id: true, email: true, nameAr: true, nameEn: true, status: true } },
          },
        },
      },
    });
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  async create(actor: AuthUser, scope: RequestScope, dto: CreateTeamDto, meta: { ip?: string }) {
    // DEPARTMENT-scoped managers may only create teams inside their department.
    if (scope.scope === 'DEPARTMENT' && dto.departmentId !== scope.context.departmentId) {
      throw new ForbiddenException('Cannot create a team outside your department');
    }
    const dept = await this.prisma.department.findFirst({
      where: { id: dto.departmentId, deletedAt: null },
    });
    if (!dept) throw new NotFoundException('Department not found');

    const team = await this.prisma.team.create({ data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'team.create',
      entityType: 'team',
      entityId: team.id,
      after: dto,
      ...meta,
    });
    await this.timeline.record({
      entityType: 'team',
      entityId: team.id,
      eventType: 'created',
      actorId: actor.userId,
    });
    return team;
  }

  async update(
    actor: AuthUser,
    scope: RequestScope,
    id: string,
    dto: UpdateTeamDto,
    meta: { ip?: string },
  ) {
    const before = await this.assertInScope(scope, id);
    if (dto.departmentId) {
      if (scope.scope === 'DEPARTMENT' && dto.departmentId !== scope.context.departmentId) {
        throw new ForbiddenException('Cannot move a team outside your department');
      }
      const dept = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, deletedAt: null },
      });
      if (!dept) throw new NotFoundException('Department not found');
    }

    const team = await this.prisma.team.update({ where: { id }, data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'team.update',
      entityType: 'team',
      entityId: id,
      before: {
        nameAr: before.nameAr,
        nameEn: before.nameEn,
        departmentId: before.departmentId,
        status: before.status,
      },
      after: dto,
      ...meta,
    });
    await this.timeline.record({
      entityType: 'team',
      entityId: id,
      eventType: 'updated',
      actorId: actor.userId,
      payload: dto,
    });
    return team;
  }

  async archive(actor: AuthUser, scope: RequestScope, id: string, meta: { ip?: string }) {
    const team = await this.assertInScope(scope, id);
    await this.prisma.team.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
    // Membership rows remain as history; effective scopes must refresh.
    await this.permissions.invalidateAll();
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'team.archive',
      entityType: 'team',
      entityId: id,
      before: { nameEn: team.nameEn },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'team',
      entityId: id,
      eventType: 'archived',
      actorId: actor.userId,
    });
  }

  async addMember(
    actor: AuthUser,
    scope: RequestScope,
    teamId: string,
    dto: AddMemberDto,
    meta: { ip?: string },
  ) {
    await this.assertInScope(scope, teamId);
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: dto.userId } },
    });
    if (existing) throw new ConflictException('User is already a member of this team');

    const member = await this.prisma.teamMember.create({
      data: { teamId, userId: dto.userId, role: dto.role },
    });
    await this.permissions.invalidateAll(); // team membership affects MY_TEAM scopes
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'team.member_add',
      entityType: 'team',
      entityId: teamId,
      after: { userId: dto.userId, role: dto.role },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'team',
      entityId: teamId,
      eventType: 'member_added',
      actorId: actor.userId,
      payload: { userId: dto.userId, role: dto.role },
    });
    await this.timeline.record({
      entityType: 'user',
      entityId: dto.userId,
      eventType: 'joined_team',
      actorId: actor.userId,
      payload: { teamId, role: dto.role },
    });

    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    await this.notifications.notify({
      userId: dto.userId,
      type: 'team.member_added',
      titleAr: `تمت إضافتك إلى فريق ${team.nameAr}`,
      titleEn: `You were added to team ${team.nameEn}`,
      payload: { entityType: 'team', entityId: teamId, role: dto.role },
    });
    return member;
  }

  async removeMember(
    actor: AuthUser,
    scope: RequestScope,
    teamId: string,
    userId: string,
    meta: { ip?: string },
  ) {
    await this.assertInScope(scope, teamId);
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new NotFoundException('Membership not found');

    await this.prisma.teamMember.delete({ where: { id: member.id } });
    await this.permissions.invalidateAll();
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'team.member_remove',
      entityType: 'team',
      entityId: teamId,
      before: { userId, role: member.role },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'team',
      entityId: teamId,
      eventType: 'member_removed',
      actorId: actor.userId,
      payload: { userId },
    });
    await this.timeline.record({
      entityType: 'user',
      entityId: userId,
      eventType: 'left_team',
      actorId: actor.userId,
      payload: { teamId },
    });
  }
}
