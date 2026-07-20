import { Controller, Get, Query } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PermissionScope } from '../permissions/permission-scope.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import type { RequestScope } from '../permissions/scope';
import { skipTake, toPage } from '../../core/pagination';
import { ListAuditQueryDto } from './audit.dto';

@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Scoped actor filter (ADR-010): non-ALL_DATA viewers only see actions
   * performed by actors inside their scope; system entries (actorId null)
   * are visible only at ALL_DATA.
   */
  private async actorFilter(scope: RequestScope): Promise<Prisma.AuditLogWhereInput> {
    switch (scope.scope) {
      case 'ALL_DATA':
        return {};
      case 'DEPARTMENT': {
        if (!scope.context.departmentId) return { actorId: scope.context.userId };
        const users = await this.prisma.user.findMany({
          where: { departmentId: scope.context.departmentId },
          select: { id: true },
        });
        return { actorId: { in: users.map((u) => u.id) } };
      }
      case 'MY_TEAM':
      case 'MULTIPLE_TEAMS': {
        const teamIds =
          scope.scope === 'MULTIPLE_TEAMS' ? (scope.teamIds ?? []) : scope.context.teamIds;
        if (teamIds.length === 0) return { actorId: scope.context.userId };
        const users = await this.prisma.user.findMany({
          where: { teams: { some: { teamId: { in: teamIds } } } },
          select: { id: true },
        });
        return { actorId: { in: users.map((u) => u.id) } };
      }
      case 'MY_RECORDS':
      case 'BRANCH': // BRANCH/PARTNER inactive until Phase 2+ masters exist
      case 'PARTNER':
        return { actorId: scope.context.userId };
    }
  }

  /** Read-only audit query (§19.2 "View Audit"). There is no write API. */
  @RequirePermission('audit.view')
  @Get()
  async list(@PermissionScope() scope: RequestScope, @Query() q: ListAuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...(await this.actorFilter(scope)),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return toPage(items, total, q);
  }
}
