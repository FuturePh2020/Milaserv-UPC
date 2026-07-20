import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { EffectivePermissions } from '../permissions/scope';
import { skipTake, toPage } from '../../core/pagination';
import type { CreateContentDto, ListContentsQueryDto, UpdateContentDto } from './kb.dto';

interface Meta {
  ip?: string;
}

const OWNER_SELECT = { select: { id: true, nameAr: true, nameEn: true, email: true } };

/**
 * KB content library (blueprint §10.1/§10.4). Versioning: each edit chain is a
 * rootId group; publishing a version archives the previously published one —
 * history is never deleted.
 */
@Injectable()
export class KbContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
  ) {}

  private canManage(perms: EffectivePermissions['permissions']): boolean {
    return 'kb.manage' in perms;
  }

  async list(perms: EffectivePermissions['permissions'], q: ListContentsQueryDto) {
    const manage = this.canManage(perms);
    const where: Prisma.KbContentWhereInput = {
      deletedAt: null,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.q
        ? {
            OR: [
              { titleAr: { contains: q.q, mode: 'insensitive' } },
              { titleEn: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(manage
        ? q.status
          ? { status: q.status }
          : {}
        : {
            // Viewers: published, public, and not expired (spec B3).
            status: 'PUBLISHED',
            isPublic: true,
            OR: [{ expiryAt: null }, { expiryAt: { gt: new Date() } }],
          }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.kbContent.findMany({
        where,
        include: { owner: OWNER_SELECT },
        orderBy: { updatedAt: 'desc' },
        ...skipTake(q),
      }),
      this.prisma.kbContent.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  async get(perms: EffectivePermissions['permissions'], id: string) {
    const content = await this.prisma.kbContent.findFirst({
      where: { id, deletedAt: null },
      include: { owner: OWNER_SELECT },
    });
    if (!content) throw new NotFoundException('Content not found');
    if (!this.canManage(perms)) {
      const expired = content.expiryAt !== null && content.expiryAt <= new Date();
      if (content.status !== 'PUBLISHED' || !content.isPublic || expired) {
        throw new NotFoundException('Content not found');
      }
    }
    const [versions, attachments] = await Promise.all([
      this.prisma.kbContent.findMany({
        where: { rootId: content.rootId, deletedAt: null },
        select: { id: true, version: true, status: true, publishAt: true },
        orderBy: { version: 'asc' },
      }),
      this.prisma.attachment.findMany({
        where: { entityType: 'kb_content', entityId: id, deletedAt: null },
      }),
    ]);
    return { ...content, versions, attachments };
  }

  async create(actor: AuthUser, dto: CreateContentDto, meta: Meta) {
    const content = await this.prisma.kbContent.create({
      data: {
        rootId: 'pending',
        kind: dto.kind,
        titleAr: dto.titleAr,
        titleEn: dto.titleEn,
        summaryAr: dto.summaryAr,
        summaryEn: dto.summaryEn,
        body: dto.body,
        videoUrl: dto.videoUrl,
        expiryAt: dto.expiryAt ? new Date(dto.expiryAt) : undefined,
        isPublic: dto.isPublic ?? true,
        ownerId: actor.userId,
      },
    });
    const updated = await this.prisma.kbContent.update({
      where: { id: content.id },
      data: { rootId: content.id },
      include: { owner: OWNER_SELECT },
    });

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'kb.content_create',
      entityType: 'kb_content',
      entityId: content.id,
      after: { kind: dto.kind, titleEn: dto.titleEn },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'kb_content',
      entityId: content.id,
      eventType: 'created',
      actorId: actor.userId,
    });
    return updated;
  }

  async update(actor: AuthUser, id: string, dto: UpdateContentDto, meta: Meta) {
    const before = await this.prisma.kbContent.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Content not found');
    if (before.status !== 'DRAFT') {
      throw new BadRequestException(
        'Published content is immutable — create a new version (§10.4)',
      );
    }
    const content = await this.prisma.kbContent.update({
      where: { id },
      data: { ...dto, expiryAt: dto.expiryAt ? new Date(dto.expiryAt) : undefined },
      include: { owner: OWNER_SELECT },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'kb.content_update',
      entityType: 'kb_content',
      entityId: id,
      before: { titleEn: before.titleEn },
      after: dto,
      ...meta,
    });
    return content;
  }

  /** §10.4: copy the latest version into a new DRAFT (version+1). */
  async newVersion(actor: AuthUser, id: string, meta: Meta) {
    const source = await this.prisma.kbContent.findFirst({ where: { id, deletedAt: null } });
    if (!source) throw new NotFoundException('Content not found');

    const latest = await this.prisma.kbContent.findFirst({
      where: { rootId: source.rootId },
      orderBy: { version: 'desc' },
    });
    const draft = await this.prisma.kbContent.create({
      data: {
        rootId: source.rootId,
        version: (latest?.version ?? source.version) + 1,
        kind: source.kind,
        titleAr: source.titleAr,
        titleEn: source.titleEn,
        summaryAr: source.summaryAr,
        summaryEn: source.summaryEn,
        body: source.body,
        videoUrl: source.videoUrl,
        expiryAt: source.expiryAt,
        isPublic: source.isPublic,
        ownerId: actor.userId,
        status: 'DRAFT',
      },
      include: { owner: OWNER_SELECT },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'kb.content_new_version',
      entityType: 'kb_content',
      entityId: draft.id,
      after: { rootId: source.rootId, version: draft.version },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'kb_content',
      entityId: source.rootId,
      eventType: 'version_created',
      actorId: actor.userId,
      payload: { version: draft.version },
    });
    return draft;
  }

  /** Publish a draft; the previously published version of the group is archived. */
  async publish(actor: AuthUser, id: string, meta: Meta) {
    const draft = await this.prisma.kbContent.findFirst({ where: { id, deletedAt: null } });
    if (!draft) throw new NotFoundException('Content not found');
    if (draft.status === 'PUBLISHED') throw new BadRequestException('Already published');

    await this.prisma.$transaction([
      this.prisma.kbContent.updateMany({
        where: { rootId: draft.rootId, status: 'PUBLISHED' },
        data: { status: 'ARCHIVED' },
      }),
      this.prisma.kbContent.update({
        where: { id },
        data: { status: 'PUBLISHED', publishAt: draft.publishAt ?? new Date() },
      }),
    ]);
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'kb.content_publish',
      entityType: 'kb_content',
      entityId: id,
      after: { version: draft.version },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'kb_content',
      entityId: draft.rootId,
      eventType: 'published',
      actorId: actor.userId,
      payload: { version: draft.version },
    });
    return this.prisma.kbContent.findUniqueOrThrow({
      where: { id },
      include: { owner: OWNER_SELECT },
    });
  }

  async archive(actor: AuthUser, id: string, meta: Meta) {
    const content = await this.prisma.kbContent.findFirst({ where: { id, deletedAt: null } });
    if (!content) throw new NotFoundException('Content not found');
    await this.prisma.kbContent.update({ where: { id }, data: { status: 'ARCHIVED' } });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'kb.content_archive',
      entityType: 'kb_content',
      entityId: id,
      before: { status: content.status },
      ...meta,
    });
  }
}
