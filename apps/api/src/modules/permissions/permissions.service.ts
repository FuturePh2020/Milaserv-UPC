import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../core/redis/redis.module';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { EffectivePermissions, ResolvedScope } from './scope';
import { SCOPE_RANK } from './scope';

const CACHE_TTL_SECONDS = 60;
const VERSION_KEY = 'perm:version';

/**
 * Identity & Access Engine (blueprint §8): resolves a user's effective
 * permissions from all of their roles, merging duplicate grants to the
 * widest data scope (§19.1).
 *
 * Cached in Redis under a global version: any role/permission mutation bumps
 * the version (one INCR invalidates every user); stale entries expire by TTL.
 */
@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async getEffectivePermissions(userId: string): Promise<EffectivePermissions> {
    const version = (await this.redis.get(VERSION_KEY)) ?? '0';
    const cacheKey = `perm:${version}:${userId}`;

    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as EffectivePermissions;

    const resolved = await this.resolve(userId);
    await this.redis
      .set(cacheKey, JSON.stringify(resolved), 'EX', CACHE_TTL_SECONDS)
      .catch(() => undefined);
    return resolved;
  }

  /** Call after any role/grant/team/user-role mutation. */
  async invalidateAll(): Promise<void> {
    await this.redis.incr(VERSION_KEY).catch(() => undefined);
  }

  private async resolve(userId: string): Promise<EffectivePermissions> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        teams: { select: { teamId: true } },
        roles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
      },
    });

    const permissions: Record<string, ResolvedScope> = {};
    for (const userRole of user.roles) {
      if (userRole.role.deletedAt) continue;
      for (const grant of userRole.role.permissions) {
        const key = grant.permission.key;
        const candidate: ResolvedScope = {
          scope: grant.dataScope,
          ...(grant.dataScope === 'MULTIPLE_TEAMS' ? { teamIds: grant.scopeTeamIds } : {}),
        };
        const existing = permissions[key];
        if (!existing || SCOPE_RANK[candidate.scope] > SCOPE_RANK[existing.scope]) {
          permissions[key] = candidate;
        } else if (
          existing.scope === 'MULTIPLE_TEAMS' &&
          candidate.scope === 'MULTIPLE_TEAMS' &&
          existing.teamIds &&
          candidate.teamIds
        ) {
          // Same scope level: union of the explicitly granted teams.
          existing.teamIds = [...new Set([...existing.teamIds, ...candidate.teamIds])];
        }
      }
    }

    return {
      userId,
      departmentId: user.departmentId,
      teamIds: user.teams.map((t) => t.teamId),
      permissions,
    };
  }
}
