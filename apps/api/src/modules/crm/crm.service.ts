import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { skipTake, toPage } from '../../core/pagination';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import { NumberingService } from '../numbering/numbering.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { RequestScope } from '../permissions/scope';
import type {
  ListLeadsQueryDto,
  ListOrdersQueryDto,
  LogCallDto,
  UpdateOrderStatusDto,
  UploadLeadsDto,
} from './crm.dto';

interface Meta {
  ip?: string;
}

/** Digits-only normalization — the duplicate-detection key (spec E2).
 *  The KSA country code folds into local form so +966 5X… and 05X… match. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^00/, '');
  if (digits.length === 12 && digits.startsWith('966')) return `0${digits.slice(3)}`;
  return digits;
}

type PreviewRow = {
  index: number;
  name: string;
  phone: string;
  normalizedPhone: string;
  city?: string;
  notes?: string;
  status: 'VALID' | 'INVALID' | 'DUPLICATE_FILE' | 'DUPLICATE_EXISTING';
  reason?: string;
};

/**
 * CRM, Leads & Telesales (blueprint §14,
 * spec docs/specs/crm-telesales-spec-v1.0.md).
 */
@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly numbering: NumberingService,
  ) {}

  async catalogs() {
    const [callStatuses, dispositions, orderTypes] = await Promise.all([
      this.prisma.callStatus.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.leadDisposition.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.telesalesOrderType.findMany({ orderBy: { sortOrder: 'asc' } }),
    ]);
    return { callStatuses, dispositions, orderTypes };
  }

  // ── Upload: validation + preview + import (§14.1, spec E1/E2) ──────

  /** Server-side validation & duplicate report; writes nothing. */
  async preview(dto: UploadLeadsDto) {
    const rows = await this.validateRows(dto.rows);
    const counts = {
      valid: rows.filter((r) => r.status === 'VALID').length,
      invalid: rows.filter((r) => r.status === 'INVALID').length,
      duplicates: rows.filter((r) => r.status.startsWith('DUPLICATE')).length,
    };
    return { counts, rows };
  }

  /** Creates the batch and the VALID rows; duplicates/invalid are skipped. */
  async import(actor: AuthUser, dto: UploadLeadsDto, meta: Meta) {
    const rows = await this.validateRows(dto.rows);
    const valid = rows.filter((r) => r.status === 'VALID');

    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.leadBatch.create({
        data: {
          fileName: dto.fileName,
          leadSource: dto.leadSource,
          partnerName: dto.partnerName ?? null,
          campaign: dto.campaign ?? null,
          uploadedById: actor.userId,
          importedCount: valid.length,
          skippedCount: rows.length - valid.length,
        },
      });
      if (valid.length) {
        await tx.lead.createMany({
          data: valid.map((r) => ({
            batchId: created.id,
            name: r.name,
            phone: r.normalizedPhone,
            city: r.city ?? null,
            notes: r.notes ?? null,
            leadSource: dto.leadSource,
            partnerName: dto.partnerName ?? null,
            campaign: dto.campaign ?? null,
          })),
        });
      }
      return created;
    });

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'crm.leads_import',
      entityType: 'lead_batch',
      entityId: batch.id,
      after: {
        fileName: dto.fileName,
        leadSource: dto.leadSource,
        imported: valid.length,
        skipped: rows.length - valid.length,
      },
      ...meta,
    });
    return {
      batchId: batch.id,
      imported: valid.length,
      skipped: rows
        .filter((r) => r.status !== 'VALID')
        .map(({ index, status, reason }) => ({ index, status, reason })),
    };
  }

  private async validateRows(input: UploadLeadsDto['rows']): Promise<PreviewRow[]> {
    const rows: PreviewRow[] = input.map((r, index) => {
      const normalizedPhone = normalizePhone(r.phone);
      const base = { index, ...r, normalizedPhone };
      if (!r.name.trim()) return { ...base, status: 'INVALID', reason: 'Name is required' };
      if (normalizedPhone.length < 7 || normalizedPhone.length > 15) {
        return { ...base, status: 'INVALID', reason: 'Phone must be 7-15 digits' };
      }
      return { ...base, status: 'VALID' as const };
    });

    // (a) duplicates inside the file — first occurrence wins.
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.status !== 'VALID') continue;
      if (seen.has(row.normalizedPhone)) {
        row.status = 'DUPLICATE_FILE';
        row.reason = 'Duplicate phone in this file';
      } else {
        seen.add(row.normalizedPhone);
      }
    }

    // (b) duplicates against existing OPEN leads (spec E2).
    const candidates = rows.filter((r) => r.status === 'VALID').map((r) => r.normalizedPhone);
    if (candidates.length) {
      const existing = await this.prisma.lead.findMany({
        where: { phone: { in: candidates }, status: { in: ['NEW', 'ASSIGNED'] } },
        select: { phone: true },
      });
      const openPhones = new Set(existing.map((l) => l.phone));
      for (const row of rows) {
        if (row.status === 'VALID' && openPhones.has(row.normalizedPhone)) {
          row.status = 'DUPLICATE_EXISTING';
          row.reason = 'An open lead already exists for this phone';
        }
      }
    }
    return rows;
  }

  // ── Lists (scoped, §19.1) ──────────────────────────────────────────

  async listLeads(scope: RequestScope, q: ListLeadsQueryDto) {
    const where: Prisma.LeadWhereInput = {
      AND: [
        this.leadScopeWhere(scope),
        ...(q.status ? [{ status: q.status }] : []),
        ...(q.batchId ? [{ batchId: q.batchId }] : []),
        ...(q.q
          ? [
              {
                OR: [
                  { name: { contains: q.q, mode: 'insensitive' as const } },
                  { phone: { contains: normalizePhone(q.q) || q.q } },
                ],
              },
            ]
          : []),
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        include: {
          assignedTo: { select: { id: true, nameAr: true, nameEn: true } },
          batch: { select: { id: true, fileName: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...skipTake(q),
      }),
      this.prisma.lead.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  async listOrders(scope: RequestScope, q: ListOrdersQueryDto) {
    const where: Prisma.TelesalesOrderWhereInput = {
      AND: [
        this.orderScopeWhere(scope),
        ...(q.status ? [{ status: q.status }] : []),
        ...(q.q
          ? [
              {
                OR: [
                  { number: { contains: q.q, mode: 'insensitive' as const } },
                  { customerName: { contains: q.q, mode: 'insensitive' as const } },
                  { customerPhone: { contains: normalizePhone(q.q) || q.q } },
                ],
              },
            ]
          : []),
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.telesalesOrder.findMany({
        where,
        include: {
          orderType: true,
          createdBy: { select: { id: true, nameAr: true, nameEn: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...skipTake(q),
      }),
      this.prisma.telesalesOrder.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  // ── One-by-one distribution during Shift Session (§14.1, spec §4) ──

  async nextLead(user: AuthUser) {
    const session = await this.prisma.workSession.findFirst({
      where: { userId: user.userId, status: 'ACTIVE' },
    });
    if (!session) {
      throw new UnprocessableEntityException(
        'Lead distribution runs during an active shift session — start your session first',
      );
    }
    const now = new Date();

    // One lead at a time: a currently-due assigned lead comes back as-is.
    const current = await this.prisma.lead.findFirst({
      where: {
        assignedToId: user.userId,
        status: 'ASSIGNED',
        OR: [{ rescheduledAt: null }, { rescheduledAt: { lte: now } }],
      },
      orderBy: { assignedAt: 'asc' },
      include: { calls: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    if (current) return current;

    // Atomic claim: (a) my due reschedules are already ASSIGNED (handled
    // above), so claim (b) the oldest NEW lead — guarded by the status
    // check inside updateMany so two agents can never claim the same row.
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = await this.prisma.lead.findFirst({
        where: { status: 'NEW' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!candidate) return null;

      const claimed = await this.prisma.lead.updateMany({
        where: { id: candidate.id, status: 'NEW' },
        data: {
          status: 'ASSIGNED',
          assignedToId: user.userId,
          assignedAt: now,
          rescheduledAt: null,
        },
      });
      if (claimed.count === 1) {
        await this.timeline.record({
          entityType: 'lead',
          entityId: candidate.id,
          eventType: 'assigned',
          actorId: user.userId,
        });
        return this.prisma.lead.findUnique({
          where: { id: candidate.id },
          include: { calls: { orderBy: { createdAt: 'desc' }, take: 5 } },
        });
      }
      // Lost the race — try the next NEW lead.
    }
    return null;
  }

  // ── Call logging (§14.1, disposition flags E3) ─────────────────────

  async logCall(user: AuthUser, scope: RequestScope, leadId: string, dto: LogCallDto, meta: Meta) {
    const lead = await this.prisma.lead.findFirst({
      where: { AND: [{ id: leadId }, this.leadScopeWhere(scope)] },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    if (lead.status === 'CLOSED') {
      throw new UnprocessableEntityException('Lead is already closed');
    }
    if (lead.assignedToId !== user.userId && scope.scope === 'MY_RECORDS') {
      throw new ForbiddenException('Lead is not assigned to you');
    }

    const [callStatus, disposition] = await Promise.all([
      this.prisma.callStatus.findUnique({ where: { key: dto.callStatusKey } }),
      this.prisma.leadDisposition.findUnique({ where: { key: dto.dispositionKey } }),
    ]);
    if (!callStatus) throw new UnprocessableEntityException('Unknown call status');
    if (!disposition) throw new UnprocessableEntityException('Unknown disposition');

    if (disposition.requiresReschedule && !dto.rescheduledAt) {
      throw new UnprocessableEntityException(
        `${disposition.nameEn} requires a reschedule date & time`,
      );
    }
    if (disposition.createsOrder && !dto.order) {
      throw new UnprocessableEntityException(`${disposition.nameEn} requires the order details`);
    }
    if (dto.order) {
      const type = await this.prisma.telesalesOrderType.findUnique({
        where: { key: dto.order.orderTypeKey },
      });
      if (!type) throw new UnprocessableEntityException('Unknown order type');
    }

    const now = new Date();
    const rescheduledAt = dto.rescheduledAt ? new Date(dto.rescheduledAt) : null;
    const orderNumber = dto.order
      ? await this.numbering.next('crm.order.number_format', 'crm_order')
      : null;

    const result = await this.prisma.$transaction(async (tx) => {
      const order =
        dto.order && orderNumber
          ? await tx.telesalesOrder.create({
              data: {
                number: orderNumber,
                leadId: lead.id,
                customerName: lead.name,
                customerPhone: lead.phone,
                orderTypeKey: dto.order.orderTypeKey,
                value: dto.order.value,
                createdById: user.userId,
              },
            })
          : null;

      const call = await tx.leadCall.create({
        data: {
          leadId: lead.id,
          agentId: user.userId,
          callStatusKey: dto.callStatusKey,
          dispositionKey: dto.dispositionKey,
          durationSeconds: dto.durationSeconds,
          notes: dto.notes ?? null,
          rescheduledAt,
          orderId: order?.id ?? null,
        },
      });

      const updated = await tx.lead.update({
        where: { id: lead.id },
        data: {
          lastCallAt: now,
          // The caller becomes the owner (team scopes may work others' leads).
          assignedToId: lead.assignedToId ?? user.userId,
          assignedAt: lead.assignedAt ?? now,
          ...(disposition.closesLead
            ? { status: 'CLOSED', closedAt: now, closedDispositionKey: disposition.key }
            : { status: 'ASSIGNED', rescheduledAt }),
        },
      });
      return { call, order, lead: updated };
    });

    await this.timeline.record({
      entityType: 'lead',
      entityId: lead.id,
      eventType: 'call_logged',
      actorId: user.userId,
      payload: {
        callStatus: dto.callStatusKey,
        disposition: dto.dispositionKey,
        durationSeconds: dto.durationSeconds,
        ...(rescheduledAt ? { rescheduledAt: rescheduledAt.toISOString() } : {}),
        ...(result.order ? { orderNumber: result.order.number } : {}),
      },
    });
    await this.audit.record({
      actorId: user.userId,
      actorEmail: user.email,
      action: 'crm.call_log',
      entityType: 'lead',
      entityId: lead.id,
      after: { disposition: dto.dispositionKey, order: result.order?.number ?? null },
      ...meta,
    });
    if (result.order) {
      await this.timeline.record({
        entityType: 'telesales_order',
        entityId: result.order.id,
        eventType: 'created',
        actorId: user.userId,
        payload: { number: result.order.number, value: dto.order?.value },
      });
    }
    return result;
  }

  // ── Orders (§14.4, spec E7) ────────────────────────────────────────

  async updateOrderStatus(
    user: AuthUser,
    scope: RequestScope,
    id: string,
    dto: UpdateOrderStatusDto,
    meta: Meta,
  ) {
    const order = await this.prisma.telesalesOrder.findFirst({
      where: { AND: [{ id }, this.orderScopeWhere(scope)] },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'OPEN') {
      throw new UnprocessableEntityException(`Order is already ${order.status.toLowerCase()}`);
    }

    const updated = await this.prisma.telesalesOrder.update({
      where: { id },
      data: {
        status: dto.status,
        completedAt: dto.status === 'COMPLETED' ? new Date() : null,
      },
    });
    await this.timeline.record({
      entityType: 'telesales_order',
      entityId: id,
      eventType: dto.status === 'COMPLETED' ? 'completed' : 'cancelled',
      actorId: user.userId,
    });
    await this.audit.record({
      actorId: user.userId,
      actorEmail: user.email,
      action: 'crm.order_status',
      entityType: 'telesales_order',
      entityId: id,
      before: { status: order.status },
      after: { status: dto.status },
      ...meta,
    });
    return updated;
  }

  // ── Scope filters (§19.1; unassigned NEW leads visible team-up) ────

  private leadScopeWhere(scope: RequestScope): Prisma.LeadWhereInput {
    const mine: Prisma.LeadWhereInput = { assignedToId: scope.context.userId };
    const unassigned: Prisma.LeadWhereInput = { status: 'NEW' };
    switch (scope.scope) {
      case 'ALL_DATA':
        return {};
      case 'DEPARTMENT':
        return {
          OR: [
            mine,
            unassigned,
            {
              assignedTo: {
                departmentId: scope.context.departmentId ?? 'none',
              },
            },
          ],
        };
      case 'MULTIPLE_TEAMS':
      case 'MY_TEAM': {
        const teamIds = scope.scope === 'MY_TEAM' ? scope.context.teamIds : (scope.teamIds ?? []);
        return {
          OR: [mine, unassigned, { assignedTo: { teams: { some: { teamId: { in: teamIds } } } } }],
        };
      }
      case 'MY_RECORDS':
      case 'BRANCH':
      case 'PARTNER':
        return mine;
    }
  }

  private orderScopeWhere(scope: RequestScope): Prisma.TelesalesOrderWhereInput {
    const mine: Prisma.TelesalesOrderWhereInput = { createdById: scope.context.userId };
    switch (scope.scope) {
      case 'ALL_DATA':
        return {};
      case 'DEPARTMENT':
        return {
          OR: [mine, { createdBy: { departmentId: scope.context.departmentId ?? 'none' } }],
        };
      case 'MULTIPLE_TEAMS':
      case 'MY_TEAM': {
        const teamIds = scope.scope === 'MY_TEAM' ? scope.context.teamIds : (scope.teamIds ?? []);
        return { OR: [mine, { createdBy: { teams: { some: { teamId: { in: teamIds } } } } }] };
      }
      case 'MY_RECORDS':
      case 'BRANCH':
      case 'PARTNER':
        return mine;
    }
  }
}
