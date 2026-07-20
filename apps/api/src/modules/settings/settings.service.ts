import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Setting, SettingValueType } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { ListSettingsQueryDto, PutSettingDto } from './settings.dto';

function valueMatchesType(value: unknown, type: SettingValueType): boolean {
  switch (type) {
    case 'STRING':
      return typeof value === 'string';
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value);
    case 'BOOLEAN':
      return typeof value === 'boolean';
    case 'JSON':
      return value !== undefined;
  }
}

/**
 * Configuration Engine foundation (blueprint §8, ADR-008).
 * The SYSTEM row of each key is its catalog entry (type, labels, category).
 * DEPARTMENT/TEAM rows are overrides; reads fall back TEAM → DEPARTMENT → SYSTEM.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
  ) {}

  list(q: ListSettingsQueryDto) {
    const where: Prisma.SettingWhereInput = {
      ...(q.category ? { category: q.category } : {}),
      ...(q.scopeLevel ? { scopeLevel: q.scopeLevel } : {}),
      ...(q.scopeId !== undefined ? { scopeId: q.scopeId } : {}),
    };
    return this.prisma.setting.findMany({
      where,
      orderBy: [{ category: 'asc' }, { key: 'asc' }, { scopeLevel: 'asc' }],
    });
  }

  /** Resolve a value with TEAM → DEPARTMENT → SYSTEM fallback. */
  async resolve(key: string, ctx?: { departmentId?: string | null; teamId?: string | null }) {
    const rows = await this.prisma.setting.findMany({ where: { key } });
    if (rows.length === 0) throw new NotFoundException(`Unknown setting: ${key}`);
    const byLevel = (level: string, scopeId: string) =>
      rows.find((r) => r.scopeLevel === level && r.scopeId === scopeId);

    if (ctx?.teamId) {
      const t = byLevel('TEAM', ctx.teamId);
      if (t) return t.value;
    }
    if (ctx?.departmentId) {
      const d = byLevel('DEPARTMENT', ctx.departmentId);
      if (d) return d.value;
    }
    const system = rows.find((r) => r.scopeLevel === 'SYSTEM');
    if (!system) throw new NotFoundException(`Setting has no SYSTEM row: ${key}`);
    return system.value;
  }

  async put(actor: AuthUser, key: string, dto: PutSettingDto, meta: { ip?: string }) {
    const system = await this.prisma.setting.findUnique({
      where: { key_scopeLevel_scopeId: { key, scopeLevel: 'SYSTEM', scopeId: '' } },
    });
    if (!system) throw new NotFoundException(`Unknown setting: ${key}`);
    if (!valueMatchesType(dto.value, system.valueType)) {
      throw new BadRequestException(`Value must be of type ${system.valueType}`);
    }

    const scopeLevel = dto.scopeLevel ?? 'SYSTEM';
    const scopeId = scopeLevel === 'SYSTEM' ? '' : dto.scopeId;
    if (scopeLevel !== 'SYSTEM' && !scopeId) {
      throw new BadRequestException('scopeId is required for non-SYSTEM overrides');
    }

    const before: Setting | null = await this.prisma.setting.findUnique({
      where: { key_scopeLevel_scopeId: { key, scopeLevel, scopeId: scopeId ?? '' } },
    });

    const setting = await this.prisma.setting.upsert({
      where: { key_scopeLevel_scopeId: { key, scopeLevel, scopeId: scopeId ?? '' } },
      update: { value: dto.value as Prisma.InputJsonValue },
      create: {
        key,
        category: system.category,
        valueType: system.valueType,
        value: dto.value as Prisma.InputJsonValue,
        scopeLevel,
        scopeId: scopeId ?? '',
        labelAr: system.labelAr,
        labelEn: system.labelEn,
      },
    });

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'setting.update',
      entityType: 'setting',
      entityId: setting.id,
      before: before ? { key, scopeLevel, scopeId, value: before.value } : null,
      after: { key, scopeLevel, scopeId, value: dto.value },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'setting',
      entityId: setting.id,
      eventType: before ? 'updated' : 'override_created',
      actorId: actor.userId,
      payload: { key, scopeLevel, scopeId },
    });
    return setting;
  }

  async deleteOverride(
    actor: AuthUser,
    key: string,
    scopeLevel: 'DEPARTMENT' | 'TEAM',
    scopeId: string,
    meta: { ip?: string },
  ) {
    const row = await this.prisma.setting.findUnique({
      where: { key_scopeLevel_scopeId: { key, scopeLevel, scopeId } },
    });
    if (!row) throw new NotFoundException('Override not found');

    await this.prisma.setting.delete({ where: { id: row.id } });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'setting.override_delete',
      entityType: 'setting',
      entityId: row.id,
      before: { key, scopeLevel, scopeId, value: row.value },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'setting',
      entityId: row.id,
      eventType: 'override_deleted',
      actorId: actor.userId,
      payload: { key, scopeLevel, scopeId },
    });
  }
}
