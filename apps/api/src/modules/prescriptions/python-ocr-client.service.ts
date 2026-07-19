import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

const REQUEST_TIMEOUT_MS = 30_000;

export interface OcrBlockDto {
  rawText: string;
  normalizedText: string;
  boundingBox: Record<string, number>;
  language: string;
  confidence: number;
  lineNumber: number;
}

export interface AnalyzeQualityResult {
  qualityScore: number;
  issues: string[];
}

export interface PreprocessingConfigDto {
  enabled: Record<string, boolean>;
  minImageWidth: number;
  minImageHeight: number;
  minQualityScore: number;
  maxRotationDegrees: number;
  minContrast: number;
  maxNoise: number;
  version: string;
}

export interface ImageVersionDto {
  imageBase64: string;
  width: number;
  height: number;
  format: string;
}

export interface PreprocessingMetrics {
  resolutionOk: boolean;
  width: number;
  height: number;
  rotationAngle: number;
  blurScore: number;
  blurVariance: number;
  brightnessScore: number;
  brightnessMean: number;
  contrastScore: number;
  contrastStdDev: number;
  noiseScore: number;
  noiseLevel: number;
  cropConfidence: number;
  readableArea: number;
}

export type PreprocessingQualityStatus =
  'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'REUPLOAD_REQUIRED';

export interface PagePreprocessResult {
  qualityScore: number;
  qualityStatus: PreprocessingQualityStatus;
  metrics: PreprocessingMetrics;
  versions: Record<string, ImageVersionDto>;
  stagesApplied: string[];
  processorTimingsMs: Record<string, number>;
  processorFailures: string[];
}

export interface PreprocessResult extends PagePreprocessResult {
  processingDurationMs: number;
  pageCount: number;
  /** Populated only for multi-page PDFs (pageCount > 1) — Sprint OCR-01's
   *  data model is one PrescriptionPage per uploaded file, so only page 1
   *  (the top-level fields above) is persisted; later pages are reported
   *  here for visibility but not stored (design decision, CR-001 Sprint
   *  OCR-02 acceptance record). */
  pages: PagePreprocessResult[] | null;
}

export interface DetectAndRecognizeResult {
  blocks: OcrBlockDto[];
  detectedLanguage: string;
  providerUsed: string;
  processingTimeMs: number;
}

export interface CandidateLineDto {
  blockIndex: number;
  extractedDrugText: string;
  extractedStrength?: string;
  extractedDosageForm?: string;
}

export interface DetectCandidatesResult {
  candidateLines: CandidateLineDto[];
}

/**
 * NestJS-side client for the internal contract in
 * docs/change-requests/CR-001-prescription-intelligence-engine.md §5.1.
 * A plain HTTP client, not routed through the §21 Integration Engine —
 * this is a first-party, low-latency service (design spec §1), and the
 * BullMQ worker's own retry/backoff already covers resilience.
 */
@Injectable()
export class PythonOcrClientService {
  constructor(private readonly settings: SettingsService) {}

  private async endpoint(): Promise<string> {
    const url = String(
      await this.settings.resolve('prescriptions.ocr_service.endpoint').catch(() => ''),
    );
    if (!url) throw new Error('Prescription OCR service endpoint is not configured');
    return url;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const base = await this.endpoint();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`OCR service ${path} returned HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  analyzeQuality(imageUrl: string): Promise<AnalyzeQualityResult> {
    return this.post('/v1/analyze-quality', { imageUrl });
  }

  preprocess(imageUrl: string, config: PreprocessingConfigDto): Promise<PreprocessResult> {
    return this.post('/v1/preprocess', { imageUrl, config });
  }

  detectAndRecognize(imageUrl: string): Promise<DetectAndRecognizeResult> {
    return this.post('/v1/detect-and-recognize', { imageUrl });
  }

  detectCandidates(blocks: OcrBlockDto[]): Promise<DetectCandidatesResult> {
    return this.post('/v1/detect-candidates', { blocks });
  }
}
