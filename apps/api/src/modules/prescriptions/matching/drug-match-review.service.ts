import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { TimelineService } from '../../timeline/timeline.service';
import type { AuthUser } from '../../auth/current-user.decorator';
import { DrugMatchingEngine } from './drug-matching.engine';
import type {
  MarkNotMedicationDto,
  RejectCandidateDto,
  SelectDrugManuallyDto,
} from './drug-match-review.dto';

const DRUG_SUMMARY_SELECT = {
  id: true,
  materialNo: true,
  nameEn: true,
  nameAr: true,
  priceWithTax: true,
} as const;

const LINE_INCLUDE = {
  candidates: {
    orderBy: { rank: 'asc' as const },
    include: { matchedDrug: { select: DRUG_SUMMARY_SELECT } },
  },
  selectedDrug: { select: DRUG_SUMMARY_SELECT },
  decisions: { orderBy: { decidedAt: 'desc' as const } },
};

/**
 * CR-001 Phase 5 — the pharmacist review workflow (design summary §21-
 * 23): confirming/rejecting a candidate, manually selecting a drug the
 * engine didn't surface, or marking a line as not a medication at all.
 * Kept separate from PrescriptionsService (which owns the OCR pipeline
 * lifecycle) — a distinct concern with its own audit/decision trail.
 * Every mutating action here is the "recorded decision" the schema
 * comments on PrescriptionMedicationLine.reviewRequired refer to — the
 * only thing ever allowed to clear it, and it's always an explicit human
 * action (design summary §2: never silently confirm).
 */
@Injectable()
export class DrugMatchReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly engine: DrugMatchingEngine,
  ) {}

  private async requirePrescription(prescriptionId: string) {
    const rx = await this.prisma.prescription.findUnique({ where: { id: prescriptionId } });
    if (!rx) throw new NotFoundException('Prescription not found');
    return rx;
  }

  private async requireLine(prescriptionId: string, lineId: string) {
    const line = await this.prisma.prescriptionMedicationLine.findUnique({ where: { id: lineId } });
    if (!line || line.prescriptionId !== prescriptionId) {
      throw new NotFoundException('Medication line not found');
    }
    return line;
  }

  /** Defaults to the most recent run; `runId` fetches a specific
   *  historical one — no run is ever deleted, so a caller can always
   *  inspect what an earlier run actually produced. */
  async getDrugMatches(prescriptionId: string, runId?: string) {
    await this.requirePrescription(prescriptionId);
    const run = runId
      ? await this.prisma.drugMatchRun.findUnique({ where: { id: runId } })
      : await this.prisma.drugMatchRun.findFirst({
          where: { prescriptionId },
          orderBy: { createdAt: 'desc' },
        });
    if (!run || run.prescriptionId !== prescriptionId) {
      throw new NotFoundException('Drug match run not found');
    }
    const lines = await this.prisma.prescriptionMedicationLine.findMany({
      where: { matchRunId: run.id },
      orderBy: { lineIndex: 'asc' },
      include: LINE_INCLUDE,
    });
    return { run, lines };
  }

  listRuns(prescriptionId: string) {
    return this.requirePrescription(prescriptionId).then(() =>
      this.prisma.drugMatchRun.findMany({
        where: { prescriptionId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /** Manual, full reprocess — a fresh DrugMatchRun across every page,
   *  same as the automatic post-OCR trigger but reviewer-initiated and
   *  synchronous (mirrors PrescriptionsService.rerunOcr()'s own
   *  rationale: a single reviewer action, not the automatic pipeline). */
  async reprocess(actor: AuthUser, prescriptionId: string, meta: { ip?: string }) {
    await this.requirePrescription(prescriptionId);
    const run = await this.engine.run(prescriptionId, actor.userId);
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'prescriptions.drug_matching_reprocess',
      entityType: 'prescription',
      entityId: prescriptionId,
      after: { runId: run?.id ?? null },
      ...meta,
    });
    return run;
  }

  async confirmCandidate(
    actor: AuthUser,
    prescriptionId: string,
    lineId: string,
    candidateId: string,
    meta: { ip?: string },
  ) {
    const line = await this.requireLine(prescriptionId, lineId);
    const candidate = await this.prisma.prescriptionDrugCandidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate || candidate.medicationLineId !== lineId) {
      throw new NotFoundException('Candidate not found on this medication line');
    }
    const previousDrugId = line.selectedDrugId;
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.prescriptionDrugCandidate.update({
        where: { id: candidateId },
        data: {
          selected: true,
          rejected: false,
          status: 'CONFIRMED',
          reviewedById: actor.userId,
          reviewedAt: now,
        },
      }),
      this.prisma.prescriptionMedicationLine.update({
        where: { id: lineId },
        data: {
          selectedDrugId: candidate.matchedDrugId,
          selectedCandidateId: candidateId,
          selectedById: actor.userId,
          selectedAt: now,
          matchingStatus: 'CONFIRMED',
          reviewRequired: false,
        },
      }),
      this.prisma.drugMatchDecision.create({
        data: {
          medicationLineId: lineId,
          selectedDrugId: candidate.matchedDrugId,
          selectedCandidateId: candidateId,
          decisionType: 'CANDIDATE_CONFIRMED',
          decidedById: actor.userId,
          previousDrugId,
        },
      }),
    ]);

    await this.timeline.record({
      entityType: 'prescription_medication_line',
      entityId: lineId,
      eventType: 'candidate_confirmed',
      actorId: actor.userId,
      payload: { candidateId, drugId: candidate.matchedDrugId },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'prescriptions.drug_match_confirm_candidate',
      entityType: 'prescription_medication_line',
      entityId: lineId,
      after: { candidateId, drugId: candidate.matchedDrugId },
      ...meta,
    });

    return this.prisma.prescriptionMedicationLine.findUniqueOrThrow({
      where: { id: lineId },
      include: LINE_INCLUDE,
    });
  }

  async rejectCandidate(
    actor: AuthUser,
    prescriptionId: string,
    lineId: string,
    candidateId: string,
    dto: RejectCandidateDto,
    meta: { ip?: string },
  ) {
    const line = await this.requireLine(prescriptionId, lineId);
    const candidate = await this.prisma.prescriptionDrugCandidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate || candidate.medicationLineId !== lineId) {
      throw new NotFoundException('Candidate not found on this medication line');
    }

    await this.prisma.$transaction([
      this.prisma.prescriptionDrugCandidate.update({
        where: { id: candidateId },
        data: {
          rejected: true,
          selected: false,
          status: 'REJECTED',
          reviewedById: actor.userId,
          reviewedAt: new Date(),
        },
      }),
      this.prisma.drugMatchDecision.create({
        data: {
          medicationLineId: lineId,
          selectedCandidateId: candidateId,
          decisionType: 'CANDIDATE_REJECTED',
          decidedById: actor.userId,
          notes: dto.reason ?? null,
          previousDrugId: line.selectedDrugId,
        },
      }),
    ]);

    await this.timeline.record({
      entityType: 'prescription_medication_line',
      entityId: lineId,
      eventType: 'candidate_rejected',
      actorId: actor.userId,
      payload: { candidateId, reason: dto.reason ?? null },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'prescriptions.drug_match_reject_candidate',
      entityType: 'prescription_medication_line',
      entityId: lineId,
      after: { candidateId, reason: dto.reason ?? null },
      ...meta,
    });

    return this.prisma.prescriptionMedicationLine.findUniqueOrThrow({
      where: { id: lineId },
      include: LINE_INCLUDE,
    });
  }

  /** For when none of the engine's candidates are right — a pharmacist
   *  picks a real DIC drug directly. Never creates a
   *  PrescriptionDrugCandidate row for it (there's no score to show);
   *  the decision record and the line's own selectedDrugId are the only
   *  trace, exactly reflecting that this bypassed the engine entirely. */
  async selectDrugManually(
    actor: AuthUser,
    prescriptionId: string,
    lineId: string,
    dto: SelectDrugManuallyDto,
    meta: { ip?: string },
  ) {
    const line = await this.requireLine(prescriptionId, lineId);
    const drug = await this.prisma.drug.findUnique({ where: { id: dto.drugId } });
    if (!drug || drug.mergedIntoDrugId) {
      throw new BadRequestException('drugId does not reference an active DIC drug');
    }
    const previousDrugId = line.selectedDrugId;
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.prescriptionMedicationLine.update({
        where: { id: lineId },
        data: {
          selectedDrugId: drug.id,
          selectedCandidateId: null,
          selectedById: actor.userId,
          selectedAt: now,
          matchingStatus: 'MANUALLY_SELECTED',
          reviewRequired: false,
        },
      }),
      this.prisma.drugMatchDecision.create({
        data: {
          medicationLineId: lineId,
          selectedDrugId: drug.id,
          decisionType: 'MANUAL_DRUG_SELECTED',
          decidedById: actor.userId,
          notes: dto.reason ?? null,
          previousDrugId,
        },
      }),
    ]);

    await this.timeline.record({
      entityType: 'prescription_medication_line',
      entityId: lineId,
      eventType: 'drug_manually_selected',
      actorId: actor.userId,
      payload: { drugId: drug.id, reason: dto.reason ?? null },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'prescriptions.drug_match_select_manually',
      entityType: 'prescription_medication_line',
      entityId: lineId,
      after: { drugId: drug.id, reason: dto.reason ?? null },
      ...meta,
    });

    return this.prisma.prescriptionMedicationLine.findUniqueOrThrow({
      where: { id: lineId },
      include: LINE_INCLUDE,
    });
  }

  async markNotMedication(
    actor: AuthUser,
    prescriptionId: string,
    lineId: string,
    dto: MarkNotMedicationDto,
    meta: { ip?: string },
  ) {
    const line = await this.requireLine(prescriptionId, lineId);
    const previousDrugId = line.selectedDrugId;
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.prescriptionMedicationLine.update({
        where: { id: lineId },
        data: {
          selectedDrugId: null,
          selectedCandidateId: null,
          selectedById: actor.userId,
          selectedAt: now,
          matchingStatus: 'NOT_A_MEDICATION',
          reviewRequired: false,
        },
      }),
      this.prisma.drugMatchDecision.create({
        data: {
          medicationLineId: lineId,
          decisionType: 'NON_MEDICATION_LINE',
          decidedById: actor.userId,
          notes: dto.reason ?? null,
          previousDrugId,
        },
      }),
    ]);

    await this.timeline.record({
      entityType: 'prescription_medication_line',
      entityId: lineId,
      eventType: 'marked_not_medication',
      actorId: actor.userId,
      payload: { reason: dto.reason ?? null },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'prescriptions.drug_match_mark_not_medication',
      entityType: 'prescription_medication_line',
      entityId: lineId,
      after: { reason: dto.reason ?? null },
      ...meta,
    });

    return this.prisma.prescriptionMedicationLine.findUniqueOrThrow({
      where: { id: lineId },
      include: LINE_INCLUDE,
    });
  }
}
