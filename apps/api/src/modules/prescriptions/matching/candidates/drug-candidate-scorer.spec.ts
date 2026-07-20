import type { MatchWeights } from '../match-config.service';
import { DrugCandidateScorer } from './drug-candidate-scorer';
import type { DetectedConflict, MatchEvidenceContext, RawCandidate } from './types';

const WEIGHTS: MatchWeights = {
  name: 0.4,
  ingredient: 0.15,
  strength: 0.2,
  dosageForm: 0.1,
  context: 0.05,
  dataQuality: 0.1,
};
const OCR_ADJUSTMENT_MAX = 5;

function candidate(
  overrides: Partial<RawCandidate['drug']> = {},
  matchSource: RawCandidate['matchSource'] = 'EXACT_NAME',
  rawSimilarity = 1,
): RawCandidate {
  return {
    drug: {
      drugId: 'drug-1',
      materialNo: 'M1',
      nameEn: 'Augmentin 1g',
      nameAr: null,
      active: true,
      discontinued: false,
      dataQualityStatus: 'VERIFIED',
      dosageFormCode: 'TABLET',
      manufacturerNameEn: null,
      strengthText: '1 g',
      structuredStrengths: [],
      ingredientNamesEn: [],
      ...overrides,
    },
    matchSource,
    rawSimilarity,
    matchedText: 'Augmentin 1g',
    matchedAliasApproved: null,
  };
}

const STRENGTH = {
  rawStrengthText: '1 g',
  components: [{ value: 1, unit: 'g' }],
  numerator: null,
  numeratorUnit: null,
  denominator: null,
  denominatorUnit: null,
  ratio: null,
  normalizedStrengthText: '1 g',
  parseConfidence: 1,
};

function ctx(overrides: Partial<MatchEvidenceContext> = {}): MatchEvidenceContext {
  return {
    drugNameText: 'Augmentin',
    scientificNameText: null,
    parsedStrength: STRENGTH,
    dosageFormCode: 'TABLET',
    candidate: candidate(),
    candidateParsedStrength: STRENGTH,
    strengthMatchClass: 'EXACT',
    dosageFormMatchClass: 'EXACT',
    ocrConfidence: 0.9,
    extractionConfidence: 1,
    ...overrides,
  };
}

describe('DrugCandidateScorer', () => {
  const scorer = new DrugCandidateScorer();

  it('scores a clean exact match with neutral ingredient/context evidence', () => {
    const breakdown = scorer.score(ctx(), WEIGHTS, [], OCR_ADJUSTMENT_MAX);
    expect(breakdown.nameScore).toBe(100);
    expect(breakdown.ingredientScore).toBe(50);
    expect(breakdown.strengthScore).toBe(100);
    expect(breakdown.dosageFormScore).toBe(100);
    expect(breakdown.contextScore).toBe(50);
    expect(breakdown.dataQualityScore).toBe(100);
    expect(breakdown.weightedSubtotal).toBeCloseTo(90, 5);
    expect(breakdown.ocrReliabilityAdjustment).toBeCloseTo(3, 5);
    expect(breakdown.totalScore).toBeCloseTo(93, 5);
  });

  it('scores a fuzzy match lower on the name dimension, proportional to similarity', () => {
    const breakdown = scorer.score(
      ctx({ candidate: candidate({}, 'FUZZY_TRIGRAM', 0.5) }),
      WEIGHTS,
      [],
      OCR_ADJUSTMENT_MAX,
    );
    expect(breakdown.nameScore).toBe(50);
    expect(breakdown.totalScore).toBeCloseTo(73, 5);
  });

  it('never gives a fuzzy match full nameScore even at similarity 1.0', () => {
    const breakdown = scorer.score(
      ctx({ candidate: candidate({}, 'FUZZY_TRIGRAM', 1) }),
      WEIGHTS,
      [],
      OCR_ADJUSTMENT_MAX,
    );
    expect(breakdown.nameScore).toBeLessThanOrEqual(90);
  });

  it('applies a strength-conflict penalty on top of the zeroed strength dimension', () => {
    const conflicts: DetectedConflict[] = [
      { code: 'STRENGTH_CONFLICT', severity: 'WARNING', message: 'x', penaltyApplied: 30 },
    ];
    const breakdown = scorer.score(
      ctx({ strengthMatchClass: 'CONFLICT' }),
      WEIGHTS,
      conflicts,
      OCR_ADJUSTMENT_MAX,
    );
    expect(breakdown.strengthScore).toBe(0);
    expect(breakdown.totalScore).toBeCloseTo(43, 5);
  });

  it('scores ingredientScore via bigram similarity when scientific-name evidence is present', () => {
    const breakdown = scorer.score(
      ctx({
        scientificNameText: 'Amoxicillin',
        candidate: candidate({ ingredientNamesEn: ['Amoxicillin'] }),
      }),
      WEIGHTS,
      [],
      OCR_ADJUSTMENT_MAX,
    );
    expect(breakdown.ingredientScore).toBe(100);
  });

  it('gives EXACT_SCIENTIFIC candidates full ingredientScore regardless of the DIC ingredient list', () => {
    const breakdown = scorer.score(
      ctx({ candidate: candidate({}, 'EXACT_SCIENTIFIC') }),
      WEIGHTS,
      [],
      OCR_ADJUSTMENT_MAX,
    );
    expect(breakdown.ingredientScore).toBe(100);
  });

  it('boosts contextScore when the candidate manufacturer is mentioned nearby', () => {
    const breakdown = scorer.score(
      ctx({
        contextText: 'Prescribed by Dr. X — GSK product',
        candidate: candidate({ manufacturerNameEn: 'GSK' }),
      }),
      WEIGHTS,
      [],
      OCR_ADJUSTMENT_MAX,
    );
    expect(breakdown.contextScore).toBe(80);
  });

  it('scores dataQualityScore by DIC record status', () => {
    const needsReview = scorer.score(
      ctx({ candidate: candidate({ dataQualityStatus: 'NEEDS_REVIEW' }) }),
      WEIGHTS,
      [],
      OCR_ADJUSTMENT_MAX,
    );
    expect(needsReview.dataQualityScore).toBe(65);
  });

  it('clamps the OCR reliability adjustment to +/- the configured max', () => {
    const highConfidence = scorer.score(ctx({ ocrConfidence: 1 }), WEIGHTS, [], OCR_ADJUSTMENT_MAX);
    expect(highConfidence.ocrReliabilityAdjustment).toBe(5);
    const lowConfidence = scorer.score(ctx({ ocrConfidence: 0 }), WEIGHTS, [], OCR_ADJUSTMENT_MAX);
    expect(lowConfidence.ocrReliabilityAdjustment).toBe(-5);
  });

  it('clamps totalScore to [0, 100]', () => {
    const heavyConflicts: DetectedConflict[] = [
      { code: 'STRENGTH_CONFLICT', severity: 'WARNING', message: 'x', penaltyApplied: 30 },
      { code: 'DOSAGE_FORM_CONFLICT', severity: 'WARNING', message: 'x', penaltyApplied: 20 },
      { code: 'DISCONTINUED_DRUG', severity: 'BLOCKING', message: 'x', penaltyApplied: 25 },
      { code: 'INACTIVE_DRUG', severity: 'BLOCKING', message: 'x', penaltyApplied: 40 },
    ];
    const breakdown = scorer.score(
      ctx({ ocrConfidence: 0 }),
      WEIGHTS,
      heavyConflicts,
      OCR_ADJUSTMENT_MAX,
    );
    expect(breakdown.totalScore).toBe(0);
  });

  it('produces one evidence entry per scored dimension', () => {
    const breakdown = scorer.score(ctx(), WEIGHTS, [], OCR_ADJUSTMENT_MAX);
    const types = breakdown.evidence.map((e) => e.type).sort();
    expect(types).toEqual(
      ['CONTEXT', 'DATA_QUALITY', 'DOSAGE_FORM', 'INGREDIENT', 'NAME', 'STRENGTH'].sort(),
    );
  });
});
