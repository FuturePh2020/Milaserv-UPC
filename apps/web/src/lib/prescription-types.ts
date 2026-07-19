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
