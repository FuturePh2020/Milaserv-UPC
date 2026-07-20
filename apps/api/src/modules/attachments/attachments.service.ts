import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { EffectivePermissions } from '../permissions/scope';
import { LocalDiskStorage, newStorageKey } from './storage';

export interface UploadInput {
  entityType: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
}

/**
 * Attachment Engine foundation (blueprint §8). Size & MIME limits come from
 * Settings (ADR-008). Access rule this phase (spec A7): uploader or
 * attachment.manage; ticket-entity rules tighten in the ticketing step.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly storage: LocalDiskStorage,
  ) {}

  async upload(actor: AuthUser, input: UploadInput, meta: { ip?: string }) {
    const maxMb = Number(await this.settings.resolve('attachments.max_size_mb'));
    if (input.data.length > maxMb * 1024 * 1024) {
      throw new BadRequestException(`File exceeds the ${maxMb} MB limit`);
    }
    const allowed = (await this.settings.resolve('attachments.allowed_mime')) as string[];
    if (!allowed.includes(input.mimeType)) {
      throw new BadRequestException(`File type not allowed: ${input.mimeType}`);
    }

    const storageKey = newStorageKey(input.fileName);
    await this.storage.put(storageKey, input.data);

    const attachment = await this.prisma.attachment.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.data.length,
        storageKey,
        uploadedById: actor.userId,
      },
    });

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'attachment.upload',
      entityType: input.entityType,
      entityId: input.entityId,
      after: { attachmentId: attachment.id, fileName: input.fileName, size: input.data.length },
      ...meta,
    });
    return attachment;
  }

  async listFor(entityType: string, entityId: string) {
    return this.prisma.attachment.findMany({
      where: { entityType, entityId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  private canAccess(
    actor: AuthUser,
    permissions: EffectivePermissions['permissions'],
    uploadedById: string,
  ): boolean {
    return uploadedById === actor.userId || 'attachment.manage' in permissions;
  }

  async download(
    actor: AuthUser,
    permissions: EffectivePermissions['permissions'],
    id: string,
    meta: { ip?: string },
  ) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    if (!this.canAccess(actor, permissions, attachment.uploadedById)) {
      throw new ForbiddenException('No access to this attachment');
    }

    const data = await this.storage.get(attachment.storageKey);
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'attachment.download',
      entityType: attachment.entityType,
      entityId: attachment.entityId,
      after: { attachmentId: id },
      ...meta,
    });
    return { attachment, data };
  }

  async remove(
    actor: AuthUser,
    permissions: EffectivePermissions['permissions'],
    id: string,
    meta: { ip?: string },
  ) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    if (!this.canAccess(actor, permissions, attachment.uploadedById)) {
      throw new ForbiddenException('No access to this attachment');
    }

    // Soft delete (§19.3); the blob is retained for audit until retention rules exist.
    await this.prisma.attachment.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'attachment.delete',
      entityType: attachment.entityType,
      entityId: attachment.entityId,
      before: { attachmentId: id, fileName: attachment.fileName },
      ...meta,
    });
  }
}
