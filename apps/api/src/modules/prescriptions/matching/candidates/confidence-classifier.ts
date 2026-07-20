import type { MatchConfidenceLevel } from '@prisma/client';
import type { MatchThresholds } from '../match-config.service';

/**
 * CR-001 Phase 5 — confidence banding (design summary §17). Pure: takes
 * the top candidate's score, its margin over the runner-up, and the
 * line's OCR confidence, and returns a band. Absolute score alone is
 * never sufficient — a 91 with a 1-point margin over the runner-up is
 * AMBIGUOUS-leaning (MEDIUM here), while a 91 with a 36-point margin is
 * confident (VERY_HIGH) — the margin requirement is what tells the two
 * apart. No band here ever implies clinical approval; that always
 * requires a separate pharmacist decision (design summary §2/§16).
 */
export class ConfidenceClassifier {
  classify(
    topScore: number | null,
    margin: number | null,
    ocrConfidence: number | null,
    thresholds: MatchThresholds,
  ): MatchConfidenceLevel {
    if (topScore === null || topScore < thresholds.minimumTopScore) {
      return 'UNRESOLVED';
    }

    const ocrCapped = ocrConfidence !== null && ocrConfidence < thresholds.minimumOcrConfidence;
    const effectiveMargin = margin ?? 0;

    if (
      !ocrCapped &&
      topScore >= thresholds.veryHighMinScore &&
      effectiveMargin >= thresholds.veryHighMarginThreshold
    ) {
      return 'VERY_HIGH';
    }
    if (
      !ocrCapped &&
      topScore >= thresholds.highMinScore &&
      effectiveMargin >= thresholds.minimumCandidateMargin
    ) {
      return 'HIGH';
    }
    if (topScore >= thresholds.mediumMinScore) {
      return 'MEDIUM';
    }
    return 'LOW';
  }
}
