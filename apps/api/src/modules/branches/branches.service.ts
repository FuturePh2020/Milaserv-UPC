import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { skipTake, toPage } from '../../core/pagination';
import type { CreateBranchDto, ListBranchesQueryDto, UpdateBranchDto } from './branches.dto';

/**
 * Minimal Branch Directory (ticketing spec §2, subset of blueprint §16.1).
 * Master data: visible to any holder of branch.view regardless of data scope;
 * BRANCH data-scope filtering activates with partner/branch scoping (Phase 3+).
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
  ) {}

  async list(q: ListBranchesQueryDto) {
    const where: Prisma.BranchWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? {
            OR: [
              { code: { contains: q.q, mode: 'insensitive' } },
              { nameAr: { contains: q.q, mode: 'insensitive' } },
              { nameEn: { contains: q.q, mode: 'insensitive' } },
              { city: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({ where, orderBy: { code: 'asc' }, ...skipTake(q) }),
      this.prisma.branch.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  async get(id: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id, deletedAt: null } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async create(actor: AuthUser, dto: CreateBranchDto, meta: { ip?: string }) {
    const existing = await this.prisma.branch.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Branch code already exists');

    const branch = await this.prisma.branch.create({ data: dto });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'branch.create',
      entityType: 'branch',
      entityId: branch.id,
      after: dto,
      ...meta,
    });
    await this.timeline.record({
      entityType: 'branch',
      entityId: branch.id,
      eventType: 'created',
      actorId: actor.userId,
    });
    return branch;
  }

  async update(actor: AuthUser, id: string, dto: UpdateBranchDto, meta: { ip?: string }) {
    const before = await this.get(id);
    const branch = await this.prisma.branch.update({ where: { id }, data: dto });

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'branch.update',
      entityType: 'branch',
      entityId: id,
      before: {
        nameAr: before.nameAr,
        nameEn: before.nameEn,
        supervisorName: before.supervisorName,
        supervisorEmail: before.supervisorEmail,
        supervisorPhone: before.supervisorPhone,
        status: before.status,
      },
      after: dto,
      ...meta,
    });
    // Supervisor changes matter for §9.8 history — record them distinctly.
    if (
      dto.supervisorName !== undefined ||
      dto.supervisorEmail !== undefined ||
      dto.supervisorPhone !== undefined
    ) {
      await this.timeline.record({
        entityType: 'branch',
        entityId: id,
        eventType: 'supervisor_changed',
        actorId: actor.userId,
        payload: {
          from: { name: before.supervisorName, email: before.supervisorEmail },
          to: { name: branch.supervisorName, email: branch.supervisorEmail },
        },
      });
    } else {
      await this.timeline.record({
        entityType: 'branch',
        entityId: id,
        eventType: 'updated',
        actorId: actor.userId,
        payload: dto,
      });
    }
    return branch;
  }

  async archive(actor: AuthUser, id: string, meta: { ip?: string }) {
    const branch = await this.get(id);
    await this.prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'branch.archive',
      entityType: 'branch',
      entityId: id,
      before: { code: branch.code },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'branch',
      entityId: id,
      eventType: 'archived',
      actorId: actor.userId,
    });
  }
}
