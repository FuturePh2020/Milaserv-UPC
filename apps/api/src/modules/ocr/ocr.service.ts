import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { IntegrationOperation, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { RequestScope } from '../permissions/scope';
import { OcrMatchService } from './ocr-match.service';
import type {
  AddLineDto,
  ConfirmPrescriptionDto,
  CreatePrescriptionDto,
  DecideLineDto,
  ListPrescriptionsQueryDto,
  RejectPrescriptionDto,
} from './ocr.dto';

const MAX_ENGINE_LINES = 50;

/**
 * §17 OCR Prescription Processing (spec docs/specs/ocr-spec-v1.0.md).
 * Extraction rides the Integration Engine (I1); confirmation always requires
 * a human `ocr.review` holder — no auto-approval path exists (I4).
 */
@Injectable()
export class OcrService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly notifications: NotificationsService,
    private readonly numbering: NumberingService,
    private readonly integrations: IntegrationsService,
    private readonly settings: SettingsService,
    private readonly matcher: OcrMatchService,
  ) {}

  onModuleInit() {
    // I1: apply engine results when an ocr.extract operation succeeds.
    this.integrations.registerHandler('ocr', (op, response) => this.applyResults(op, response));
  }

  async config() {
    return {
      minConfidence: Number(await this.settings.resolve('ocr.review.min_confidence')),
    };
  }

  // ── upload flow (spec I2) ──────────────────────────────────────────

  async create(actor: AuthUser, dto: CreatePrescriptionDto, meta: { ip?: string }) {
    const number = await this.numbering.next('ocr.number.format', 'prescription');
    const rx = await this.prisma.prescription.create({
      data: { number, uploadedById: actor.userId, note: dto.note ?? null },
    });
    await this.timeline.record({
      entityType: 'prescription',
      entityId: rx.id,
      eventType: 'created',
      actorId: actor.userId,
      payload: { number },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ocr.create',
      entityType: 'prescription',
      entityId: rx.id,
      after: { number },
      ...meta,
    });
    return rx;
  }

  async submit(actor: AuthUser, id: string, meta: { ip?: string }) {
    const rx = await this.prisma.prescription.findUnique({ where: { id } });
    if (!rx) throw new NotFoundException('Prescription not found');
    if (rx.status !== 'UPLOADED') {
      throw new UnprocessableEntityException(`Prescription is ${rx.status.toLowerCase()}`);
    }
    const attachment = await this.prisma.attachment.findFirst({
      where: { entityType: 'prescription', entityId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!attachment) {
      throw new BadRequestException('Attach the prescription image/PDF before submitting');
    }

    const op = await this.integrations.enqueue({
      integrationKey: 'ocr',
      operation: 'extract',
      payload: {
        prescriptionId: id,
        attachmentId: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
      },
    });
    const updated = await this.prisma.prescription.update({
      where: { id },
      data: { status: 'EXTRACTING', attachmentId: attachment.id },
    });
    await this.timeline.record({
      entityType: 'prescription',
      entityId: id,
      eventType: 'submitted',
      actorId: actor.userId,
      payload: { operationId: op.id },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ocr.submit',
      entityType: 'prescription',
      entityId: id,
      after: { operationId: op.id, attachmentId: attachment.id },
      ...meta,
    });
    return updated;
  }

  // ── engine result application (spec I1, late-result guard) ─────────

  async applyResults(op: IntegrationOperation, response: unknown) {
    const payload = op.payload as { prescriptionId?: string };
    const id = payload?.prescriptionId;
    if (!id) return;
    const rx = await this.prisma.prescription.findUnique({ where: { id } });
    if (!rx) return;

    if (rx.status !== 'EXTRACTING') {
      // Human work already started/finished — never overwrite it (I1).
      await this.timeline.record({
        entityType: 'prescription',
        entityId: id,
        eventType: 'late_result_ignored',
        payload: { operationId: op.id, status: rx.status },
      });
      return;
    }

    const body = response as { lines?: { text?: unknown; confidence?: unknown }[] } | null;
    if (!body || !Array.isArray(body.lines)) {
      throw new Error('OCR engine response missing lines[]');
    }
    const lines = body.lines
      .map((l) => ({
        text: String(l?.text ?? '').trim(),
        confidence:
          typeof l?.confidence === 'number' ? Math.min(1, Math.max(0, l.confidence)) : null,
      }))
      .filter((l) => l.text)
      .slice(0, MAX_ENGINE_LINES);

    const data: Prisma.PrescriptionLineCreateManyInput[] = [];
    for (const [i, line] of lines.entries()) {
      const match = await this.matcher.match(line.text);
      data.push({
        prescriptionId: id,
        lineNo: i + 1,
        rawText: line.text,
        engineConfidence: line.confidence,
        matchedDrugId: match?.drugId ?? null,
        matchScore: match?.score ?? null,
      });
    }

    await this.prisma.$transaction([
      this.prisma.prescriptionLine.deleteMany({ where: { prescriptionId: id } }),
      ...(data.length ? [this.prisma.prescriptionLine.createMany({ data })] : []),
      this.prisma.prescription.update({
        where: { id },
        data: {
          status: 'REVIEW',
          engineMeta: { operationId: op.id, lineCount: data.length, receivedAt: new Date() },
        },
      }),
    ]);
    await this.timeline.record({
      entityType: 'prescription',
      entityId: id,
      eventType: 'extracted',
      payload: { lineCount: data.length },
    });
    await this.notifications.notify({
      userId: rx.uploadedById,
      type: 'ocr.extracted',
      titleAr: `اكتمل استخراج الوصفة ${rx.number} (${data.length} سطرًا) — بانتظار المراجعة`,
      titleEn: `Prescription ${rx.number} extracted (${data.length} lines) — awaiting review`,
      payload: { entityType: 'prescription', entityId: id },
    });
  }

  // ── list & detail (spec I5 joins) ──────────────────────────────────

  private async scopeFilter(scope: RequestScope): Promise<Prisma.PrescriptionWhereInput> {
    const self = scope.context.userId;
    switch (scope.scope) {
      case 'ALL_DATA':
      case 'BRANCH': // provisional ranks — behave as ALL until those modules activate
      case 'PARTNER':
        return {};
      case 'DEPARTMENT': {
        if (!scope.context.departmentId) return { uploadedById: self };
        const users = await this.prisma.user.findMany({
          where: { departmentId: scope.context.departmentId },
          select: { id: true },
        });
        return { uploadedById: { in: [...users.map((u) => u.id), self] } };
      }
      case 'MULTIPLE_TEAMS':
      case 'MY_TEAM': {
        const teamIds =
          scope.scope === 'MULTIPLE_TEAMS' ? (scope.teamIds ?? []) : scope.context.teamIds;
        const users = await this.prisma.user.findMany({
          where: { teams: { some: { teamId: { in: teamIds } } } },
          select: { id: true },
        });
        return { uploadedById: { in: [...users.map((u) => u.id), self] } };
      }
      default:
        return { uploadedById: self };
    }
  }

  async list(scope: RequestScope, q: ListPrescriptionsQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where: Prisma.PrescriptionWhereInput = {
      ...(await this.scopeFilter(scope)),
      ...(q.status ? { status: q.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.prescription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { lines: true } } },
      }),
      this.prisma.prescription.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(id: string) {
    const rx = await this.prisma.prescription.findUnique({
      where: { id },
      include: {
        lines: {
          orderBy: { lineNo: 'asc' },
          include: {
            matchedDrug: {
              select: {
                id: true,
                materialNo: true,
                nameEn: true,
                nameAr: true,
                priceWithTax: true,
                coded: true,
                availability: true,
              },
            },
          },
        },
      },
    });
    if (!rx) throw new NotFoundException('Prescription not found');

    // I5: alternatives for every matched drug in one pass.
    const matchedIds = [
      ...new Set(rx.lines.map((l) => l.matchedDrugId).filter(Boolean)),
    ] as string[];
    const alts = matchedIds.length
      ? await this.prisma.drugAlternative.findMany({
          where: { drugId: { in: matchedIds } },
          orderBy: { order: 'asc' },
        })
      : [];
    const altDrugs = alts.length
      ? await this.prisma.drug.findMany({
          where: { materialNo: { in: [...new Set(alts.map((a) => a.altMaterialNo))] } },
          select: { id: true, materialNo: true, nameEn: true, nameAr: true, priceWithTax: true },
        })
      : [];
    const byMaterial = new Map(altDrugs.map((d) => [d.materialNo, d]));
    const altsByDrug = new Map<
      string,
      { materialNo: string; drug: (typeof altDrugs)[number] | null }[]
    >();
    for (const a of alts) {
      const list = altsByDrug.get(a.drugId) ?? [];
      if (list.length < 5)
        list.push({ materialNo: a.altMaterialNo, drug: byMaterial.get(a.altMaterialNo) ?? null });
      altsByDrug.set(a.drugId, list);
    }

    return {
      ...rx,
      lines: rx.lines.map((l) => ({
        ...l,
        alternatives: l.matchedDrugId ? (altsByDrug.get(l.matchedDrugId) ?? []) : [],
      })),
    };
  }

  // ── human review (spec I4) ─────────────────────────────────────────

  async addLine(actor: AuthUser, id: string, dto: AddLineDto, meta: { ip?: string }) {
    const rx = await this.prisma.prescription.findUnique({
      where: { id },
      include: { lines: { select: { lineNo: true }, orderBy: { lineNo: 'desc' }, take: 1 } },
    });
    if (!rx) throw new NotFoundException('Prescription not found');
    if (rx.status === 'CONFIRMED' || rx.status === 'REJECTED') {
      throw new UnprocessableEntityException(`Prescription is ${rx.status.toLowerCase()}`);
    }

    const match = await this.matcher.match(dto.rawText);
    const line = await this.prisma.prescriptionLine.create({
      data: {
        prescriptionId: id,
        lineNo: (rx.lines[0]?.lineNo ?? 0) + 1,
        rawText: dto.rawText.trim(),
        matchedDrugId: match?.drugId ?? null,
        matchScore: match?.score ?? null,
      },
    });
    // Manual entry moves the prescription into review; a late engine result
    // arriving after this point is ignored (I1 guard).
    if (rx.status !== 'REVIEW') {
      await this.prisma.prescription.update({ where: { id }, data: { status: 'REVIEW' } });
    }
    await this.timeline.record({
      entityType: 'prescription',
      entityId: id,
      eventType: 'line_added',
      actorId: actor.userId,
      payload: { lineId: line.id, rawText: line.rawText },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ocr.line_add',
      entityType: 'prescription',
      entityId: id,
      after: { lineId: line.id, rawText: line.rawText },
      ...meta,
    });
    return line;
  }

  async decideLine(actor: AuthUser, lineId: string, dto: DecideLineDto, meta: { ip?: string }) {
    const line = await this.prisma.prescriptionLine.findUnique({
      where: { id: lineId },
      include: { prescription: true },
    });
    if (!line) throw new NotFoundException('Line not found');
    if (line.prescription.status !== 'REVIEW') {
      throw new UnprocessableEntityException(
        `Prescription is ${line.prescription.status.toLowerCase()}`,
      );
    }

    let data: Prisma.PrescriptionLineUpdateInput;
    if (dto.decision === 'confirm') {
      if (!line.matchedDrugId) {
        throw new BadRequestException('Line has no matched drug — correct it instead');
      }
      data = { status: 'CONFIRMED' };
    } else if (dto.decision === 'reject') {
      data = { status: 'REJECTED' };
    } else {
      if (!dto.drugId) throw new BadRequestException('drugId is required for correction');
      const drug = await this.prisma.drug.findUnique({ where: { id: dto.drugId } });
      if (!drug) throw new BadRequestException('Unknown drug');
      // Human-picked match: no algorithmic score applies (spec I3).
      data = { status: 'CORRECTED', matchedDrug: { connect: { id: drug.id } }, matchScore: null };
    }

    const updated = await this.prisma.prescriptionLine.update({ where: { id: lineId }, data });
    await this.timeline.record({
      entityType: 'prescription',
      entityId: line.prescriptionId,
      eventType: `line_${dto.decision}ed`,
      actorId: actor.userId,
      payload: { lineId, drugId: dto.drugId ?? line.matchedDrugId },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: `ocr.line_${dto.decision}`,
      entityType: 'prescription_line',
      entityId: lineId,
      before: { status: line.status, matchedDrugId: line.matchedDrugId },
      after: { status: updated.status, matchedDrugId: updated.matchedDrugId },
      ...meta,
    });
    return updated;
  }

  async confirm(actor: AuthUser, id: string, dto: ConfirmPrescriptionDto, meta: { ip?: string }) {
    const rx = await this.prisma.prescription.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!rx) throw new NotFoundException('Prescription not found');
    if (rx.status !== 'REVIEW') {
      throw new UnprocessableEntityException(`Prescription is ${rx.status.toLowerCase()}`);
    }
    if (rx.lines.some((l) => l.status === 'SUGGESTED')) {
      throw new UnprocessableEntityException('All lines must be reviewed before confirming');
    }
    if (!rx.lines.some((l) => l.status === 'CONFIRMED' || l.status === 'CORRECTED')) {
      throw new UnprocessableEntityException('Nothing confirmed — reject the prescription instead');
    }

    // I6: link existing records only.
    let ticketId: string | null = null;
    if (dto.ticketNo) {
      const ticket = await this.prisma.ticket.findFirst({
        where: {
          OR: [{ internalNumber: dto.ticketNo }, { customerComplaintNumber: dto.ticketNo }],
        },
      });
      if (!ticket) throw new BadRequestException(`Unknown ticket: ${dto.ticketNo}`);
      ticketId = ticket.id;
    }

    const updated = await this.prisma.prescription.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        reviewedById: actor.userId,
        reviewedAt: new Date(),
        ticketId,
        relatedOrderNo: dto.orderNo ?? null,
        note: dto.note ?? rx.note,
      },
    });
    await this.timeline.record({
      entityType: 'prescription',
      entityId: id,
      eventType: 'confirmed',
      actorId: actor.userId,
      payload: { ticketId, orderNo: dto.orderNo ?? null },
    });
    if (ticketId) {
      await this.timeline.record({
        entityType: 'ticket',
        entityId: ticketId,
        eventType: 'prescription_linked',
        actorId: actor.userId,
        payload: { prescriptionId: id, number: rx.number },
      });
    }
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ocr.confirm',
      entityType: 'prescription',
      entityId: id,
      after: { ticketId, orderNo: dto.orderNo ?? null },
      ...meta,
    });
    await this.notifications.notify({
      userId: rx.uploadedById,
      type: 'ocr.decided',
      titleAr: `تم اعتماد الوصفة ${rx.number}`,
      titleEn: `Prescription ${rx.number} confirmed`,
      payload: { entityType: 'prescription', entityId: id },
    });
    return updated;
  }

  async reject(actor: AuthUser, id: string, dto: RejectPrescriptionDto, meta: { ip?: string }) {
    const rx = await this.prisma.prescription.findUnique({ where: { id } });
    if (!rx) throw new NotFoundException('Prescription not found');
    if (rx.status === 'CONFIRMED' || rx.status === 'REJECTED') {
      throw new UnprocessableEntityException(`Prescription is ${rx.status.toLowerCase()}`);
    }

    const updated = await this.prisma.prescription.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: actor.userId,
        reviewedAt: new Date(),
        note: dto.note,
      },
    });
    await this.timeline.record({
      entityType: 'prescription',
      entityId: id,
      eventType: 'rejected',
      actorId: actor.userId,
      payload: { note: dto.note },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ocr.reject',
      entityType: 'prescription',
      entityId: id,
      after: { note: dto.note },
      ...meta,
    });
    await this.notifications.notify({
      userId: rx.uploadedById,
      type: 'ocr.decided',
      titleAr: `تم رفض الوصفة ${rx.number}`,
      titleEn: `Prescription ${rx.number} rejected`,
      payload: { entityType: 'prescription', entityId: id },
    });
    return updated;
  }
}
