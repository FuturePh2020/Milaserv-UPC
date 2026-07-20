import type { MatchConfidenceLevel } from '@prisma/client';
import type { MatchThresholds } from '../match-config.service';

/**
 * CR-001 Phase 5 — confidence banding (design summary §17). Pure: takes
 * the top candidate's score, its margin over the runner-up, and the
 * line's OCR confidence, and returns a band. Absolute score alone is
 * never sufficient — a 91 with a 1-point margin over the runner-up is
 * AMBIGUOUS-leaning (MEDIUM here), while a 91 with a 36-point margin is
 * confident (VERY_HIGH) — the margin requirement is what tells the two
 * apart. A null margin (no runner-up at all — a lone candidate) is
 * different from a small margin: the margin requirement exists to catch
 * ambiguity between competing candidates, so with nothing to be
 * ambiguous against, it simply doesn't apply — an uncontested strong
 * match is judged on its score alone, not penalized as if it were tied
 * with an invisible zero-score rival. No band here ever implies clinical
 * approval; that always requires a separate pharmacist decision (design
 * summary §2/§16).
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
    const marginAtLeast = (required: number) => margin === null || margin >= required;

    if (
      !ocrCapped &&
      topScore >= thresholds.veryHighMinScore &&
      marginAtLeast(thresholds.veryHighMarginThreshold)
    ) {
      return 'VERY_HIGH';
    }
    if (
      !ocrCapped &&
      topScore >= thresholds.highMinScore &&
      marginAtLeast(thresholds.minimumCandidateMargin)
    ) {
      return 'HIGH';
    }
    if (topScore >= thresholds.mediumMinScore) {
      return 'MEDIUM';
    }
    return 'LOW';
  }
}
