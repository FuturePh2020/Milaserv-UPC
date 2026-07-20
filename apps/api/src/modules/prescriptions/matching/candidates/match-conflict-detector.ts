import type { MatchPenalties } from '../match-config.service';
import type { DetectedConflict, MatchEvidenceContext } from './types';

/**
 * CR-001 Phase 5 — detects per-candidate conflicts (design summary §15).
 * Pure and independently testable: given one candidate's already-
 * classified evidence, it never re-parses strength/dosage-form text
 * itself (that's StrengthParser/DosageFormParser's job, run once by the
 * caller and shared via MatchEvidenceContext with DrugCandidateScorer).
 *
 * AMBIGUOUS_MARGIN and MULTIPLE_STRONG_CANDIDATES are cross-candidate
 * signals this detector cannot see (it only ever receives one candidate
 * at a time) — the Step 4 orchestrator attaches those to the top
 * candidate after ranking the full set.
 */
export class MatchConflictDetector {
  detect(
    ctx: MatchEvidenceContext,
    penalties: MatchPenalties,
    minimumOcrConfidence: number,
  ): DetectedConflict[] {
    const conflicts: DetectedConflict[] = [];
    const { candidate } = ctx;

    if (ctx.strengthMatchClass === 'CONFLICT') {
      conflicts.push({
        code: 'STRENGTH_CONFLICT',
        severity: 'WARNING',
        message: `Extracted strength "${ctx.parsedStrength.rawStrengthText}" conflicts with candidate strength "${ctx.candidateParsedStrength.rawStrengthText}"`,
        penaltyApplied: penalties.strengthConflict,
      });
    }

    if (ctx.dosageFormMatchClass === 'CONFLICT') {
      conflicts.push({
        code: 'DOSAGE_FORM_CONFLICT',
        severity: 'WARNING',
        message: `Extracted dosage form "${ctx.dosageFormCode}" conflicts with candidate dosage form "${candidate.drug.dosageFormCode}"`,
        penaltyApplied: penalties.dosageFormConflict,
      });
    }

    if (candidate.drug.discontinued) {
      conflicts.push({
        code: 'DISCONTINUED_DRUG',
        severity: 'BLOCKING',
        message: `Candidate drug "${candidate.drug.nameEn}" is marked discontinued in the DIC`,
        penaltyApplied: penalties.discontinuedDrug,
      });
    }

    if (!candidate.drug.active) {
      conflicts.push({
        code: 'INACTIVE_DRUG',
        severity: 'BLOCKING',
        message: `Candidate drug "${candidate.drug.nameEn}" is marked inactive in the DIC`,
        penaltyApplied: penalties.inactiveDrug,
      });
    }

    if (candidate.matchSource === 'EXACT_ALIAS' && candidate.matchedAliasApproved === false) {
      conflicts.push({
        code: 'UNAPPROVED_ALIAS_RELIED_ON',
        severity: 'INFO',
        message: `Match relied on an unapproved alias ("${candidate.matchedText}")`,
        penaltyApplied: penalties.unapprovedAlias,
      });
    }

    if (ctx.ocrConfidence !== null && ctx.ocrConfidence < minimumOcrConfidence) {
      conflicts.push({
        code: 'LOW_OCR_CONFIDENCE',
        severity: 'INFO',
        message: `OCR recognition confidence (${ctx.ocrConfidence.toFixed(2)}) is below the reliable threshold (${minimumOcrConfidence})`,
        penaltyApplied: 0,
      });
    }

    const hasStrengthEvidence =
      ctx.strengthMatchClass !== 'MISSING_FROM_OCR' && ctx.strengthMatchClass !== 'UNPARSEABLE';
    const hasDosageFormEvidence = ctx.dosageFormMatchClass !== 'MISSING';
    const hasScientificEvidence = ctx.scientificNameText !== null;
    if (!hasStrengthEvidence && !hasDosageFormEvidence && !hasScientificEvidence) {
      conflicts.push({
        code: 'NAME_ONLY_WEAK_EVIDENCE',
        severity: 'INFO',
        message:
          'Only the drug name matched — no strength, dosage form, or ingredient evidence was available',
        penaltyApplied: 0,
      });
    }

    if (
      ['DRAFT', 'INCOMPLETE', 'REJECTED', 'ARCHIVED'].includes(candidate.drug.dataQualityStatus)
    ) {
      conflicts.push({
        code: 'DATA_QUALITY_LOW',
        severity: 'INFO',
        message: `Candidate DIC record data quality is ${candidate.drug.dataQualityStatus}`,
        penaltyApplied: 0,
      });
    }

    return conflicts;
  }
}
