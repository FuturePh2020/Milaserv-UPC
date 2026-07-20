import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

export interface OcrConfig {
  /** Empty string = let ocr-service's own OCR_PROVIDER env var decide. */
  provider: string;
  languageMode: string;
  /** 0-100, matches PrescriptionPage.ocrPageConfidence's scale. */
  reviewConfidenceThreshold: number;
  returnBoundingBoxes: boolean;
  returnAlternatives: boolean;
  maxPagesPerJob: number;
}

/**
 * CR-001 Sprint OCR-03 — resolves the OCR engine's business-level tunables
 * from Settings (ADR-008: configuration over hard-coded values). Mirrors
 * PreprocessingConfigService's split: infra-level model/device selection
 * lives in ocr-service's own env vars, never here.
 */
@Injectable()
export class OcrConfigService {
  constructor(private readonly settings: SettingsService) {}

  async resolve(): Promise<OcrConfig> {
    const [
      provider,
      languageMode,
      reviewConfidenceThreshold,
      returnBoundingBoxes,
      returnAlternatives,
      maxPagesPerJob,
    ] = await Promise.all([
      this.settings.resolve('prescriptions.ocr.provider') as Promise<string>,
      this.settings.resolve('prescriptions.ocr.language_mode') as Promise<string>,
      this.settings.resolve('prescriptions.ocr.review_confidence_threshold').then(Number),
      this.settings.resolve('prescriptions.ocr.return_bounding_boxes') as Promise<boolean>,
      this.settings.resolve('prescriptions.ocr.return_alternatives') as Promise<boolean>,
      this.settings.resolve('prescriptions.ocr.max_pages_per_job').then(Number),
    ]);
    return {
      provider,
      languageMode,
      reviewConfidenceThreshold,
      returnBoundingBoxes,
      returnAlternatives,
      maxPagesPerJob,
    };
  }
}
