/** CR-001 Prescription Intelligence Engine API shapes — Sprint OCR-01/02.
 * Distinct from ocr-types.ts (the Phase 10 /ocr/* module, kept running
 * unchanged until the OCR-12 migration). */

export type PrescriptionPageStatus =
  | 'QUEUED'
  | 'ANALYZING_QUALITY'
  | 'PREPROCESSING'
  | 'READY_FOR_OCR'
  | 'EXTRACTING_TEXT'
  | 'DETECTING_CANDIDATES'
  | 'COMPLETED'
  | 'IMAGE_REUPLOAD_REQUIRED'
  | 'FAILED';

export type PreprocessingQualityStatus =
  'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'REUPLOAD_REQUIRED';

/** CR-001 Sprint OCR-02 Extension — Universal Image Intake. Best-effort
 * classification, always overridable by a human via manual crop. */
export type PrescriptionSourceType =
  'CAMERA' | 'SCANNER' | 'SCREENSHOT' | 'WHATSAPP_SCREENSHOT' | 'PDF' | 'UNKNOWN';

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One candidate document region a screenshot/photo might contain — see
 * PrescriptionRegion in schema.prisma. Never silently discarded, even
 * when its confidence is too low to auto-accept. */
export interface PrescriptionRegionEntry {
  id: string;
  regionIndex: number;
  boundingBoxJson: CropBox;
  confidence: number;
  regionType: string | null;
  selected: boolean;
  processingStatus: string;
}

export interface PrescriptionPageDetail {
  id: string;
  pageNumber: number;
  processingStatus: PrescriptionPageStatus;
  processingError: string | null;
  imageQualityScore: number | null;
  finalQualityScore: number | null;
  qualityStatus: PreprocessingQualityStatus | null;
  blurScore: number | null;
  brightnessScore: number | null;
  contrastScore: number | null;
  noiseScore: number | null;
  rotationAngle: number | null;
  cropConfidence: number | null;
  orientation: number | null;
  sourceType: PrescriptionSourceType;
  screenshotDetected: boolean | null;
  screenshotApplicationHint: string | null;
  manualCropRequired: boolean;
  manualCropJson: CropBox | null;
  clipboardPasted: boolean;
  originalWidth: number | null;
  originalHeight: number | null;
  selectedRegionIndex: number | null;
  regions: PrescriptionRegionEntry[];
  /** CR-001 Sprint OCR-03 — page-level OCR rollup, present once the
   *  extraction stage has run at least once. */
  requiresOcrReview: boolean;
  ocrPageConfidence: number | null;
  currentOcrRunId: string | null;
}

// ── CR-001 Sprint OCR-03 — Real Text Detection & Recognition ──────────

export interface OcrCorrectionEntry {
  id: string;
  originalOCRText: string;
  correctedText: string | null;
  markedAs: 'correct' | 'unreadable' | 'irrelevant_ui' | null;
  correctedById: string;
  correctionReason: string | null;
  createdAt: string;
}

export interface OcrRecognitionCandidate {
  text: string;
  language: string;
  confidence: number;
}

export interface OcrTextBlockEntry {
  id: string;
  rawText: string;
  normalizedText: string | null;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  language: string | null;
  ocrConfidence: number | null;
  lineNumber: number;
  isMedicineLine: boolean;
  blockIndex: number;
  detectedScript: string | null;
  textDirection: string | null;
  /** [x, y] pixel pairs in the OCR-ready image's coordinate space —
   *  null for providers/fixtures that never produced a polygon. */
  boundingPolygonJson: [number, number][] | null;
  recognitionCandidatesJson: OcrRecognitionCandidate[] | null;
  providerName: string | null;
  modelName: string | null;
  corrections: OcrCorrectionEntry[];
}

export interface PrescriptionOcrRunEntry {
  id: string;
  runNumber: number;
  providerName: string;
  providerVersion: string | null;
  trigger: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  blockCount: number | null;
  pageConfidence: number | null;
  failureCode: string | null;
  failureReason: string | null;
}

export interface PrescriptionPageTextResponse {
  pageId: string;
  run: PrescriptionOcrRunEntry | null;
  blocks: OcrTextBlockEntry[];
  rawPageText: string | null;
  normalizedPageText: string | null;
  ocrPageConfidence: number | null;
  requiresOcrReview: boolean;
}

export interface RerunOcrResponse {
  run: PrescriptionOcrRunEntry;
  blockCount: number;
  pageConfidence: number;
  requiresOcrReview: boolean;
}

export interface PrescriptionSummary {
  id: string;
  number: string;
  status: string;
  note: string | null;
  createdAt: string;
  pages: PrescriptionPageDetail[];
}

export interface PrescriptionListItem {
  id: string;
  number: string;
  status: string;
  note: string | null;
  source: string | null;
  createdAt: string;
  _count: { pages: number; drugCandidates: number };
}

export interface UploadPageResponse {
  id: string;
  pageNumber: number;
  possibleDuplicateOfPrescriptionId: string | null;
  sourceType: PrescriptionSourceType;
  screenshotDetected: boolean;
  screenshotApplicationHint: string | null;
  manualCropRequired: boolean;
  regionCount: number;
}

export interface ConfirmCropResponse {
  pageId: string;
  manualCropRequired: false;
  cropBox: CropBox;
  spawnedPageIds: string[];
  prescriptionStatus: string;
}

export interface PageOriginalResponse {
  pageId: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface PrescriptionUploadConfig {
  maxSizeMb: number;
  allowedMime: string[];
}

export interface ImageVersionEntry {
  versionType: 'ORIGINAL' | 'ROTATED' | 'CROPPED' | 'ENHANCED' | 'OCR_READY';
  url: string;
  width: number | null;
  height: number | null;
}

export interface PrescriptionImagesResponse {
  prescriptionId: string;
  pages: {
    pageId: string;
    pageNumber: number;
    versions: ImageVersionEntry[];
  }[];
}

export interface PrescriptionQualityPage {
  pageId: string;
  pageNumber: number;
  imageQualityScore: number | null;
  finalQualityScore: number | null;
  qualityStatus: PreprocessingQualityStatus | null;
  blurScore: number | null;
  brightnessScore: number | null;
  contrastScore: number | null;
  noiseScore: number | null;
  rotationAngle: number | null;
  cropConfidence: number | null;
  processingStatus: PrescriptionPageStatus;
}

export interface PrescriptionQualityResponse {
  prescriptionId: string;
  pages: PrescriptionQualityPage[];
}

export interface PrescriptionPreprocessingPage {
  pageId: string;
  pageNumber: number;
  preprocessingVersion: string | null;
  preprocessingDuration: number | null;
  preprocessingStartedAt: string | null;
  preprocessingCompletedAt: string | null;
  processingStatus: PrescriptionPageStatus;
  processingError: string | null;
  processorFailures: string[];
}

export interface PrescriptionPreprocessingResponse {
  prescriptionId: string;
  pages: PrescriptionPreprocessingPage[];
}

// ── CR-001 Phase 5 — Intelligent OCR-to-Drug Matching Engine ──────────
// Distinct from the Sprint OCR-01 mock candidate shape above
// (PrescriptionDrugCandidate.extractedDrugText etc. still exists on old
// rows) — every field below is populated by the real matching engine.

export type MatchConfidenceLevel = 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRESOLVED';

export type MedicationLineMatchingStatus =
  | 'CANDIDATES_FOUND'
  | 'HIGH_CONFIDENCE'
  | 'AMBIGUOUS'
  | 'LOW_CONFIDENCE'
  | 'UNRESOLVED'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'MANUALLY_SELECTED'
  | 'NOT_A_MEDICATION';

export type DrugMatchRunStatus =
  | 'MATCHING_QUEUED'
  | 'MATCHING_PROCESSING'
  | 'MATCHING_COMPLETED'
  | 'MATCHING_REVIEW_REQUIRED'
  | 'MATCHING_PARTIALLY_RESOLVED'
  | 'MATCHING_RESOLVED'
  | 'MATCHING_FAILED';

export type MatchDecisionType =
  | 'CANDIDATE_CONFIRMED'
  | 'CANDIDATE_REJECTED'
  | 'MANUAL_DRUG_SELECTED'
  | 'NO_DRUG_FOUND'
  | 'NON_MEDICATION_LINE'
  | 'REQUIRES_CLARIFICATION';

/** The exact subset DrugMatchReviewService's DRUG_SUMMARY_SELECT
 *  returns for matchedDrug/selectedDrug — leaner than dic-types.ts's
 *  full DrugSummary, so kept separate rather than reused. */
export interface MatchedDrugSummary {
  id: string;
  materialNo: string;
  nameEn: string;
  nameAr: string | null;
  priceWithTax: string | null;
}

export interface DrugMatchEvidenceEntry {
  type: 'NAME' | 'INGREDIENT' | 'STRENGTH' | 'DOSAGE_FORM' | 'CONTEXT' | 'DATA_QUALITY';
  sourceText: string | null;
  matchedDICValue: string | null;
  rawScore: number;
  weightedScore: number;
  explanation: string;
}

export interface DrugMatchConflictEntry {
  code: string;
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  message: string;
  penaltyApplied: number;
}

export interface PrescriptionDrugCandidateEntry {
  id: string;
  rank: number | null;
  matchedDrugId: string | null;
  matchedDrug: MatchedDrugSummary | null;
  matchConfidence: number | null;
  confidenceLevel: MatchConfidenceLevel | null;
  candidateMargin: number | null;
  nameScore: number | null;
  ingredientScore: number | null;
  strengthScore: number | null;
  dosageFormScore: number | null;
  contextScore: number | null;
  dataQualityScore: number | null;
  ocrReliabilityAdjustment: number | null;
  conflictPenalty: number | null;
  evidenceJson: DrugMatchEvidenceEntry[] | null;
  conflictsJson: DrugMatchConflictEntry[] | null;
  explanationText: string | null;
  selected: boolean;
  rejected: boolean;
}

export interface DrugMatchDecisionEntry {
  id: string;
  decisionType: MatchDecisionType;
  decidedById: string;
  decidedAt: string;
  notes: string | null;
  previousDrugId: string | null;
}

export interface PrescriptionMedicationLineEntry {
  id: string;
  lineIndex: number;
  rawText: string;
  normalizedText: string | null;
  probableLineType: string;
  detectedLanguage: string | null;
  ocrConfidence: number | null;
  extractionConfidence: number | null;
  matchingStatus: MedicationLineMatchingStatus;
  selectedDrugId: string | null;
  selectedDrug: MatchedDrugSummary | null;
  selectedCandidateId: string | null;
  reviewRequired: boolean;
  candidates: PrescriptionDrugCandidateEntry[];
  decisions: DrugMatchDecisionEntry[];
}

export interface DrugMatchRunEntry {
  id: string;
  prescriptionId: string;
  matchingEngineVersion: string;
  status: DrugMatchRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  lineCount: number;
  matchedLineCount: number;
  unresolvedLineCount: number;
  failureCode: string | null;
  failureReason: string | null;
  createdAt: string;
}

export interface DrugMatchesResponse {
  run: DrugMatchRunEntry;
  lines: PrescriptionMedicationLineEntry[];
}
