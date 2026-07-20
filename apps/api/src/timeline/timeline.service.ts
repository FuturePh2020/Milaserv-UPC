import { Injectable } from "@nestjs/common";
import { EventSource } from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";

export interface RecordTimelineEventInput {
  entityType: string;
  entityId: string;
  eventType: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  source?: EventSource;
  ipAddress?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

/**
 * One generic, append-only event log surfaced as a human-readable timeline
 * on Lead/Order/Customer/Agent/Call detail pages (spec section 18). Records
 * are never updated or deleted by application code — there is intentionally
 * no update/delete method here.
 */
@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordTimelineEventInput) {
    return this.prisma.timelineEvent.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        eventType: input.eventType,
        actorUserId: input.actorUserId ?? undefined,
        actorRole: input.actorRole ?? undefined,
        previousValue: (input.previousValue ?? undefined) as any,
        newValue: (input.newValue ?? undefined) as any,
        source: input.source ?? EventSource.SYSTEM,
        ipAddress: input.ipAddress,
        notes: input.notes,
        metadata: (input.metadata ?? {}) as any,
      },
    });
  }

  async forEntity(entityType: string, entityId: string) {
    return this.prisma.timelineEvent.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }
}
