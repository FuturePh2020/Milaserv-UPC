import type { MatchWeights } from '../match-config.service';
import { bigramSimilarity } from './string-similarity';
import type {
  CandidateScoreBreakdown,
  DetectedConflict,
  DrugMatchEvidence,
  MatchEvidenceContext,
} from './types';

const DATA_QUALITY_SCORES: Record<string, number> = {
  VERIFIED: 100,
  NEEDS_REVIEW: 65,
  INCOMPLETE: 40,
  DRAFT: 30,
  ARCHIVED: 20,
  REJECTED: 0,
};

const STRENGTH_CLASS_SCORES: Record<string, number> = {
  EXACT: 100,
  COMBINATION_EXACT: 100,
  EQUIVALENT_UNIT: 95,
  PARTIAL: 55,
  MISSING_FROM_OCR: 50,
  MISSING_FROM_DIC: 50,
  UNPARSEABLE: 45,
  CONFLICT: 0,
};

const DOSAGE_FORM_CLASS_SCORES: Record<string, number> = {
  EXACT: 100,
  SYNONYM: 90,
  COMPATIBLE: 70,
  MISSING: 50,
  CONFLICT: 0,
};

const NAME_SCORE_BY_SOURCE: Record<string, number> = {
  IDENTIFIER: 100,
  EXACT_NAME: 100,
  EXACT_ALIAS: 95,
  EXACT_SCIENTIFIC: 90,
  TRANSLITERATION: 75,
};

const CONTEXT_SCORE_NEUTRAL = 50;
const CONTEXT_SCORE_MANUFACTURER_MENTIONED = 80;

/**
 * CR-001 Phase 5 — weighted candidate scorer (design summary §7). Pure:
 * every classification it needs (strength/dosage-form match class) is
 * already computed on MatchEvidenceContext by the caller, so this file
 * never re-implements parsing logic that StrengthParser/DosageFormParser
 * already own. Never fabricates confidence for a dimension with no
 * evidence — an unset dimension scores NEUTRAL (50), not a guessed high
 * or a punitive zero; only an actual conflict scores 0 for that
 * dimension (design summary §2 "never silently confirm when uncertain").
 */
export class DrugCandidateScorer {
  score(
    ctx: MatchEvidenceContext,
    weights: MatchWeights,
    conflicts: DetectedConflict[],
    ocrReliabilityAdjustmentMax: number,
  ): CandidateScoreBreakdown {
    const evidence: DrugMatchEvidence[] = [];

    const nameScore = this.scoreName(ctx, evidence, weights.name);
    const ingredientScore = this.scoreIngredient(ctx, evidence, weights.ingredient);
    const strengthScore = this.scoreStrength(ctx, evidence, weights.strength);
    const dosageFormScore = this.scoreDosageForm(ctx, evidence, weights.dosageForm);
    const contextScore = this.scoreContext(ctx, evidence, weights.context);
    const dataQualityScore = this.scoreDataQuality(ctx, evidence, weights.dataQuality);

    const weightedSubtotal =
      nameScore * weights.name +
      ingredientScore * weights.ingredient +
      strengthScore * weights.strength +
      dosageFormScore * weights.dosageForm +
      contextScore * weights.context +
      dataQualityScore * weights.dataQuality;

    const conflictPenalty = conflicts.reduce((sum, c) => sum + c.penaltyApplied, 0);
    const ocrReliabilityAdjustment = this.computeOcrAdjustment(ctx, ocrReliabilityAdjustmentMax);

    const totalScore = clamp(weightedSubtotal - conflictPenalty + ocrReliabilityAdjustment, 0, 100);

    return {
      nameScore,
      ingredientScore,
      strengthScore,
      dosageFormScore,
      contextScore,
      dataQualityScore,
      ocrReliabilityAdjustment,
      weightedSubtotal,
      totalScore,
      evidence,
    };
  }

  private scoreName(
    ctx: MatchEvidenceContext,
    evidence: DrugMatchEvidence[],
    weight: number,
  ): number {
    const { candidate } = ctx;
    const raw =
      candidate.matchSource === 'FUZZY_TRIGRAM'
        ? Math.min(90, candidate.rawSimilarity * 100)
        : (NAME_SCORE_BY_SOURCE[candidate.matchSource] ?? 50);
    evidence.push({
      type: 'NAME',
      sourceText: ctx.drugNameText,
      matchedDICValue: candidate.matchedText,
      rawScore: raw,
      weightedScore: raw * weight,
      explanation: `Matched via ${candidate.matchSource} against "${candidate.matchedText}"`,
    });
    return raw;
  }

  private scoreIngredient(
    ctx: MatchEvidenceContext,
    evidence: DrugMatchEvidence[],
    weight: number,
  ): number {
    const { candidate } = ctx;
    if (candidate.matchSource === 'EXACT_SCIENTIFIC') {
      evidence.push({
        type: 'INGREDIENT',
        sourceText: ctx.drugNameText,
        matchedDICValue: candidate.matchedText,
        rawScore: 100,
        weightedScore: 100 * weight,
        explanation: 'The extracted name matched a scientific/generic ingredient name directly',
      });
      return 100;
    }
    if (!ctx.scientificNameText || candidate.drug.ingredientNamesEn.length === 0) {
      evidence.push({
        type: 'INGREDIENT',
        sourceText: ctx.scientificNameText,
        matchedDICValue: candidate.drug.ingredientNamesEn.join(', ') || null,
        rawScore: CONTEXT_SCORE_NEUTRAL,
        weightedScore: CONTEXT_SCORE_NEUTRAL * weight,
        explanation: 'No scientific-name evidence to compare — neither confirmed nor contradicted',
      });
      return CONTEXT_SCORE_NEUTRAL;
    }
    let best = { name: candidate.drug.ingredientNamesEn[0]!, similarity: 0 };
    for (const name of candidate.drug.ingredientNamesEn) {
      const similarity = bigramSimilarity(ctx.scientificNameText, name);
      if (similarity > best.similarity) best = { name, similarity };
    }
    const raw = best.similarity * 100;
    evidence.push({
      type: 'INGREDIENT',
      sourceText: ctx.scientificNameText,
      matchedDICValue: best.name,
      rawScore: raw,
      weightedScore: raw * weight,
      explanation: `Compared extracted scientific name against candidate ingredient "${best.name}"`,
    });
    return raw;
  }

  private scoreStrength(
    ctx: MatchEvidenceContext,
    evidence: DrugMatchEvidence[],
    weight: number,
  ): number {
    const raw = STRENGTH_CLASS_SCORES[ctx.strengthMatchClass] ?? 0;
    evidence.push({
      type: 'STRENGTH',
      sourceText: ctx.parsedStrength.rawStrengthText || null,
      matchedDICValue: ctx.candidateParsedStrength.rawStrengthText || null,
      rawScore: raw,
      weightedScore: raw * weight,
      explanation: `Strength classified as ${ctx.strengthMatchClass}`,
    });
    return raw;
  }

  private scoreDosageForm(
    ctx: MatchEvidenceContext,
    evidence: DrugMatchEvidence[],
    weight: number,
  ): number {
    const raw = DOSAGE_FORM_CLASS_SCORES[ctx.dosageFormMatchClass] ?? 0;
    evidence.push({
      type: 'DOSAGE_FORM',
      sourceText: ctx.dosageFormCode,
      matchedDICValue: ctx.candidate.drug.dosageFormCode,
      rawScore: raw,
      weightedScore: raw * weight,
      explanation: `Dosage form classified as ${ctx.dosageFormMatchClass}`,
    });
    return raw;
  }

  private scoreContext(
    ctx: MatchEvidenceContext,
    evidence: DrugMatchEvidence[],
    weight: number,
  ): number {
    const manufacturer = ctx.candidate.drug.manufacturerNameEn;
    const mentioned =
      !!ctx.contextText &&
      !!manufacturer &&
      ctx.contextText.toLowerCase().includes(manufacturer.toLowerCase());
    const raw = mentioned ? CONTEXT_SCORE_MANUFACTURER_MENTIONED : CONTEXT_SCORE_NEUTRAL;
    evidence.push({
      type: 'CONTEXT',
      sourceText: ctx.contextText ?? null,
      matchedDICValue: manufacturer,
      rawScore: raw,
      weightedScore: raw * weight,
      explanation: mentioned
        ? `Candidate manufacturer "${manufacturer}" appears in nearby text`
        : 'No supporting context evidence available',
    });
    return raw;
  }

  private scoreDataQuality(
    ctx: MatchEvidenceContext,
    evidence: DrugMatchEvidence[],
    weight: number,
  ): number {
    const raw = DATA_QUALITY_SCORES[ctx.candidate.drug.dataQualityStatus] ?? 50;
    evidence.push({
      type: 'DATA_QUALITY',
      sourceText: null,
      matchedDICValue: ctx.candidate.drug.dataQualityStatus,
      rawScore: raw,
      weightedScore: raw * weight,
      explanation: `Candidate DIC record data quality is ${ctx.candidate.drug.dataQualityStatus}`,
    });
    return raw;
  }

  private computeOcrAdjustment(ctx: MatchEvidenceContext, max: number): number {
    const confidence = ctx.ocrConfidence ?? ctx.extractionConfidence;
    if (confidence === null || confidence === undefined) return 0;
    const center = 0.75;
    const spread = 0.25;
    return clamp(((confidence - center) / spread) * max, -max, max);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
