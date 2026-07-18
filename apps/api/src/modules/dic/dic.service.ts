import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { IntegrationOperation } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { IntegrationsService } from '../integrations/integrations.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { CreateChangeRequestDto, DecideChangeRequestDto, SearchQueryDto } from './dic.dto';

/** H5 pharmacist-editable fields (plus coverage) — the H8 approval surface. */
const EDITABLE_FIELDS = ['activeIngredient', 'usage', 'offers', 'note'] as const;

/**
 * United Pharmacy Center — DIC (blueprint §15,
 * spec docs/specs/dic-spec-v1.0.md).
 */
@Injectable()
export class DicService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly integrations: IntegrationsService,
  ) {}

  onModuleInit() {
    // §21 DBS connector (integrations spec J3): live availability answers.
    this.integrations.registerHandler('dbs', (op, response) =>
      this.applyAvailability(op, response),
    );
  }

  // ── §21 DBS: on-demand availability refresh (spec J3) ──────────────

  async refreshAvailability(actor: AuthUser, drugId: string, meta: { ip?: string }) {
    const drug = await this.prisma.drug.findUnique({ where: { id: drugId } });
    if (!drug) throw new NotFoundException('Drug not found');
    const enabled = await this.settings.resolve('integrations.dbs.enabled').catch(() => false);
    if (!enabled || String(enabled) === 'false') {
      throw new UnprocessableEntityException('DBS link is not enabled');
    }
    const op = await this.integrations.enqueue({
      integrationKey: 'dbs',
      operation: 'availability_check',
      payload: { drugId, materialNo: drug.materialNo },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.availability_refresh',
      entityType: 'drug',
      entityId: drugId,
      after: { operationId: op.id },
      ...meta,
    });
    return { operationId: op.id, status: op.status };
  }

  private async applyAvailability(op: IntegrationOperation, response: unknown) {
    const payload = op.payload as { drugId?: string };
    if (!payload?.drugId) return;
    const body = response as { availability?: Record<string, unknown> } | null;
    if (!body || typeof body.availability !== 'object' || body.availability === null) {
      throw new Error('DBS response missing availability{}');
    }
    const availability: Record<string, number> = {};
    for (const [city, qty] of Object.entries(body.availability)) {
      const n = Number(qty);
      if (Number.isFinite(n)) availability[city] = n;
    }
    await this.prisma.drug.update({
      where: { id: payload.drugId },
      data: { availability },
    });
    await this.timeline.record({
      entityType: 'drug',
      entityId: payload.drugId,
      eventType: 'availability_refreshed',
      payload: { operationId: op.id, cities: Object.keys(availability).length },
    });
  }

  async catalogs() {
    const [itemTypes, companies, chunkSize] = await Promise.all([
      this.prisma.drugItemType.findMany({ where: { active: true }, orderBy: { key: 'asc' } }),
      this.prisma.insuranceCompany.findMany({ where: { active: true }, orderBy: { key: 'asc' } }),
      this.settings.resolve('dic.import.chunk_size').then(Number),
    ]);
    return { itemTypes, companies, chunkSize };
  }

  // ── §15.1 search: fields, partial, wildcard *, auto-complete ───────

  async search(q: SearchQueryDto) {
    // Wildcard `*` → SQL `%`; plain terms are contains-matches (partial).
    const pattern = q.q.includes('*') ? q.q.replaceAll('*', '%') : `%${q.q}%`;
    const like = (field: string): Prisma.DrugWhereInput => ({
      [field]: { contains: pattern.replaceAll('%', ''), mode: 'insensitive' },
    });
    // For wildcard patterns fall back to raw LIKE via Prisma's `search`-less
    // path: emulate with startsWith/endsWith/contains composition is lossy,
    // so use queryRaw for wildcard queries and the ORM for plain ones.
    const field = q.field ?? 'all';
    const limit = q.limit ?? 20;

    if (q.q.includes('*')) {
      const column =
        field === 'brand'
          ? 'brand'
          : field === 'ingredient'
            ? 'activeIngredient'
            : field === 'material'
              ? 'materialNo'
              : field === 'nameAr'
                ? 'nameAr'
                : field === 'nameEn'
                  ? 'nameEn'
                  : null;
      const rows = column
        ? await this.prisma.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id FROM "Drug" WHERE "${column}" ILIKE $1 LIMIT $2`,
            pattern,
            limit,
          )
        : await this.prisma.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id FROM "Drug" WHERE "nameEn" ILIKE $1 OR "nameAr" ILIKE $1
               OR "brand" ILIKE $1 OR "materialNo" ILIKE $1
               OR "activeIngredient" ILIKE $1 LIMIT $2`,
            pattern,
            limit,
          );
      return this.hydrate(rows.map((r) => r.id));
    }

    const where: Prisma.DrugWhereInput =
      field === 'all'
        ? {
            OR: [
              like('nameEn'),
              like('nameAr'),
              like('brand'),
              like('materialNo'),
              like('activeIngredient'),
            ],
          }
        : field === 'brand'
          ? like('brand')
          : field === 'ingredient'
            ? like('activeIngredient')
            : field === 'material'
              ? like('materialNo')
              : field === 'nameAr'
                ? like('nameAr')
                : like('nameEn');

    const items = await this.prisma.drug.findMany({
      where,
      include: { itemType: true, coverages: true },
      orderBy: { nameEn: 'asc' },
      take: limit,
    });
    return { items: items.map((d) => this.summary(d)) };
  }

  private async hydrate(ids: string[]) {
    const items = await this.prisma.drug.findMany({
      where: { id: { in: ids } },
      include: { itemType: true, coverages: true },
    });
    const order = new Map(ids.map((id, i) => [id, i]));
    items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return { items: items.map((d) => this.summary(d)) };
  }

  private summary(d: {
    id: string;
    materialNo: string;
    nameEn: string;
    nameAr: string | null;
    brand: string | null;
    priceWithTax: Prisma.Decimal | null;
    coded: boolean;
    raqeeb: boolean;
    itemType: { key: string; nameAr: string; nameEn: string } | null;
    coverages: { companyKey: string; covered: boolean }[];
  }) {
    return {
      id: d.id,
      materialNo: d.materialNo,
      nameEn: d.nameEn,
      nameAr: d.nameAr,
      brand: d.brand,
      priceWithTax: d.priceWithTax,
      coded: d.coded,
      raqeeb: d.raqeeb,
      itemType: d.itemType,
      coveredBy: d.coverages.filter((c) => c.covered).map((c) => c.companyKey),
    };
  }

  // ── §15.2 drug card ────────────────────────────────────────────────

  async get(id: string) {
    const drug = await this.prisma.drug.findUnique({
      where: { id },
      include: {
        itemType: true,
        coverages: { include: { company: true } },
        alternatives: { orderBy: { order: 'asc' } },
        crossSells: true,
      },
    });
    if (!drug) throw new NotFoundException('Drug not found');

    const related = [
      ...drug.alternatives.map((a) => a.altMaterialNo),
      ...drug.crossSells.map((c) => c.materialNo),
    ];
    const relatedDrugs = related.length
      ? await this.prisma.drug.findMany({
          where: { materialNo: { in: related } },
          select: {
            id: true,
            materialNo: true,
            nameEn: true,
            nameAr: true,
            priceWithTax: true,
          },
        })
      : [];
    const byMaterial = new Map(relatedDrugs.map((d) => [d.materialNo, d]));

    return {
      ...drug,
      alternatives: drug.alternatives.map((a) => ({
        materialNo: a.altMaterialNo,
        order: a.order,
        drug: byMaterial.get(a.altMaterialNo) ?? null,
      })),
      crossSells: drug.crossSells.map((c) => ({
        materialNo: c.materialNo,
        drug: byMaterial.get(c.materialNo) ?? null,
      })),
    };
  }

  // ── §15.3 approval workflow for master data changes (spec H8) ──────

  async createChangeRequest(
    actor: AuthUser,
    drugId: string,
    dto: CreateChangeRequestDto,
    meta: { ip?: string },
  ) {
    const drug = await this.prisma.drug.findUnique({ where: { id: drugId } });
    if (!drug) throw new NotFoundException('Drug not found');

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto.patch)) {
      if ((EDITABLE_FIELDS as readonly string[]).includes(key)) {
        if (value !== null && typeof value !== 'string') {
          throw new BadRequestException(`${key} must be a string`);
        }
        patch[key] = value;
      } else if (key === 'coverage') {
        const cov = value as { companyKey?: string; covered?: boolean };
        if (!cov?.companyKey || typeof cov.covered !== 'boolean') {
          throw new BadRequestException('coverage requires companyKey and covered');
        }
        const company = await this.prisma.insuranceCompany.findUnique({
          where: { key: cov.companyKey },
        });
        if (!company) throw new BadRequestException('Unknown insurance company');
        patch.coverage = { companyKey: cov.companyKey, covered: cov.covered };
      } else {
        throw new BadRequestException(`Field not editable via change request: ${key}`);
      }
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Empty patch');
    }

    const request = await this.prisma.drugChangeRequest.create({
      data: { drugId, patch: patch as Prisma.InputJsonValue, requestedById: actor.userId },
    });
    await this.timeline.record({
      entityType: 'drug',
      entityId: drugId,
      eventType: 'change_requested',
      actorId: actor.userId,
      payload: { requestId: request.id, fields: Object.keys(patch) },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.change_request',
      entityType: 'drug',
      entityId: drugId,
      after: patch,
      ...meta,
    });
    return request;
  }

  listChangeRequests(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    return this.prisma.drugChangeRequest.findMany({
      where: { status: status ?? 'PENDING' },
      include: {
        drug: { select: { id: true, materialNo: true, nameEn: true, nameAr: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  async decide(actor: AuthUser, id: string, dto: DecideChangeRequestDto, meta: { ip?: string }) {
    const request = await this.prisma.drugChangeRequest.findUnique({
      where: { id },
      include: { drug: true },
    });
    if (!request) throw new NotFoundException('Change request not found');
    if (request.status !== 'PENDING') {
      throw new UnprocessableEntityException(`Request is already ${request.status.toLowerCase()}`);
    }

    const now = new Date();
    if (dto.decision === 'approve') {
      const patch = request.patch as Record<string, unknown>;
      const drugData: Prisma.DrugUpdateInput = {};
      for (const field of EDITABLE_FIELDS) {
        if (field in patch) drugData[field] = patch[field] as string | null;
      }
      const coverage = patch.coverage as { companyKey: string; covered: boolean } | undefined;

      await this.prisma.$transaction(async (tx) => {
        if (Object.keys(drugData).length) {
          await tx.drug.update({ where: { id: request.drugId }, data: drugData });
        }
        if (coverage) {
          await tx.drugCoverage.upsert({
            where: {
              drugId_companyKey: { drugId: request.drugId, companyKey: coverage.companyKey },
            },
            update: { covered: coverage.covered },
            create: {
              drugId: request.drugId,
              companyKey: coverage.companyKey,
              covered: coverage.covered,
            },
          });
        }
        await tx.drugChangeRequest.update({
          where: { id },
          data: {
            status: 'APPROVED',
            decidedById: actor.userId,
            decisionNote: dto.note ?? null,
            decidedAt: now,
          },
        });
      });
    } else {
      await this.prisma.drugChangeRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          decidedById: actor.userId,
          decisionNote: dto.note ?? null,
          decidedAt: now,
        },
      });
    }

    await this.timeline.record({
      entityType: 'drug',
      entityId: request.drugId,
      eventType: dto.decision === 'approve' ? 'change_approved' : 'change_rejected',
      actorId: actor.userId,
      payload: { requestId: id },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: `dic.change_${dto.decision}`,
      entityType: 'drug',
      entityId: request.drugId,
      before: { requestId: id },
      after: { decision: dto.decision, note: dto.note ?? null },
      ...meta,
    });
    await this.notifications.notify({
      userId: request.requestedById,
      type: 'dic.change_decided',
      titleAr: `طلب تعديل ${request.drug.materialNo}: ${dto.decision === 'approve' ? 'معتمد' : 'مرفوض'}`,
      titleEn: `Change for ${request.drug.materialNo}: ${dto.decision === 'approve' ? 'approved' : 'rejected'}`,
      payload: { entityType: 'drug', entityId: request.drugId },
    });
    return this.prisma.drugChangeRequest.findUnique({ where: { id } });
  }
}
