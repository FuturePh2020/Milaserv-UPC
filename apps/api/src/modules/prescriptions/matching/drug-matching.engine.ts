import { Injectable, Logger } from '@nestjs/common';
import type {
  DrugMatchRun,
  MatchConfidenceLevel,
  MedicationLineMatchingStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { TimelineService } from '../../timeline/timeline.service';
import { MatchConfigService } from './match-config.service';
import type { MatchConfig } from './match-config.service';
import { PrescriptionLineSegmenter } from './prescription-line-segmenter';
import type { SegmentableBlock } from './prescription-line-segmenter';
import { MedicationPhraseExtractor } from './medication-phrase-extractor';
import { StrengthParser } from './strength-parser';
import { DosageFormParser } from './dosage-form-parser';
import { DrugCandidateGenerator } from './candidates/drug-candidate-generator';
import { DrugCandidateScorer } from './candidates/drug-candidate-scorer';
import { MatchConflictDetector } from './candidates/match-conflict-detector';
import { ConfidenceClassifier } from './candidates/confidence-classifier';
import { MatchExplanationBuilder } from './candidates/match-explanation-builder';
import { candidateStrengthFromStructured } from './candidates/structured-strength-mapper';
import type {
  CandidateScoreBreakdown,
  DetectedConflict,
  MatchEvidenceContext,
  RawCandidate,
} from './candidates/types';

interface RankedCandidate {
  candidate: RawCandidate;
  breakdown: CandidateScoreBreakdown;
  conflicts: DetectedConflict[];
}

const CONFIDENCE_TO_STATUS: Record<MatchConfidenceLevel, MedicationLineMatchingStatus> = {
  VERY_HIGH: 'HIGH_CONFIDENCE',
  HIGH: 'HIGH_CONFIDENCE',
  MEDIUM: 'AMBIGUOUS',
  LOW: 'LOW_CONFIDENCE',
  UNRESOLVED: 'UNRESOLVED',
};

/**
 * CR-001 Phase 5 — the DrugMatchingEngine orchestrator (design summary
 * §1/§20): SEGMENT -> EXTRACT -> GENERATE -> SCORE -> DETECT_CONFLICTS ->
 * SAVE -> ROUTE, run once per prescription across every page's current
 * OCR blocks. Only classifies OCRTextBlocks the segmenter groups into a
 * MEDICATION line — a header/date/instruction/patient-info line never
 * gets a PrescriptionMedicationLine row, since matching a candidate
 * drug against non-medication text has no meaning. Never deletes a
 * prior run; every call creates a brand-new DrugMatchRun (mirrors
 * PrescriptionOcrRun's own history discipline).
 */
@Injectable()
export class DrugMatchingEngine {
  private readonly logger = new Logger(DrugMatchingEngine.name);
  private readonly segmenter = new PrescriptionLineSegmenter();
  private readonly phraseExtractor = new MedicationPhraseExtractor();
  private readonly strengthParser = new StrengthParser();
  private readonly dosageFormParser = new DosageFormParser();
  private readonly scorer = new DrugCandidateScorer();
  private readonly conflictDetector = new MatchConflictDetector();
  private readonly confidenceClassifier = new ConfidenceClassifier();
  private readonly explanationBuilder = new MatchExplanationBuilder();

  constructor(
    private readonly prisma: PrismaService,
    private readonly matchConfig: MatchConfigService,
    private readonly candidateGenerator: DrugCandidateGenerator,
    private readonly timeline: TimelineService,
  ) {}

  async run(
    prescriptionId: string,
    initiatedById: string | null = null,
  ): Promise<DrugMatchRun | null> {
    // Idempotency/defensive guard, mirroring processPage()'s `if (!page)
    // return` — a prescription can be deleted between enqueue and a
    // delayed/retried job actually running.
    const prescription = await this.prisma.prescription.findUnique({
      where: { id: prescriptionId },
      select: { id: true },
    });
    if (!prescription) {
      this.logger.warn(`prescription ${prescriptionId} no longer exists — skipping match run`);
      return null;
    }

    const pages = await this.prisma.prescriptionPage.findMany({
      where: { prescriptionId },
      select: { id: true, currentOcrRunId: true },
    });
    const config = await this.matchConfig.resolve();

    const run = await this.prisma.drugMatchRun.create({
      data: {
        prescriptionId,
        ocrRunIdsJson: Object.fromEntries(
          pages.map((p) => [p.id, p.currentOcrRunId]),
        ) as Prisma.InputJsonValue,
        matchingEngineVersion: config.engineVersion,
        configurationSnapshotJson: config as unknown as Prisma.InputJsonValue,
        status: 'MATCHING_PROCESSING',
        startedAt: new Date(),
        initiatedById: initiatedById ?? undefined,
      },
    });

    try {
      let lineCount = 0;
      let matchedLineCount = 0;
      let unresolvedLineCount = 0;
      // PrescriptionMedicationLine.lineIndex is unique per (matchRunId,
      // lineIndex) — a single, run-wide counter, not the segmenter's own
      // page-local index (which restarts at 0 for every page and would
      // collide across a multi-page prescription).
      let globalLineIndex = 0;

      for (const page of pages) {
        if (!page.currentOcrRunId) continue;
        const blocks = await this.prisma.oCRTextBlock.findMany({
          where: { prescriptionPageId: page.id, ocrRunId: page.currentOcrRunId },
          orderBy: { lineNumber: 'asc' },
        });
        if (blocks.length === 0) continue;

        const segmentable: SegmentableBlock[] = blocks.map((b) => ({
          id: b.id,
          rawText: b.rawText,
          normalizedText: b.normalizedText,
          boundingBox: (b.boundingBox as SegmentableBlock['boundingBox']) ?? null,
          language: b.language,
          confidence: b.ocrConfidence,
          lineNumber: b.lineNumber,
        }));
        const lines = this.segmenter.segment(segmentable);

        for (const line of lines) {
          if (line.probableLineType !== 'MEDICATION') continue;
          lineCount += 1;

          const medicationLine = await this.prisma.prescriptionMedicationLine.create({
            data: {
              prescriptionId,
              prescriptionPageId: page.id,
              matchRunId: run.id,
              lineIndex: globalLineIndex++,
              rawText: line.rawText,
              normalizedText: line.normalizedText,
              sourceBlockIdsJson: line.sourceBlockIds as Prisma.InputJsonValue,
              boundingRegionJson: (line.boundingRegion ?? undefined) as
                Prisma.InputJsonValue | undefined,
              probableLineType: line.probableLineType,
              detectedLanguage: line.detectedLanguage,
              ocrConfidence: line.lineConfidence,
            },
          });

          const status = await this.matchLine(
            prescriptionId,
            medicationLine.id,
            run.id,
            line.normalizedText ?? line.rawText,
            line.lineConfidence,
            config,
          );
          if (status === 'HIGH_CONFIDENCE') matchedLineCount += 1;
          if (status === 'UNRESOLVED') unresolvedLineCount += 1;
        }
      }

      const completedAt = new Date();
      const updatedRun = await this.prisma.drugMatchRun.update({
        where: { id: run.id },
        data: {
          status: lineCount === 0 ? 'MATCHING_COMPLETED' : 'MATCHING_REVIEW_REQUIRED',
          completedAt,
          durationMs: completedAt.getTime() - run.createdAt.getTime(),
          lineCount,
          matchedLineCount,
          unresolvedLineCount,
        },
      });
      await this.timeline.record({
        entityType: 'prescription',
        entityId: prescriptionId,
        eventType: 'drug_matching_completed',
        payload: { runId: run.id, lineCount, matchedLineCount, unresolvedLineCount },
      });
      return updatedRun;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`drug match run ${run.id} failed for prescription ${prescriptionId}`, err);
      await this.prisma.drugMatchRun.update({
        where: { id: run.id },
        data: {
          status: 'MATCHING_FAILED',
          completedAt: new Date(),
          failureCode: 'MATCHING_ENGINE_ERROR',
          failureReason: message.slice(0, 1000),
        },
      });
      await this.timeline.record({
        entityType: 'prescription',
        entityId: prescriptionId,
        eventType: 'drug_matching_failed',
        payload: { runId: run.id, error: message },
      });
      throw err;
    }
  }

  /** EXTRACT -> GENERATE -> SCORE -> DETECT_CONFLICTS -> SAVE for one
   *  medication line; returns the line's final matching status. */
  private async matchLine(
    prescriptionId: string,
    medicationLineId: string,
    matchRunId: string,
    lineText: string,
    ocrConfidence: number | null,
    config: MatchConfig,
  ): Promise<MedicationLineMatchingStatus> {
    const phrase = this.phraseExtractor.extract(lineText);
    const extractedStrength = this.strengthParser.parse(phrase.probableStrength ?? '');

    const rawCandidates = await this.candidateGenerator.generate({
      nameText: phrase.probableDrugName,
      scientificText: phrase.probableScientificName,
      limits: config.limits,
    });

    const ranked: RankedCandidate[] = rawCandidates.map((candidate) => {
      const candidateStrength = candidateStrengthFromStructured(
        candidate.drug.structuredStrengths,
        candidate.drug.strengthText,
        this.strengthParser,
      );
      const strengthMatchClass = this.strengthParser.classify(extractedStrength, candidateStrength);
      const dosageFormMatchClass = this.dosageFormParser.classify(
        phrase.probableDosageForm,
        candidate.drug.dosageFormCode,
      );
      const ctx: MatchEvidenceContext = {
        drugNameText: phrase.probableDrugName,
        scientificNameText: phrase.probableScientificName,
        parsedStrength: extractedStrength,
        dosageFormCode: phrase.probableDosageForm,
        candidate,
        candidateParsedStrength: candidateStrength,
        strengthMatchClass,
        dosageFormMatchClass,
        ocrConfidence,
        extractionConfidence: phrase.confidence,
      };
      const conflicts = this.conflictDetector.detect(
        ctx,
        config.penalties,
        config.thresholds.minimumOcrConfidence,
      );
      const breakdown = this.scorer.score(
        ctx,
        config.weights,
        conflicts,
        config.ocrReliabilityAdjustmentMax,
      );
      return { candidate, breakdown, conflicts };
    });
    ranked.sort((a, b) => b.breakdown.totalScore - a.breakdown.totalScore);
    const capped = ranked.slice(0, config.limits.maxCandidatesPerLine);

    // Cross-candidate signals — only visible once the whole line's
    // candidate set is ranked, so MatchConflictDetector (single-candidate
    // scope) never emits these (design summary §15).
    if (capped.length >= 2) {
      const top = capped[0]!;
      const runnerUp = capped[1]!;
      const margin = top.breakdown.totalScore - runnerUp.breakdown.totalScore;
      if (
        margin < config.thresholds.minimumCandidateMargin &&
        top.breakdown.totalScore >= config.thresholds.highMinScore
      ) {
        top.conflicts.push({
          code: 'AMBIGUOUS_MARGIN',
          severity: 'WARNING',
          message: `Top candidate leads the runner-up by only ${Math.round(margin)} point(s)`,
          penaltyApplied: 0,
        });
      }
      const strongCount = capped.filter(
        (c) => c.breakdown.totalScore >= config.thresholds.highMinScore,
      ).length;
      if (strongCount >= 2) {
        top.conflicts.push({
          code: 'MULTIPLE_STRONG_CANDIDATES',
          severity: 'INFO',
          message: `${strongCount} candidates scored at or above the HIGH threshold`,
          penaltyApplied: 0,
        });
      }
    }

    const topScore = capped[0]?.breakdown.totalScore ?? null;
    const margin =
      capped.length >= 2 ? capped[0]!.breakdown.totalScore - capped[1]!.breakdown.totalScore : null;
    const lineConfidence = this.confidenceClassifier.classify(
      topScore,
      margin,
      ocrConfidence,
      config.thresholds,
    );
    const matchingStatus = CONFIDENCE_TO_STATUS[lineConfidence];

    for (let i = 0; i < capped.length; i++) {
      const entry = capped[i]!;
      const next = capped[i + 1];
      const candidateMargin = next ? entry.breakdown.totalScore - next.breakdown.totalScore : null;
      const candidateConfidence = this.confidenceClassifier.classify(
        entry.breakdown.totalScore,
        candidateMargin,
        ocrConfidence,
        config.thresholds,
      );
      await this.prisma.prescriptionDrugCandidate.create({
        data: {
          prescriptionId,
          medicationLineId,
          matchRunId,
          matchedDrugId: entry.candidate.drug.drugId,
          extractedDrugText: phrase.probableDrugName ?? lineText,
          extractedStrength: phrase.probableStrength,
          extractedDosageForm: phrase.probableDosageForm,
          matchConfidence: entry.breakdown.totalScore / 100,
          rank: i + 1,
          nameScore: entry.breakdown.nameScore,
          ingredientScore: entry.breakdown.ingredientScore,
          strengthScore: entry.breakdown.strengthScore,
          dosageFormScore: entry.breakdown.dosageFormScore,
          contextScore: entry.breakdown.contextScore,
          dataQualityScore: entry.breakdown.dataQualityScore,
          ocrReliabilityAdjustment: entry.breakdown.ocrReliabilityAdjustment,
          conflictPenalty: entry.conflicts.reduce((sum, c) => sum + c.penaltyApplied, 0),
          confidenceLevel: candidateConfidence,
          candidateMargin,
          evidenceJson: entry.breakdown.evidence as unknown as Prisma.InputJsonValue,
          conflictsJson: entry.conflicts as unknown as Prisma.InputJsonValue,
          explanationText: this.explanationBuilder.build(
            entry.candidate.drug.nameEn,
            entry.breakdown,
            entry.conflicts,
            candidateConfidence,
            candidateMargin,
          ),
        },
      });
    }

    await this.prisma.prescriptionMedicationLine.update({
      where: { id: medicationLineId },
      data: { matchingStatus, extractionConfidence: phrase.confidence },
    });

    return matchingStatus;
  }
}
