import type { DosageFormMatchClass } from '../dosage-form-parser';
import type { ParsedStrength, StrengthMatchClass } from '../strength-parser';

/**
 * CR-001 Phase 5 — shared shapes between DrugCandidateGenerator (DB-
 * touching, produces these), and DrugCandidateScorer/MatchConflictDetector/
 * MatchExplanationBuilder (pure, consume these). Keeping the shapes in
 * one file lets each component stay independently testable while still
 * agreeing on the same candidate representation (design summary §6/§7).
 */

/** One of the 6 concrete generation strategies this Phase implements.
 *  Two further design-summary "levels" are folded elsewhere rather than
 *  being separate generation queries: Levenshtein re-ranking is applied
 *  as extra evidence on top of a FUZZY_TRIGRAM hit (never a table-wide
 *  scan), and manufacturer/package context expansion happens in the
 *  scorer's contextScore, not as a new candidate source. */
export type CandidateMatchSource =
  | 'IDENTIFIER'
  | 'EXACT_NAME'
  | 'EXACT_ALIAS'
  | 'EXACT_SCIENTIFIC'
  | 'TRANSLITERATION'
  | 'FUZZY_TRIGRAM';

export interface CandidateStructuredStrength {
  numeratorValue: number | null;
  numeratorUnitCode: string | null;
  denominatorValue: number | null;
  denominatorUnitCode: string | null;
  sequence: number;
}

/** The DIC fields a candidate's evidence is compared against — a flat,
 *  DB-shape-independent projection so the scorer/conflict-detector never
 *  need a live Prisma client (design summary: independently testable). */
export interface CandidateDrugDto {
  drugId: string;
  materialNo: string;
  nameEn: string;
  nameAr: string | null;
  active: boolean;
  discontinued: boolean;
  dataQualityStatus: string;
  dosageFormCode: string | null;
  manufacturerNameEn: string | null;
  strengthText: string | null;
  structuredStrengths: CandidateStructuredStrength[];
  ingredientNamesEn: string[];
}

export interface RawCandidate {
  drug: CandidateDrugDto;
  matchSource: CandidateMatchSource;
  /** 0-1; 1.0 for every exact-match strategy, pg_trgm similarity() for
   *  FUZZY_TRIGRAM. Never fabricated for a strategy that didn't measure
   *  it. */
  rawSimilarity: number;
  /** The specific DIC field value this candidate matched against (a
   *  name, an alias, a scientific name, ...) — kept for the explanation
   *  builder so a pharmacist sees exactly what text produced the hit. */
  matchedText: string;
  /** Set only when matchSource is EXACT_ALIAS — an unapproved alias is
   *  weaker evidence and is penalized (design summary §6 "never treat
   *  an unapproved alias as authoritative"). */
  matchedAliasApproved: boolean | null;
}

/** Extracted-side evidence for one candidate evaluation, already parsed
 *  once by the caller (StrengthParser/DosageFormParser) and shared
 *  between the scorer and the conflict detector so neither re-parses. */
export interface MatchEvidenceContext {
  drugNameText: string | null;
  scientificNameText: string | null;
  parsedStrength: ParsedStrength;
  dosageFormCode: string | null;
  candidate: RawCandidate;
  candidateParsedStrength: ParsedStrength;
  strengthMatchClass: StrengthMatchClass;
  dosageFormMatchClass: DosageFormMatchClass;
  /** Average OCR block-recognition confidence (0-1) for the source line. */
  ocrConfidence: number | null;
  /** The phrase extractor's own confidence in the line/phrase split (0-1). */
  extractionConfidence: number | null;
  /** Concatenated nearby-line text, if the caller chooses to supply it —
   *  optional v1 signal for contextScore's manufacturer-mention bonus.
   *  Never fabricated when absent (design summary §6 level 8). */
  contextText?: string | null;
}

export type MatchEvidenceType =
  'NAME' | 'INGREDIENT' | 'STRENGTH' | 'DOSAGE_FORM' | 'CONTEXT' | 'DATA_QUALITY';

export interface DrugMatchEvidence {
  type: MatchEvidenceType;
  sourceText: string | null;
  matchedDICValue: string | null;
  /** 0-100, before the dimension's weight is applied. */
  rawScore: number;
  /** rawScore * this dimension's configured weight. */
  weightedScore: number;
  explanation: string;
}

export interface CandidateScoreBreakdown {
  nameScore: number;
  ingredientScore: number;
  strengthScore: number;
  dosageFormScore: number;
  contextScore: number;
  dataQualityScore: number;
  ocrReliabilityAdjustment: number;
  weightedSubtotal: number;
  /** weightedSubtotal - conflictPenalty + ocrReliabilityAdjustment,
   *  clamped to [0, 100]. */
  totalScore: number;
  evidence: DrugMatchEvidence[];
}

/** Per-candidate conflict codes (design summary §15). AMBIGUOUS_MARGIN
 *  and MULTIPLE_STRONG_CANDIDATES are cross-candidate signals — they
 *  compare a line's whole candidate set, not one candidate in
 *  isolation, so MatchConflictDetector (which only ever sees one
 *  candidate at a time) never emits them; the Step 4 orchestrator
 *  attaches them to the top candidate after ranking the full set. */
export type ConflictCode =
  | 'STRENGTH_CONFLICT'
  | 'DOSAGE_FORM_CONFLICT'
  | 'DISCONTINUED_DRUG'
  | 'INACTIVE_DRUG'
  | 'UNAPPROVED_ALIAS_RELIED_ON'
  | 'LOW_OCR_CONFIDENCE'
  | 'NAME_ONLY_WEAK_EVIDENCE'
  | 'DATA_QUALITY_LOW'
  | 'AMBIGUOUS_MARGIN'
  | 'MULTIPLE_STRONG_CANDIDATES';

export type ConflictSeverity = 'INFO' | 'WARNING' | 'BLOCKING';

export interface DetectedConflict {
  code: ConflictCode;
  severity: ConflictSeverity;
  message: string;
  /** Score points this conflict subtracts from the weighted subtotal —
   *  0 for a purely informational conflict (e.g. LOW_OCR_CONFIDENCE,
   *  which caps the confidence band instead of touching the score). */
  penaltyApplied: number;
}
