import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface TimelineEntry {
  entityType: string;
  entityId: string;
  eventType: string;
  actorId?: string | null;
  payload?: unknown;
}

/**
 * Timeline Engine foundation (blueprint §8): a unified, append-only event
 * history for any entity. Ticketing (§9.12) and later modules plug into the
 * same (entityType, entityId) stream without schema changes.
 */
@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: TimelineEntry): Promise<void> {
    await this.prisma.timelineEvent.create({
      data: {
        entityType: entry.entityType,
        entityId: entry.entityId,
        eventType: entry.eventType,
        actorId: entry.actorId ?? null,
        payload: (entry.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async forEntity(entityType: string, entityId: string) {
    return this.prisma.timelineEvent.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
