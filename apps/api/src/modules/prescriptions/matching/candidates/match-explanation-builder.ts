import type { MatchConfidenceLevel } from '@prisma/client';
import type { CandidateScoreBreakdown, DetectedConflict } from './types';

const SEVERITY_ICON: Record<string, string> = {
  BLOCKING: '⚠️',
  WARNING: '⚠',
  INFO: 'ℹ',
};

/**
 * CR-001 Phase 5 — builds the human-readable explanation stored on
 * PrescriptionDrugCandidate.explanationText (design summary §23: "Do
 * not hide score explanations behind backend-only logs"). Pure text
 * formatting only — every number it prints comes from
 * DrugCandidateScorer/MatchConflictDetector, never recomputed here.
 */
export class MatchExplanationBuilder {
  build(
    candidateName: string,
    breakdown: CandidateScoreBreakdown,
    conflicts: DetectedConflict[],
    confidenceLevel: MatchConfidenceLevel,
    margin: number | null,
  ): string {
    const lines: string[] = [];
    lines.push(
      `Matched to "${candidateName}" — total score ${Math.round(breakdown.totalScore)}/100 (${confidenceLevel}).`,
    );
    if (margin !== null) {
      lines.push(`Leads the next candidate by ${Math.round(margin)} point(s).`);
    }
    for (const e of breakdown.evidence) {
      lines.push(`${e.type}: ${e.explanation} (${Math.round(e.rawScore)}/100).`);
    }
    if (conflicts.length === 0) {
      lines.push('No conflicts detected.');
    } else {
      for (const c of conflicts) {
        lines.push(`${SEVERITY_ICON[c.severity] ?? ''} ${c.message}.`.trim());
      }
    }
    return lines.join(' ');
  }
}
