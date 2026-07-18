import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import type { YeastarEventsDto } from './connectors.dto';

/** §21 connector catalog shown on the admin card (integrations spec §3). */
const CONNECTOR_KEYS = ['yeastar', 'ordering', 'ocr', 'dbs', 'email', 'sms', 'maps'] as const;

interface MetricBucket {
  /** date ISO (yyyy-mm-dd) → metricKey → increment */
  [date: string]: Record<string, number>;
}

/**
 * Physical connectors (blueprint §21, integrations spec J1/J2/J7):
 * machine-authenticated inbound webhooks mapped onto existing engines.
 */
@Injectable()
export class ConnectorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** J7: header token must equal the connector's inbound_token setting;
   *  an empty setting disables the endpoint entirely. */
  async assertToken(key: string, header: string | undefined) {
    const token = String(
      await this.settings.resolve(`integrations.${key}.inbound_token`).catch(() => ''),
    );
    if (!token || header !== token) {
      throw new ForbiddenException('Invalid or missing integration token');
    }
  }

  // ── J1: Yeastar call events → §12 YEASTAR metric values ────────────

  async ingestYeastarEvents(dto: YeastarEventsDto, meta: { ip?: string }) {
    const emails = [...new Set(dto.events.map((e) => e.agentEmail.toLowerCase()))];
    const users = await this.prisma.user.findMany({
      where: { email: { in: emails }, deletedAt: null },
      select: { id: true, email: true, teams: { select: { teamId: true }, take: 1 } },
    });
    const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

    // Accumulate increments per user/date, then mirror onto the user's team.
    const perUser = new Map<string, MetricBucket>();
    const perTeam = new Map<string, MetricBucket>();
    const rejected: { index: number; reason: string }[] = [];
    let accepted = 0;

    const add = (
      map: Map<string, MetricBucket>,
      id: string,
      date: string,
      key: string,
      n: number,
    ) => {
      const bucket = map.get(id) ?? {};
      bucket[date] = bucket[date] ?? {};
      bucket[date][key] = (bucket[date][key] ?? 0) + n;
      map.set(id, bucket);
    };

    for (const [index, event] of dto.events.entries()) {
      const user = byEmail.get(event.agentEmail.toLowerCase());
      if (!user) {
        // §26: unknown agents are surfaced, never silently dropped.
        rejected.push({ index, reason: `Unknown agent: ${event.agentEmail}` });
        continue;
      }
      const date = (event.at ? new Date(event.at) : new Date()).toISOString().slice(0, 10);
      const talk = event.talkSeconds ?? 0;

      const increments: Record<string, number> = { total_calls: 1 };
      if (event.direction === 'in') {
        if (event.answered) {
          increments.inbound_calls = 1;
          increments.total_talk_time = talk;
          if (event.queue) {
            increments.queue_calls_answered = 1;
            increments.queue_calls_talk_time = talk;
          }
        } else {
          increments.missed_calls = 1;
          if (event.queue) increments.abandoned_calls = 1;
        }
      } else {
        increments.outbound_calls = 1;
        if (event.answered) {
          increments.outbound_calls_answered = 1;
          increments.outbound_calls_talk_time = talk;
          increments.total_talk_time = talk;
        }
      }

      for (const [key, n] of Object.entries(increments)) {
        if (n === 0) continue;
        add(perUser, user.id, date, key, n);
        const teamId = user.teams[0]?.teamId;
        if (teamId) add(perTeam, teamId, date, key, n);
      }
      accepted++;
    }

    const upserts: Prisma.PrismaPromise<unknown>[] = [];
    const push = (scopeType: 'USER' | 'TEAM', map: Map<string, MetricBucket>) => {
      for (const [scopeId, bucket] of map) {
        for (const [date, metrics] of Object.entries(bucket)) {
          for (const [metricKey, n] of Object.entries(metrics)) {
            upserts.push(
              this.prisma.metricValue.upsert({
                where: {
                  metricDate_scopeType_scopeId_metricKey: {
                    metricDate: new Date(date),
                    scopeType,
                    scopeId,
                    metricKey,
                  },
                },
                update: { value: { increment: n } },
                create: { metricDate: new Date(date), scopeType, scopeId, metricKey, value: n },
              }),
            );
          }
        }
      }
    };
    push('USER', perUser);
    push('TEAM', perTeam);
    if (upserts.length) await this.prisma.$transaction(upserts);

    await this.audit.record({
      actorEmail: 'connector:yeastar',
      action: 'integrations.yeastar_events',
      entityType: 'metric_value',
      after: { accepted, rejected: rejected.length },
      ...meta,
    });
    return { accepted, rejected };
  }

  // ── connector cards for the admin screen ───────────────────────────

  async connectors() {
    const [grouped, settingsMap] = await Promise.all([
      this.prisma.integrationOperation.groupBy({
        by: ['integrationKey', 'status'],
        _count: { _all: true },
      }),
      this.resolveConnectorSettings(),
    ]);

    const cards = [];
    for (const key of CONNECTOR_KEYS) {
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
      cards.push({
        key,
        ...settingsMap[key],
        counts,
        lastSuccessAt: lastSuccess?.succeededAt ?? null,
        lastFailureAt: lastFailure?.updatedAt ?? null,
        lastError: lastFailure?.lastError ?? null,
      });
    }
    return { connectors: cards };
  }

  private async resolveConnectorSettings(): Promise<
    Record<string, { direction: string; configured: boolean; enabled: boolean }>
  > {
    const get = (key: string) => this.settings.resolve(key).catch(() => '');
    const [
      yeastarToken,
      orderingToken,
      orderingEndpoint,
      ocrEndpoint,
      dbsEndpoint,
      dbsEnabled,
      emailEndpoint,
      emailEnabled,
      smsEndpoint,
      smsEnabled,
      mapsEndpoint,
    ] = await Promise.all([
      get('integrations.yeastar.inbound_token'),
      get('integrations.ordering.inbound_token'),
      get('integrations.ordering.endpoint'),
      get('integrations.ocr.endpoint'),
      get('integrations.dbs.endpoint'),
      get('integrations.dbs.enabled'),
      get('integrations.email.endpoint'),
      get('notifications.email_enabled'),
      get('integrations.sms.endpoint'),
      get('integrations.sms.enabled'),
      get('integrations.maps.endpoint'),
    ]);
    const set = (v: unknown) => Boolean(v) && String(v) !== '' && String(v) !== 'false';
    return {
      yeastar: { direction: 'inbound', configured: set(yeastarToken), enabled: set(yeastarToken) },
      ordering: {
        direction: 'both',
        configured: set(orderingToken) || set(orderingEndpoint),
        enabled: set(orderingToken) || set(orderingEndpoint),
      },
      ocr: { direction: 'outbound', configured: set(ocrEndpoint), enabled: set(ocrEndpoint) },
      dbs: { direction: 'outbound', configured: set(dbsEndpoint), enabled: set(dbsEnabled) },
      email: { direction: 'outbound', configured: set(emailEndpoint), enabled: set(emailEnabled) },
      sms: { direction: 'outbound', configured: set(smsEndpoint), enabled: set(smsEnabled) },
      maps: { direction: 'sync', configured: set(mapsEndpoint), enabled: set(mapsEndpoint) },
    };
  }
}
