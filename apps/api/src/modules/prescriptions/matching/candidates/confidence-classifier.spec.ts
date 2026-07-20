import type { MatchThresholds } from '../match-config.service';
import { ConfidenceClassifier } from './confidence-classifier';

const THRESHOLDS: MatchThresholds = {
  minimumTopScore: 30,
  minimumCandidateMargin: 12,
  veryHighMarginThreshold: 20,
  veryHighMinScore: 85,
  highMinScore: 70,
  mediumMinScore: 50,
  minimumOcrConfidence: 0.5,
};

describe('ConfidenceClassifier', () => {
  const classifier = new ConfidenceClassifier();

  it('classifies a high score with a wide margin as VERY_HIGH (91 vs 55 — confident)', () => {
    expect(classifier.classify(91, 36, 0.9, THRESHOLDS)).toBe('VERY_HIGH');
  });

  it('classifies a high score with a razor-thin margin as MEDIUM, not VERY_HIGH (91 vs 90 — ambiguous)', () => {
    expect(classifier.classify(91, 1, 0.9, THRESHOLDS)).toBe('MEDIUM');
  });

  it('classifies a solid score with an adequate margin as HIGH', () => {
    expect(classifier.classify(75, 15, 0.9, THRESHOLDS)).toBe('HIGH');
  });

  it('classifies a mid score as MEDIUM', () => {
    expect(classifier.classify(55, 5, 0.9, THRESHOLDS)).toBe('MEDIUM');
  });

  it('classifies a low-but-present score as LOW', () => {
    expect(classifier.classify(35, 2, 0.9, THRESHOLDS)).toBe('LOW');
  });

  it('classifies below the minimum top score as UNRESOLVED', () => {
    expect(classifier.classify(20, 0, 0.9, THRESHOLDS)).toBe('UNRESOLVED');
  });

  it('classifies a null top score (no candidates) as UNRESOLVED', () => {
    expect(classifier.classify(null, null, null, THRESHOLDS)).toBe('UNRESOLVED');
  });

  it('caps at MEDIUM when OCR confidence is below the reliable threshold, regardless of score/margin', () => {
    expect(classifier.classify(95, 40, 0.2, THRESHOLDS)).toBe('MEDIUM');
  });

  it('treats a null margin (single candidate, no runner-up) as zero margin', () => {
    expect(classifier.classify(91, null, 0.9, THRESHOLDS)).toBe('MEDIUM');
  });

  it('never returns a band that implies automatic clinical approval — the type itself has no APPROVED value', () => {
    const bands = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNRESOLVED'];
    const result = classifier.classify(91, 36, 0.9, THRESHOLDS);
    expect(bands).toContain(result);
  });
});
