import { MatchExplanationBuilder } from './match-explanation-builder';
import type { CandidateScoreBreakdown, DetectedConflict } from './types';

function breakdown(overrides: Partial<CandidateScoreBreakdown> = {}): CandidateScoreBreakdown {
  return {
    nameScore: 100,
    ingredientScore: 50,
    strengthScore: 100,
    dosageFormScore: 100,
    contextScore: 50,
    dataQualityScore: 100,
    ocrReliabilityAdjustment: 3,
    weightedSubtotal: 90,
    totalScore: 93,
    evidence: [
      {
        type: 'NAME',
        sourceText: 'Augmentin',
        matchedDICValue: 'Augmentin 1g',
        rawScore: 100,
        weightedScore: 40,
        explanation: 'Matched via EXACT_NAME against "Augmentin 1g"',
      },
      {
        type: 'STRENGTH',
        sourceText: '1 g',
        matchedDICValue: '1 g',
        rawScore: 100,
        weightedScore: 20,
        explanation: 'Strength classified as EXACT',
      },
    ],
    ...overrides,
  };
}

describe('MatchExplanationBuilder', () => {
  const builder = new MatchExplanationBuilder();

  it('includes the candidate name, score, and confidence band', () => {
    const text = builder.build('Augmentin 1g', breakdown(), [], 'VERY_HIGH', 36);
    expect(text).toContain('Augmentin 1g');
    expect(text).toContain('93/100');
    expect(text).toContain('VERY_HIGH');
  });

  it('includes the margin over the runner-up when provided', () => {
    const text = builder.build('Augmentin 1g', breakdown(), [], 'VERY_HIGH', 36);
    expect(text).toContain('36');
  });

  it('omits a margin sentence when there is no runner-up', () => {
    const text = builder.build('Augmentin 1g', breakdown(), [], 'MEDIUM', null);
    expect(text).not.toContain('Leads the next candidate');
  });

  it('states "no conflicts detected" when the conflict list is empty', () => {
    const text = builder.build('Augmentin 1g', breakdown(), [], 'VERY_HIGH', 36);
    expect(text).toContain('No conflicts detected');
  });

  it('never hides a conflict — every conflict message appears in the text', () => {
    const conflicts: DetectedConflict[] = [
      {
        code: 'STRENGTH_CONFLICT',
        severity: 'WARNING',
        message: 'Extracted strength "250 mg/5 ml" conflicts with candidate strength "250 mg"',
        penaltyApplied: 30,
      },
      {
        code: 'DISCONTINUED_DRUG',
        severity: 'BLOCKING',
        message: 'Candidate drug "X" is marked discontinued in the DIC',
        penaltyApplied: 25,
      },
    ];
    const text = builder.build('X', breakdown({ totalScore: 20 }), conflicts, 'LOW', 5);
    expect(text).toContain('250 mg/5 ml');
    expect(text).toContain('discontinued');
    expect(text).not.toContain('No conflicts detected');
  });

  it('mentions every scored evidence dimension included in the breakdown', () => {
    const text = builder.build('Augmentin 1g', breakdown(), [], 'VERY_HIGH', 36);
    expect(text).toContain('NAME:');
    expect(text).toContain('STRENGTH:');
  });
});
