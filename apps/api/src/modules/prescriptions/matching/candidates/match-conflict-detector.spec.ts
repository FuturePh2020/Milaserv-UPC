import type { MatchPenalties } from '../match-config.service';
import { MatchConflictDetector } from './match-conflict-detector';
import type { MatchEvidenceContext, RawCandidate } from './types';

const PENALTIES: MatchPenalties = {
  strengthConflict: 30,
  dosageFormConflict: 20,
  discontinuedDrug: 25,
  inactiveDrug: 40,
  unapprovedAlias: 10,
};
const MIN_OCR_CONFIDENCE = 0.5;

function candidate(
  overrides: Partial<RawCandidate['drug']> = {},
  matchSource: RawCandidate['matchSource'] = 'EXACT_NAME',
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
    rawSimilarity: 1,
    matchedText: 'Augmentin 1g',
    matchedAliasApproved: null,
  };
}

function ctx(overrides: Partial<MatchEvidenceContext> = {}): MatchEvidenceContext {
  return {
    drugNameText: 'Augmentin',
    scientificNameText: null,
    parsedStrength: {
      rawStrengthText: '1 g',
      components: [{ value: 1, unit: 'g' }],
      numerator: null,
      numeratorUnit: null,
      denominator: null,
      denominatorUnit: null,
      ratio: null,
      normalizedStrengthText: '1 g',
      parseConfidence: 1,
    },
    dosageFormCode: 'TABLET',
    candidate: candidate(),
    candidateParsedStrength: {
      rawStrengthText: '1 g',
      components: [{ value: 1, unit: 'g' }],
      numerator: null,
      numeratorUnit: null,
      denominator: null,
      denominatorUnit: null,
      ratio: null,
      normalizedStrengthText: '1 g',
      parseConfidence: 1,
    },
    strengthMatchClass: 'EXACT',
    dosageFormMatchClass: 'EXACT',
    ocrConfidence: 0.9,
    extractionConfidence: 1,
    ...overrides,
  };
}

describe('MatchConflictDetector', () => {
  const detector = new MatchConflictDetector();

  it('returns no conflicts for a clean exact match', () => {
    const conflicts = detector.detect(ctx(), PENALTIES, MIN_OCR_CONFIDENCE);
    expect(conflicts).toEqual([]);
  });

  it('flags STRENGTH_CONFLICT with the configured penalty', () => {
    const conflicts = detector.detect(
      ctx({ strengthMatchClass: 'CONFLICT' }),
      PENALTIES,
      MIN_OCR_CONFIDENCE,
    );
    expect(conflicts).toContainEqual(
      expect.objectContaining({ code: 'STRENGTH_CONFLICT', penaltyApplied: 30 }),
    );
  });

  it('flags DOSAGE_FORM_CONFLICT — an injection candidate against a tablet OCR read', () => {
    const conflicts = detector.detect(
      ctx({ dosageFormMatchClass: 'CONFLICT' }),
      PENALTIES,
      MIN_OCR_CONFIDENCE,
    );
    expect(conflicts).toContainEqual(
      expect.objectContaining({ code: 'DOSAGE_FORM_CONFLICT', penaltyApplied: 20 }),
    );
  });

  it('flags DISCONTINUED_DRUG as BLOCKING', () => {
    const conflicts = detector.detect(
      ctx({ candidate: candidate({ discontinued: true }) }),
      PENALTIES,
      MIN_OCR_CONFIDENCE,
    );
    expect(conflicts).toContainEqual(
      expect.objectContaining({
        code: 'DISCONTINUED_DRUG',
        severity: 'BLOCKING',
        penaltyApplied: 25,
      }),
    );
  });

  it('flags INACTIVE_DRUG as BLOCKING', () => {
    const conflicts = detector.detect(
      ctx({ candidate: candidate({ active: false }) }),
      PENALTIES,
      MIN_OCR_CONFIDENCE,
    );
    expect(conflicts).toContainEqual(
      expect.objectContaining({ code: 'INACTIVE_DRUG', severity: 'BLOCKING', penaltyApplied: 40 }),
    );
  });

  it('flags UNAPPROVED_ALIAS_RELIED_ON only when the match source is an unapproved alias', () => {
    const unapproved = candidate({}, 'EXACT_ALIAS');
    unapproved.matchedAliasApproved = false;
    const conflicts = detector.detect(
      ctx({ candidate: unapproved }),
      PENALTIES,
      MIN_OCR_CONFIDENCE,
    );
    expect(conflicts).toContainEqual(
      expect.objectContaining({ code: 'UNAPPROVED_ALIAS_RELIED_ON', penaltyApplied: 10 }),
    );

    const approved = candidate({}, 'EXACT_ALIAS');
    approved.matchedAliasApproved = true;
    const noConflicts = detector.detect(
      ctx({ candidate: approved }),
      PENALTIES,
      MIN_OCR_CONFIDENCE,
    );
    expect(noConflicts.map((c) => c.code)).not.toContain('UNAPPROVED_ALIAS_RELIED_ON');
  });

  it('flags LOW_OCR_CONFIDENCE as informational (zero penalty)', () => {
    const conflicts = detector.detect(ctx({ ocrConfidence: 0.2 }), PENALTIES, MIN_OCR_CONFIDENCE);
    expect(conflicts).toContainEqual(
      expect.objectContaining({ code: 'LOW_OCR_CONFIDENCE', severity: 'INFO', penaltyApplied: 0 }),
    );
  });

  it('flags NAME_ONLY_WEAK_EVIDENCE when nothing but the name matched', () => {
    const conflicts = detector.detect(
      ctx({
        scientificNameText: null,
        strengthMatchClass: 'MISSING_FROM_OCR',
        dosageFormMatchClass: 'MISSING',
      }),
      PENALTIES,
      MIN_OCR_CONFIDENCE,
    );
    expect(conflicts).toContainEqual(expect.objectContaining({ code: 'NAME_ONLY_WEAK_EVIDENCE' }));
  });

  it('flags DATA_QUALITY_LOW for a DRAFT/INCOMPLETE/REJECTED/ARCHIVED candidate record', () => {
    const conflicts = detector.detect(
      ctx({ candidate: candidate({ dataQualityStatus: 'INCOMPLETE' }) }),
      PENALTIES,
      MIN_OCR_CONFIDENCE,
    );
    expect(conflicts).toContainEqual(expect.objectContaining({ code: 'DATA_QUALITY_LOW' }));
  });

  it('does not flag DATA_QUALITY_LOW for VERIFIED or NEEDS_REVIEW', () => {
    const verified = detector.detect(
      ctx({ candidate: candidate({ dataQualityStatus: 'VERIFIED' }) }),
      PENALTIES,
      MIN_OCR_CONFIDENCE,
    );
    expect(verified.map((c) => c.code)).not.toContain('DATA_QUALITY_LOW');
  });
});
