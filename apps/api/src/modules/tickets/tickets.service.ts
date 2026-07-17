import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma, Ticket } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { SettingsService } from '../settings/settings.service';
import { IntegrationsService } from '../integrations/integrations.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { RequestScope } from '../permissions/scope';
import { skipTake, toPage } from '../../core/pagination';
import type {
  AddUpdateDto,
  AssignTicketDto,
  ChangeStatusDto,
  CreateTicketDto,
  EscalateTicketDto,
  ListTicketsQueryDto,
  RedirectTicketDto,
  ReopenTicketDto,
  ResolveTicketDto,
} from './tickets.dto';

const LIST_INCLUDE = {
  type: true,
  category: true,
  urgency: true,
  status: true,
  branch: { select: { id: true, code: true, nameAr: true, nameEn: true } },
  createdBy: { select: { id: true, nameAr: true, nameEn: true, email: true } },
  responsible: { select: { id: true, nameAr: true, nameEn: true, email: true } },
  teams: { include: { team: { select: { id: true, nameAr: true, nameEn: true } } } },
} satisfies Prisma.TicketInclude;

interface Meta {
  ip?: string;
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly notifications: NotificationsService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly integrations: IntegrationsService,
  ) {}

  // ── Scope & views (spec §4/§7, ADR-010) ───────────────────────────

  private scopeWhere(scope: RequestScope): Prisma.TicketWhereInput {
    const mine: Prisma.TicketWhereInput[] = [
      { createdById: scope.context.userId },
      { responsibleId: scope.context.userId },
    ];
    switch (scope.scope) {
      case 'ALL_DATA':
        return {};
      case 'DEPARTMENT':
        return scope.context.departmentId
          ? {
              OR: [
                ...mine,
                { teams: { some: { team: { departmentId: scope.context.departmentId } } } },
              ],
            }
          : { OR: mine };
      case 'MULTIPLE_TEAMS':
        return { OR: [...mine, { teams: { some: { teamId: { in: scope.teamIds ?? [] } } } }] };
      case 'MY_TEAM':
        return scope.context.teamIds.length
          ? { OR: [...mine, { teams: { some: { teamId: { in: scope.context.teamIds } } } }] }
          : { OR: mine };
      case 'MY_RECORDS':
      case 'BRANCH':
      case 'PARTNER':
        return { OR: mine };
    }
  }

  private viewWhere(view: string | undefined, scope: RequestScope): Prisma.TicketWhereInput {
    switch (view) {
      case 'my_tickets':
        return { createdById: scope.context.userId };
      case 'assigned_to_me':
        return { responsibleId: scope.context.userId };
      case 'unassigned':
        return { responsibleId: null, status: { kind: 'OPEN' } };
      case 'escalated':
        return { status: { key: 'ESCALATED' } };
      case 'critical':
        return { urgency: { key: 'CRITICAL' }, status: { kind: 'OPEN' } };
      case 'branch_complaints':
        return { type: { key: 'BRANCH' } };
      case 'closed_today': {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        return { status: { key: 'CLOSED' }, closedAt: { gte: startOfDay } };
      }
      case 'all':
      default:
        return {};
    }
  }

  private filterWhere(q: ListTicketsQueryDto): Prisma.TicketWhereInput {
    return {
      ...(q.typeId ? { typeId: q.typeId } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.urgencyId ? { urgencyId: q.urgencyId } : {}),
      ...(q.statusId ? { statusId: q.statusId } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.responsibleId ? { responsibleId: q.responsibleId } : {}),
      ...(q.createdById ? { createdById: q.createdById } : {}),
      ...(q.directedTeamId ? { teams: { some: { teamId: q.directedTeamId } } } : {}),
      ...(q.slaState ? { slaState: q.slaState } : {}),
      ...(q.product
        ? {
            OR: [
              { sapMaterialNo: { contains: q.product, mode: 'insensitive' } },
              { itemNameAr: { contains: q.product, mode: 'insensitive' } },
              { itemNameEn: { contains: q.product, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(q.createdFrom || q.createdTo
        ? {
            createdAt: {
              ...(q.createdFrom ? { gte: new Date(q.createdFrom) } : {}),
              ...(q.createdTo ? { lte: new Date(q.createdTo) } : {}),
            },
          }
        : {}),
      ...(q.q
        ? {
            OR: [
              { internalNumber: { contains: q.q, mode: 'insensitive' } },
              { customerComplaintNumber: { contains: q.q, mode: 'insensitive' } },
              { customerName: { contains: q.q, mode: 'insensitive' } },
              { customerPhone: { contains: q.q } },
              { subject: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  async list(scope: RequestScope, q: ListTicketsQueryDto) {
    const where: Prisma.TicketWhereInput = {
      AND: [
        { deletedAt: null },
        this.scopeWhere(scope),
        this.viewWhere(q.view, scope),
        this.filterWhere(q),
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...skipTake(q),
      }),
      this.prisma.ticket.count({ where }),
    ]);

    // hasAttachments is a post-filter (generic attachment table, spec §7).
    if (q.hasAttachments !== undefined) {
      const ids = items.map((t) => t.id);
      const withAttachments = new Set(
        (
          await this.prisma.attachment.groupBy({
            by: ['entityId'],
            where: { entityType: 'ticket', entityId: { in: ids }, deletedAt: null },
          })
        ).map((g) => g.entityId),
      );
      return toPage(
        items.filter((t) => withAttachments.has(t.id) === q.hasAttachments),
        total,
        q,
      );
    }
    return toPage(items, total, q);
  }

  async get(scope: RequestScope, id: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.scopeWhere(scope)] },
      include: {
        ...LIST_INCLUDE,
        updates: {
          include: {
            updateType: true,
            author: { select: { id: true, nameAr: true, nameEn: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        resolution: { include: { resolutionCategory: true } },
        ownerships: {
          include: { user: { select: { id: true, nameAr: true, nameEn: true } } },
          orderBy: { fromAt: 'asc' },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const [timeline, attachments] = await Promise.all([
      this.timeline.forEntity('ticket', id),
      this.prisma.attachment.findMany({
        where: { entityType: 'ticket', entityId: id, deletedAt: null },
      }),
    ]);
    return { ...ticket, timeline, attachments };
  }

  // ── Creation (US-1/US-2; §9.8 branch flow, ADR-006/007) ───────────

  async create(actor: AuthUser, scope: RequestScope, dto: CreateTicketDto, meta: Meta) {
    const type = await this.prisma.ticketType.findFirst({
      where: { key: dto.typeKey, active: true },
    });
    if (!type) throw new BadRequestException('Unknown ticket type');
    const category = await this.prisma.ticketCategory.findFirst({
      where: { typeId: type.id, key: dto.categoryKey, active: true },
    });
    if (!category) throw new BadRequestException('Unknown category for this ticket type');
    const urgency = await this.prisma.ticketUrgency.findFirst({
      where: { key: dto.urgencyKey, active: true },
    });
    if (!urgency) throw new BadRequestException('Unknown urgency');
    const opened = await this.prisma.ticketStatus.findFirstOrThrow({ where: { key: 'OPENED' } });

    // Branch flow (§9.8): user picks the branch only; supervisor is resolved here.
    let branchSupervisorSnapshot: Prisma.InputJsonValue | undefined;
    let autoDirectTeamIds: string[] = dto.directedTeamIds ?? [];
    let routingNote: string | null = null;
    if (type.key === 'BRANCH') {
      if (!dto.branchId) throw new BadRequestException('branchId is required for branch tickets');
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, deletedAt: null, status: 'ACTIVE' },
      });
      if (!branch) throw new NotFoundException('Branch not found or inactive');

      if (branch.supervisorName || branch.supervisorEmail) {
        branchSupervisorSnapshot = {
          name: branch.supervisorName,
          email: branch.supervisorEmail,
          phone: branch.supervisorPhone,
          capturedAt: new Date().toISOString(),
        };
        const supervisorTeam = await this.prisma.team.findFirst({
          where: { nameEn: 'Branch Supervisor', deletedAt: null },
        });
        if (supervisorTeam && !autoDirectTeamIds.includes(supervisorTeam.id)) {
          autoDirectTeamIds = [...autoDirectTeamIds, supervisorTeam.id];
        }
      } else {
        const route = String(await this.settings.resolve('ticketing.branch.no_supervisor_route'));
        routingNote = route;
        // Data-quality signal (§26 risk: incomplete branch database).
        await this.audit.record({
          actorId: actor.userId,
          actorEmail: actor.email,
          action: 'ticket.routing_fallback',
          entityType: 'branch',
          entityId: branch.id,
          after: { route, reason: 'no_active_supervisor' },
          ...meta,
        });
      }
    } else if (dto.branchId) {
      throw new BadRequestException('branchId is only valid for branch tickets');
    }

    // §13 Request Source (online-operation spec F3).
    if (dto.requestSourceKey) {
      const source = await this.prisma.requestSource.findFirst({
        where: { key: dto.requestSourceKey, active: true },
      });
      if (!source) throw new BadRequestException('Unknown request source');
    }

    const [internalNumber, customerComplaintNumber] = await Promise.all([
      this.numbering.next('ticketing.number.internal_format', 'ticket-internal'),
      this.numbering.next('ticketing.number.customer_format', 'ticket-customer'),
    ]);

    // SLA due dates from policy (timers run in the SLA worker).
    const slaPolicy = await this.prisma.slaPolicy.findFirst({
      where: { typeId: type.id, urgencyId: urgency.id, active: true },
    });
    const now = Date.now();

    const ticket = await this.prisma.ticket.create({
      data: {
        internalNumber,
        customerComplaintNumber,
        typeId: type.id,
        categoryId: category.id,
        urgencyId: urgency.id,
        statusId: opened.id,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        subject: dto.subject,
        description: dto.description,
        relatedOrderNo: dto.relatedOrderNo,
        requestSourceKey: dto.requestSourceKey,
        customerVisitAt: dto.customerVisitAt ? new Date(dto.customerVisitAt) : undefined,
        sapMaterialNo: dto.sapMaterialNo,
        itemNameAr: dto.itemNameAr,
        itemNameEn: dto.itemNameEn,
        branchId: dto.branchId,
        branchSupervisorSnapshot,
        createdById: actor.userId,
        slaPolicyId: slaPolicy?.id,
        firstResponseDueAt: slaPolicy
          ? new Date(now + slaPolicy.firstResponseMinutes * 60_000)
          : undefined,
        resolutionDueAt: slaPolicy
          ? new Date(now + slaPolicy.resolutionMinutes * 60_000)
          : undefined,
        teams: { create: autoDirectTeamIds.map((teamId) => ({ teamId })) },
      },
      include: LIST_INCLUDE,
    });

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ticket.create',
      entityType: 'ticket',
      entityId: ticket.id,
      after: {
        internalNumber,
        type: type.key,
        category: category.key,
        urgency: urgency.key,
        branchId: dto.branchId,
        routingFallback: routingNote,
      },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'ticket',
      entityId: ticket.id,
      eventType: 'created',
      actorId: actor.userId,
      payload: { internalNumber, type: type.key },
    });
    if (autoDirectTeamIds.length) {
      await this.timeline.record({
        entityType: 'ticket',
        entityId: ticket.id,
        eventType: 'directed',
        actorId: actor.userId,
        payload: { teamIds: autoDirectTeamIds },
      });
      await this.notifyTeamLeads(autoDirectTeamIds, {
        type: 'ticket.directed',
        titleAr: `تذكرة جديدة موجهة لفريقك: ${internalNumber}`,
        titleEn: `New ticket directed to your team: ${internalNumber}`,
        payload: { entityType: 'ticket', entityId: ticket.id },
      });
    }
    return ticket;
  }

  // ── Responsibility (US-3; ADR-004, §9.5/§9.9) ─────────────────────

  private async loadInScope(scope: RequestScope, id: string): Promise<Ticket> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.scopeWhere(scope)] },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async assign(actor: AuthUser, scope: RequestScope, id: string, dto: AssignTicketDto, meta: Meta) {
    const ticket = await this.loadInScope(scope, id);
    const assignee = await this.prisma.user.findFirst({
      where: { id: dto.userId, deletedAt: null, status: 'ACTIVE' },
    });
    if (!assignee) throw new NotFoundException('Assignee not found or inactive');
    return this.applyResponsibility(actor, ticket, assignee.id, dto.reason ?? 'assigned', meta);
  }

  async take(actor: AuthUser, scope: RequestScope, id: string, meta: Meta) {
    const ticket = await this.loadInScope(scope, id);
    if (ticket.responsibleId === actor.userId) {
      throw new ConflictException('You are already responsible for this ticket');
    }
    return this.applyResponsibility(actor, ticket, actor.userId, 'self-take', meta);
  }

  private async applyResponsibility(
    actor: AuthUser,
    ticket: Ticket,
    newResponsibleId: string,
    reason: string,
    meta: Meta,
  ) {
    const status = await this.prisma.ticketStatus.findUniqueOrThrow({
      where: { id: ticket.statusId },
    });
    // Auto-transition to PROCESSING when allowed (null-permission transition).
    const processing = await this.prisma.ticketStatus.findFirstOrThrow({
      where: { key: 'PROCESSING' },
    });
    const canAutoMove =
      status.key !== 'PROCESSING' &&
      (await this.prisma.statusTransition.findFirst({
        where: {
          fromStatusId: status.id,
          toStatusId: processing.id,
          requiredPermissionKey: null,
        },
      }));

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.ticketOwnership.updateMany({
        where: { ticketId: ticket.id, toAt: null },
        data: { toAt: now },
      }),
      this.prisma.ticketOwnership.create({
        data: {
          ticketId: ticket.id,
          userId: newResponsibleId,
          assignedById: actor.userId,
          reason,
        },
      }),
      this.prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          responsibleId: newResponsibleId,
          ...(canAutoMove ? { statusId: processing.id } : {}),
        },
      }),
    ]);

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ticket.assign',
      entityType: 'ticket',
      entityId: ticket.id,
      before: { responsibleId: ticket.responsibleId },
      after: { responsibleId: newResponsibleId, reason },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'ticket',
      entityId: ticket.id,
      eventType: newResponsibleId === actor.userId ? 'responsibility_taken' : 'assigned',
      actorId: actor.userId,
      payload: { responsibleId: newResponsibleId, reason },
    });
    if (canAutoMove) {
      await this.timeline.record({
        entityType: 'ticket',
        entityId: ticket.id,
        eventType: 'status_changed',
        actorId: actor.userId,
        payload: { from: status.key, to: 'PROCESSING', automatic: true },
      });
    }
    if (newResponsibleId !== actor.userId) {
      await this.notifications.notify({
        userId: newResponsibleId,
        type: 'ticket.assigned',
        titleAr: `أُسندت إليك تذكرة: ${ticket.internalNumber}`,
        titleEn: `Ticket assigned to you: ${ticket.internalNumber}`,
        payload: { entityType: 'ticket', entityId: ticket.id },
      });
    }
    return this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: LIST_INCLUDE,
    });
  }

  async redirect(
    actor: AuthUser,
    scope: RequestScope,
    id: string,
    dto: RedirectTicketDto,
    meta: Meta,
  ) {
    const ticket = await this.loadInScope(scope, id);
    const teams = await this.prisma.team.findMany({
      where: { id: { in: dto.teamIds }, deletedAt: null },
    });
    if (teams.length !== dto.teamIds.length) {
      throw new BadRequestException('One or more teams do not exist');
    }
    const before = await this.prisma.ticketTeam.findMany({ where: { ticketId: id } });
    await this.prisma.$transaction([
      this.prisma.ticketTeam.deleteMany({ where: { ticketId: id } }),
      this.prisma.ticketTeam.createMany({
        data: dto.teamIds.map((teamId) => ({ ticketId: id, teamId })),
      }),
    ]);
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ticket.redirect',
      entityType: 'ticket',
      entityId: id,
      before: { teamIds: before.map((t) => t.teamId) },
      after: { teamIds: dto.teamIds },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'ticket',
      entityId: id,
      eventType: 'redirected',
      actorId: actor.userId,
      payload: { teamIds: dto.teamIds },
    });
    const added = dto.teamIds.filter((t) => !before.some((b) => b.teamId === t));
    if (added.length) {
      await this.notifyTeamLeads(added, {
        type: 'ticket.directed',
        titleAr: `تذكرة موجهة لفريقك: ${ticket.internalNumber}`,
        titleEn: `Ticket directed to your team: ${ticket.internalNumber}`,
        payload: { entityType: 'ticket', entityId: id },
      });
    }
    return this.get(scope, id);
  }

  // ── Updates (US-4; §9.6) ──────────────────────────────────────────

  async addUpdate(actor: AuthUser, scope: RequestScope, id: string, dto: AddUpdateDto, meta: Meta) {
    const ticket = await this.loadInScope(scope, id);
    const updateType = await this.prisma.updateType.findFirst({
      where: { key: dto.updateTypeKey, active: true },
    });
    if (!updateType) throw new BadRequestException('Unknown update type');
    if (dto.directedToTeamId) {
      const team = await this.prisma.team.findFirst({
        where: { id: dto.directedToTeamId, deletedAt: null },
      });
      if (!team) throw new BadRequestException('Directed team does not exist');
    }

    const update = await this.prisma.ticketUpdate.create({
      data: {
        ticketId: id,
        authorId: actor.userId,
        updateTypeId: updateType.id,
        directedToTeamId: dto.directedToTeamId,
        body: dto.body,
      },
      include: { updateType: true, author: { select: { id: true, nameAr: true, nameEn: true } } },
    });

    const status = await this.prisma.ticketStatus.findUniqueOrThrow({
      where: { id: ticket.statusId },
    });
    const patch: Prisma.TicketUpdateInput = {};

    // First response stamp (SLA).
    if (!ticket.firstRespondedAt) patch.firstRespondedAt = new Date();

    // SLA pause/resume (US-4/US-8): WAITING pauses; any other update resumes.
    if (updateType.pausesSla && !ticket.slaPausedAt) {
      patch.slaPausedAt = new Date();
      patch.slaState = 'PAUSED';
    } else if (!updateType.pausesSla && ticket.slaPausedAt) {
      const pausedMinutes = Math.round((Date.now() - ticket.slaPausedAt.getTime()) / 60_000);
      patch.slaPausedAt = null;
      patch.slaPausedTotalMinutes = ticket.slaPausedTotalMinutes + pausedMinutes;
      patch.slaState = 'ON_TRACK';
      if (ticket.resolutionDueAt) {
        patch.resolutionDueAt = new Date(ticket.resolutionDueAt.getTime() + pausedMinutes * 60_000);
      }
    }

    // New Response automation (A3): inbound contact after resolution.
    let becameNewResponse = false;
    if (updateType.key === 'CUSTOMER_CONTACT' && status.key === 'COMPLETED') {
      const newResponse = await this.prisma.ticketStatus.findFirstOrThrow({
        where: { key: 'NEW_RESPONSE' },
      });
      patch.status = { connect: { id: newResponse.id } };
      patch.lastCustomerResponseAt = new Date();
      becameNewResponse = true;
    }

    if (Object.keys(patch).length) {
      await this.prisma.ticket.update({ where: { id }, data: patch });
    }

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ticket.update_add',
      entityType: 'ticket',
      entityId: id,
      after: { updateType: updateType.key, directedToTeamId: dto.directedToTeamId },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'ticket',
      entityId: id,
      eventType: 'update_added',
      actorId: actor.userId,
      payload: { updateType: updateType.key },
    });
    if (becameNewResponse) {
      await this.timeline.record({
        entityType: 'ticket',
        entityId: id,
        eventType: 'status_changed',
        actorId: actor.userId,
        payload: { from: 'COMPLETED', to: 'NEW_RESPONSE', automatic: true },
      });
      if (ticket.responsibleId) {
        await this.notifications.notify({
          userId: ticket.responsibleId,
          type: 'ticket.new_response',
          titleAr: `رد جديد على التذكرة: ${ticket.internalNumber}`,
          titleEn: `New response on ticket: ${ticket.internalNumber}`,
          payload: { entityType: 'ticket', entityId: id },
        });
      }
    }
    return update;
  }

  // ── Status engine (spec §5) ───────────────────────────────────────

  async changeStatus(
    actor: AuthUser,
    scope: RequestScope,
    id: string,
    dto: ChangeStatusDto,
    meta: Meta,
  ) {
    const ticket = await this.loadInScope(scope, id);
    const target = await this.prisma.ticketStatus.findFirst({
      where: { key: dto.statusKey, active: true },
    });
    if (!target) throw new BadRequestException('Unknown status');
    return this.transition(actor, scope, ticket, target.key, meta);
  }

  private async transition(
    actor: AuthUser,
    scope: RequestScope,
    ticket: Ticket,
    targetKey: string,
    meta: Meta,
    extra?: { reason?: string },
  ) {
    const current = await this.prisma.ticketStatus.findUniqueOrThrow({
      where: { id: ticket.statusId },
    });
    const target = await this.prisma.ticketStatus.findFirstOrThrow({
      where: { key: targetKey },
    });
    if (current.id === target.id) {
      throw new ConflictException(`Ticket is already ${targetKey}`);
    }

    const transition = await this.prisma.statusTransition.findUnique({
      where: { fromStatusId_toStatusId: { fromStatusId: current.id, toStatusId: target.id } },
    });
    if (!transition) {
      throw new ConflictException(`Transition ${current.key} → ${target.key} is not allowed`);
    }
    if (
      transition.requiredPermissionKey &&
      !(transition.requiredPermissionKey in scope.context.permissions)
    ) {
      throw new ForbiddenException(`Missing permission: ${transition.requiredPermissionKey}`);
    }

    // ADR-005: no Completed/Closed without a complete resolution record.
    if (target.key === 'COMPLETED' || target.key === 'CLOSED') {
      const resolution = await this.prisma.ticketResolution.findUnique({
        where: { ticketId: ticket.id },
      });
      if (!resolution) {
        throw new UnprocessableEntityException(
          'Resolution record is required before completing or closing (ADR-005)',
        );
      }
    }

    const patch: Prisma.TicketUpdateInput = { status: { connect: { id: target.id } } };
    if (target.key === 'CLOSED') {
      patch.closedById = actor.userId; // ADR-004: closer recorded separately
      patch.closedAt = new Date();
    }
    if (target.key === 'RE_OPENED') {
      patch.reopenCount = ticket.reopenCount + 1;
      patch.closedById = null;
      patch.closedAt = null;
      // SLA restarts from re-open per policy (US-8).
      if (ticket.slaPolicyId) {
        const policy = await this.prisma.slaPolicy.findUnique({
          where: { id: ticket.slaPolicyId },
        });
        if (policy) {
          patch.resolutionDueAt = new Date(Date.now() + policy.resolutionMinutes * 60_000);
          patch.slaState = 'ON_TRACK';
          patch.slaPausedAt = null;
        }
      }
    }
    await this.prisma.ticket.update({ where: { id: ticket.id }, data: patch });

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ticket.status_change',
      entityType: 'ticket',
      entityId: ticket.id,
      before: { status: current.key },
      after: { status: target.key, reason: extra?.reason },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'ticket',
      entityId: ticket.id,
      eventType: 'status_changed',
      actorId: actor.userId,
      payload: { from: current.key, to: target.key, reason: extra?.reason },
    });

    // Notifications per spec §9.
    if (target.key === 'ESCALATED') {
      const teams = await this.prisma.ticketTeam.findMany({ where: { ticketId: ticket.id } });
      await this.notifyTeamLeads(
        teams.map((t) => t.teamId),
        {
          type: 'ticket.escalated',
          titleAr: `تم تصعيد التذكرة: ${ticket.internalNumber}`,
          titleEn: `Ticket escalated: ${ticket.internalNumber}`,
          payload: { entityType: 'ticket', entityId: ticket.id },
        },
      );
    }
    if (target.key === 'CLOSED' || target.key === 'RE_OPENED') {
      const notifyIds = [ticket.createdById, ticket.responsibleId].filter(
        (u): u is string => !!u && u !== actor.userId,
      );
      await this.notifications.notifyMany([...new Set(notifyIds)], {
        type: `ticket.${target.key.toLowerCase()}`,
        titleAr:
          target.key === 'CLOSED'
            ? `تم إغلاق التذكرة: ${ticket.internalNumber}`
            : `أُعيد فتح التذكرة: ${ticket.internalNumber}`,
        titleEn:
          target.key === 'CLOSED'
            ? `Ticket closed: ${ticket.internalNumber}`
            : `Ticket re-opened: ${ticket.internalNumber}`,
        payload: { entityType: 'ticket', entityId: ticket.id },
      });
    }
    return this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: LIST_INCLUDE,
    });
  }

  async escalate(
    actor: AuthUser,
    scope: RequestScope,
    id: string,
    dto: EscalateTicketDto,
    meta: Meta,
  ) {
    const ticket = await this.loadInScope(scope, id);
    const escalationType = await this.prisma.updateType.findFirstOrThrow({
      where: { key: 'ESCALATION' },
    });
    await this.prisma.ticketUpdate.create({
      data: {
        ticketId: id,
        authorId: actor.userId,
        updateTypeId: escalationType.id,
        body: dto.reason,
      },
    });
    return this.transition(actor, scope, ticket, 'ESCALATED', meta, { reason: dto.reason });
  }

  // ── Resolution & lifecycle end (US-5/US-6; §9.7, ADR-004/005) ─────

  async resolve(
    actor: AuthUser,
    scope: RequestScope,
    id: string,
    dto: ResolveTicketDto,
    meta: Meta,
  ) {
    const ticket = await this.loadInScope(scope, id);
    const category = await this.prisma.resolutionCategory.findFirst({
      where: { key: dto.resolutionCategoryKey, active: true },
    });
    if (!category) throw new BadRequestException('Unknown resolution category');

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.ticketResolution.upsert({
        where: { ticketId: id },
        update: {
          summary: dto.summary,
          rootCause: dto.rootCause,
          actionTaken: dto.actionTaken,
          finalSolution: dto.finalSolution,
          resolutionCategoryId: category.id,
          customerInformed: dto.customerInformed,
          resolvedById: actor.userId,
          resolvedAt: now,
        },
        create: {
          ticketId: id,
          summary: dto.summary,
          rootCause: dto.rootCause,
          actionTaken: dto.actionTaken,
          finalSolution: dto.finalSolution,
          resolutionCategoryId: category.id,
          customerInformed: dto.customerInformed,
          resolvedById: actor.userId,
          resolvedAt: now,
        },
      }),
      this.prisma.ticket.update({
        where: { id },
        data: {
          resolvedById: actor.userId, // ADR-004
          resolvedAt: now,
          // Freeze the SLA result (US-8).
          slaState: ticket.resolutionDueAt && now > ticket.resolutionDueAt ? 'BREACHED' : 'MET',
        },
      }),
    ]);

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ticket.resolve',
      entityType: 'ticket',
      entityId: id,
      after: { resolutionCategory: category.key, customerInformed: dto.customerInformed },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'ticket',
      entityId: id,
      eventType: 'resolved',
      actorId: actor.userId,
      payload: { resolutionCategory: category.key },
    });
    if (ticket.createdById !== actor.userId) {
      await this.notifications.notify({
        userId: ticket.createdById,
        type: 'ticket.resolved',
        titleAr: `تم حل التذكرة: ${ticket.internalNumber}`,
        titleEn: `Ticket resolved: ${ticket.internalNumber}`,
        payload: { entityType: 'ticket', entityId: id },
      });
    }

    // §13 outbound sync slot (online-operation spec F5): resolving an online
    // ticket notifies the Ordering System through the retry queue — the core
    // never blocks on the integration (§22).
    const type = await this.prisma.ticketType.findUnique({ where: { id: ticket.typeId } });
    if (type && (type.key === 'ONLINE_ISSUE' || type.key === 'ONLINE_REQUEST')) {
      const outboundEnabled = Boolean(
        await this.settings.resolve('integrations.ordering.outbound_enabled').catch(() => false),
      );
      if (outboundEnabled) {
        await this.integrations.enqueue({
          integrationKey: 'ordering',
          operation: 'issue_resolved',
          payload: {
            ticketId: id,
            internalNumber: ticket.internalNumber,
            type: type.key,
            relatedOrderNo: ticket.relatedOrderNo,
            resolvedAt: now.toISOString(),
          },
        });
      }
    }

    return this.transition(actor, scope, ticket, 'COMPLETED', meta);
  }

  async close(actor: AuthUser, scope: RequestScope, id: string, meta: Meta) {
    const ticket = await this.loadInScope(scope, id);
    return this.transition(actor, scope, ticket, 'CLOSED', meta);
  }

  async reopen(actor: AuthUser, scope: RequestScope, id: string, dto: ReopenTicketDto, meta: Meta) {
    const ticket = await this.loadInScope(scope, id);
    return this.transition(actor, scope, ticket, 'RE_OPENED', meta, { reason: dto.reason });
  }

  // ── Export (US-7; §19.3 export logging) ───────────────────────────

  async exportCsv(actor: AuthUser, scope: RequestScope, q: ListTicketsQueryDto, meta: Meta) {
    const page = await this.list(scope, { ...q, page: 1, pageSize: 100 });
    const header =
      'internalNumber,customerComplaintNumber,type,category,urgency,status,customerName,customerPhone,subject,responsible,createdAt';
    const rows = page.items.map((t) =>
      [
        t.internalNumber,
        t.customerComplaintNumber,
        t.type.key,
        t.category.key,
        t.urgency.key,
        t.status.key,
        t.customerName,
        t.customerPhone,
        JSON.stringify(t.subject),
        t.responsible?.email ?? '',
        t.createdAt.toISOString(),
      ].join(','),
    );
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ticket.export',
      entityType: 'ticket',
      after: { count: rows.length, filters: q },
      ...meta,
    });
    return [header, ...rows].join('\n');
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private async notifyTeamLeads(
    teamIds: string[],
    message: { type: string; titleAr: string; titleEn: string; payload: Record<string, unknown> },
  ) {
    if (!teamIds.length) return;
    const leads = await this.prisma.teamMember.findMany({
      where: { teamId: { in: teamIds }, role: { in: ['LEADER', 'MANAGER'] } },
      select: { userId: true },
    });
    await this.notifications.notifyMany([...new Set(leads.map((l) => l.userId))], message);
  }
}
