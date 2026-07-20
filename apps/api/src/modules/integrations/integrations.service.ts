import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { IntegrationOperation, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { skipTake, toPage } from '../../core/pagination';
import type { PaginationQuery } from '../../core/pagination';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../auth/current-user.decorator';

const HTTP_TIMEOUT_MS = 10_000;

/** Applies a successful operation's response (OCR spec I1). Runs inside the
 *  attempt: a throwing handler fails the operation so it retries normally. */
export type IntegrationSuccessHandler = (
  op: IntegrationOperation,
  response: unknown,
) => Promise<void>;

/**
 * Integration Engine foundation (blueprint §8, §21.1) delivering the §13
 * resilience note: callers enqueue and never block on the external system;
 * failures retry with exponential backoff; exhausted operations go DEAD and
 * alert the Integration Monitor + platform admins (§22 Availability).
 */
@Injectable()
export class IntegrationsService {
  private readonly handlers = new Map<string, IntegrationSuccessHandler>();

  /** Response-consuming integrations register here (one per key). */
  registerHandler(integrationKey: string, handler: IntegrationSuccessHandler) {
    this.handlers.set(integrationKey, handler);
  }
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  /** Fire-and-forget from the caller's perspective (§22). */
  async enqueue(input: {
    integrationKey: string;
    operation: string;
    payload: Prisma.InputJsonValue;
  }): Promise<IntegrationOperation> {
    const op = await this.prisma.integrationOperation.create({
      data: {
        integrationKey: input.integrationKey,
        operation: input.operation,
        payload: input.payload,
      },
    });
    await this.timeline.record({
      entityType: 'integration_operation',
      entityId: op.id,
      eventType: 'enqueued',
      payload: { integrationKey: op.integrationKey, operation: op.operation },
    });
    return op;
  }

  /** Retry-queue pass — invoked by the sweeper (and directly by tests). */
  async processDue(now = new Date()) {
    const due = await this.prisma.integrationOperation.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] }, nextRetryAt: { lte: now } },
      orderBy: { nextRetryAt: 'asc' },
      take: 50,
    });
    const result = { processed: due.length, succeeded: 0, failed: 0, dead: 0 };
    for (const op of due) {
      const outcome = await this.attempt(op, now);
      result[outcome] += 1;
    }
    return result;
  }

  private async attempt(
    op: IntegrationOperation,
    now: Date,
  ): Promise<'succeeded' | 'failed' | 'dead'> {
    const maxAttempts = Number(await this.settings.resolve('integrations.retry.max_attempts'));
    const baseDelay = Number(await this.settings.resolve('integrations.retry.base_delay_seconds'));
    const attempts = op.attempts + 1;

    try {
      const response = await this.execute(op);
      const handler = this.handlers.get(op.integrationKey);
      if (handler) await handler(op, response);
      await this.prisma.integrationOperation.update({
        where: { id: op.id },
        data: { status: 'SUCCEEDED', attempts, succeededAt: now, lastError: null },
      });
      await this.timeline.record({
        entityType: 'integration_operation',
        entityId: op.id,
        eventType: 'succeeded',
        payload: { attempts },
      });
      return 'succeeded';
    } catch (e) {
      const lastError = e instanceof Error ? e.message : String(e);
      if (attempts >= maxAttempts) {
        await this.prisma.integrationOperation.update({
          where: { id: op.id },
          data: { status: 'DEAD', attempts, lastError },
        });
        await this.timeline.record({
          entityType: 'integration_operation',
          entityId: op.id,
          eventType: 'dead_lettered',
          payload: { attempts, lastError },
        });
        await this.alertAdmins(op, lastError);
        return 'dead';
      }
      // Exponential backoff: base × 2^(attempts-1) (§21.1 Retry Policy).
      const delayMs = baseDelay * 1000 * 2 ** (attempts - 1);
      await this.prisma.integrationOperation.update({
        where: { id: op.id },
        data: {
          status: 'FAILED',
          attempts,
          lastError,
          nextRetryAt: new Date(now.getTime() + delayMs),
        },
      });
      return 'failed';
    }
  }

  /** §21.1: Timeout + Error Mapping. The connector fills the endpoint (ADR-009).
   *  Returns the parsed response body for registered success handlers. */
  private async execute(op: IntegrationOperation): Promise<unknown> {
    const endpoint = String(
      await this.settings.resolve(`integrations.${op.integrationKey}.endpoint`).catch(() => ''),
    );
    if (!endpoint) throw new Error('Integration endpoint not configured');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: op.operation, payload: op.payload }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Integration endpoint returned HTTP ${res.status}`);
      const text = await res.text();
      try {
        return text ? (JSON.parse(text) as unknown) : null;
      } catch {
        return text;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** §13: "يظهر تنبيه في Integration Monitor" — plus in-app admin alert. */
  private async alertAdmins(op: IntegrationOperation, lastError: string) {
    const admins = await this.prisma.userRole.findMany({
      where: {
        role: { key: { in: ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'INTEGRATION_SUPPORT'] } },
        user: { deletedAt: null, status: 'ACTIVE' },
      },
      select: { userId: true },
    });
    await this.notifications.notifyMany([...new Set(admins.map((a) => a.userId))], {
      type: 'integration.dead',
      titleAr: `فشل نهائي في تكامل ${op.integrationKey}: ${op.operation}`,
      titleEn: `Integration ${op.integrationKey} dead-lettered: ${op.operation}`,
      payload: { entityType: 'integration_operation', entityId: op.id, lastError },
    });
  }

  // ── Integration Monitor (§13) ──────────────────────────────────────

  async monitor() {
    const grouped = await this.prisma.integrationOperation.groupBy({
      by: ['integrationKey', 'status'],
      _count: { _all: true },
    });
    const keys = [...new Set(grouped.map((g) => g.integrationKey))];
    const integrations = [];
    for (const key of keys) {
      const counts: Record<string, number> = {};
      for (const g of grouped.filter((x) => x.integrationKey === key)) {
        counts[g.status] = g._count._all;
      }
      const [lastSuccess, lastFailure] = await Promise.all([
        this.prisma.integrationOperation.findFirst({
          where: { integrationKey: key, status: 'SUCCEEDED' },
          orderBy: { succeededAt: 'desc' },
          select: { succeededAt: true },
        }),
        this.prisma.integrationOperation.findFirst({
          where: { integrationKey: key, status: { in: ['FAILED', 'DEAD'] } },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true, lastError: true },
        }),
      ]);
      integrations.push({
        integrationKey: key,
        counts,
        lastSuccessAt: lastSuccess?.succeededAt ?? null,
        lastFailureAt: lastFailure?.updatedAt ?? null,
        lastError: lastFailure?.lastError ?? null,
      });
    }
    return { integrations };
  }

  listOperations(q: PaginationQuery & { status?: string; integrationKey?: string }) {
    const where: Prisma.IntegrationOperationWhereInput = {
      ...(q.status ? { status: q.status as IntegrationOperation['status'] } : {}),
      ...(q.integrationKey ? { integrationKey: q.integrationKey } : {}),
    };
    return this.prisma
      .$transaction([
        this.prisma.integrationOperation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          ...skipTake(q),
        }),
        this.prisma.integrationOperation.count({ where }),
      ])
      .then(([items, total]) => toPage(items, total, q));
  }

  async retry(actor: AuthUser, id: string, meta: { ip?: string }) {
    const op = await this.prisma.integrationOperation.findUnique({ where: { id } });
    if (!op) throw new NotFoundException('Operation not found');
    if (op.status === 'SUCCEEDED' || op.status === 'PENDING') {
      throw new UnprocessableEntityException(`Operation is ${op.status.toLowerCase()}`);
    }
    const updated = await this.prisma.integrationOperation.update({
      where: { id },
      data: { status: 'PENDING', attempts: 0, nextRetryAt: new Date() },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'integration.retry',
      entityType: 'integration_operation',
      entityId: id,
      before: { status: op.status, attempts: op.attempts },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'integration_operation',
      entityId: id,
      eventType: 'manual_retry',
      actorId: actor.userId,
    });
    return updated;
  }
}
