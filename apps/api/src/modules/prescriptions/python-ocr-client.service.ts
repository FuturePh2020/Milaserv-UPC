import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../core/config/config.module';
import type { Env } from '../../core/config/env';
import { SettingsService } from '../settings/settings.service';

const REQUEST_TIMEOUT_MS = 30_000;

export interface RecognitionCandidateDto {
  text: string;
  language: string;
  confidence: number;
}

export interface OcrBlockDto {
  rawText: string;
  normalizedText: string;
  boundingBox: Record<string, number>;
  language: string;
  confidence: number;
  lineNumber: number;
  /// Sprint OCR-03 additions — all optional so MockOCRProvider responses
  /// (which predate these fields) keep validating without change. Mirrors
  /// app/schemas.py's OCRBlock (boundingPolygon is a list of [x, y] pairs,
  /// matching Python's list[list[float]]).
  blockIndex?: number;
  boundingPolygon?: Array<[number, number]>;
  script?: string;
  direction?: string;
  recognitionCandidates?: RecognitionCandidateDto[];
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

/** Shape of GET /v1/providers/{name}/status — matches
 *  app/providers/*.get_provider_info(); ocr-service returns this as a
 *  raw dict (no Pydantic model), so every field beyond the ones this
 *  codebase reads is treated as opaque/passthrough. */
export interface ProviderStatusResult {
  name: string;
  ready: boolean;
  models?: Record<string, string>;
  device?: string;
  capabilities?: Record<string, unknown>;
}

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── CR-001 Sprint OCR-02 Extension — Universal Image Intake ───────────

export interface RegionDetectionConfigDto {
  enabled: boolean;
  minConfidence: number;
  minRegionAreaRatio: number;
  maxCandidates: number;
  screenshotAspectRatioMin: number;
  screenshotAspectRatioMax: number;
  whatsappHintEnabled: boolean;
}

export type PrescriptionSourceType =
  'CAMERA' | 'SCANNER' | 'SCREENSHOT' | 'WHATSAPP_SCREENSHOT' | 'PDF' | 'UNKNOWN';

export interface RegionCandidateDto extends CropBox {
  regionIndex: number;
  confidence: number;
  regionType: string;
}

export interface DetectRegionResult {
  sourceTypeHint: PrescriptionSourceType;
  screenshotDetected: boolean;
  screenshotConfidence: number;
  screenshotApplicationHint: string | null;
  originalWidth: number;
  originalHeight: number;
  regions: RegionCandidateDto[];
  bestRegionIndex: number | null;
  manualCropRequired: boolean;
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
  constructor(
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

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
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.env.OCR_INTERNAL_TOKEN) {
        headers['X-Internal-Token'] = this.env.OCR_INTERNAL_TOKEN;
      }
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`OCR service ${path} returned HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async get<T>(path: string): Promise<T> {
    const base = await this.endpoint();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {};
      if (this.env.OCR_INTERNAL_TOKEN) {
        headers['X-Internal-Token'] = this.env.OCR_INTERNAL_TOKEN;
      }
      const res = await fetch(`${base}${path}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`OCR service ${path} returned HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Best-effort provider/model metadata for a PrescriptionOcrRun's
   *  modelInfoJson (design brief: run history must record what actually
   *  produced it, never just "OCR ran"). Callers should tolerate this
   *  throwing/rejecting — it's for honesty in the audit trail, not
   *  required for the OCR result itself. */
  getProviderStatus(name: string): Promise<ProviderStatusResult> {
    return this.get(`/v1/providers/${encodeURIComponent(name)}/status`);
  }

  analyzeQuality(imageUrl: string): Promise<AnalyzeQualityResult> {
    return this.post('/v1/analyze-quality', { imageUrl });
  }

  preprocess(
    imageUrl: string,
    config: PreprocessingConfigDto,
    presetCropBox?: CropBox | null,
  ): Promise<PreprocessResult> {
    return this.post('/v1/preprocess', {
      imageUrl,
      config,
      presetCropBox: presetCropBox ?? undefined,
    });
  }

  /** `provider` mirrors app/schemas.py's DetectAndRecognizeRequest.provider —
   *  an explicit business-level override (Settings key
   *  `prescriptions.ocr.provider`); empty/undefined lets ocr-service's own
   *  OCR_PROVIDER env var decide. */
  detectAndRecognize(imageUrl: string, provider?: string): Promise<DetectAndRecognizeResult> {
    return this.post('/v1/detect-and-recognize', { imageUrl, provider: provider || undefined });
  }

  /** CR-001 Sprint OCR-02 Extension — finds the probable prescription
   *  region inside a screenshot/photo (design doc: "Prescription Region
   *  Detector"). Called synchronously at upload time, before the file's
   *  page record is even created. */
  detectRegion(imageUrl: string, config: RegionDetectionConfigDto): Promise<DetectRegionResult> {
    return this.post('/v1/detect-region', { imageUrl, config });
  }
}
