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
}

export interface PrescriptionSummary {
  id: string;
  number: string;
  status: string;
  pages: PrescriptionPageDetail[];
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
