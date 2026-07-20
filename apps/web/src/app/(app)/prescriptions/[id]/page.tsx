'use client';

import { use, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { getAccessToken } from '@/lib/tokens';
import { useAuth } from '@/lib/auth';
import type {
  ImageVersionEntry,
  PrescriptionImagesResponse,
  PrescriptionPreprocessingResponse,
  PrescriptionQualityPage,
  PrescriptionQualityResponse,
  PrescriptionRegionEntry,
  PrescriptionSourceType,
  PrescriptionSummary,
  PrescriptionUploadConfig,
  UploadPageResponse,
} from '@/lib/prescription-types';
import { Badge, Button, EmptyState, ErrorState, Select, Spinner } from '@/components/ui';
import { DropZone } from '@/components/DropZone';
import { PageCropWorkspace } from './crop-workspace';
import { OcrResultsPanel } from './ocr-results';
import { DrugMatchReviewPanel } from './drug-match-review';

/** CR-001 Sprint OCR-03 — mirrors the worker's own OCR-image fallback
 *  chain (prescription-ocr.worker.ts's OCR_IMAGE_PRIORITY) so the
 *  results overlay lines up with whichever image OCR actually ran
 *  against. */
const OCR_IMAGE_PRIORITY = ['OCR_READY', 'ENHANCED', 'CROPPED', 'ROTATED', 'ORIGINAL'] as const;
function pickOcrImageVersion(versions: ImageVersionEntry[]): ImageVersionEntry | undefined {
  for (const type of OCR_IMAGE_PRIORITY) {
    const v = versions.find((v) => v.versionType === type);
    if (v) return v;
  }
  return undefined;
}

const QUALITY_TONES: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'gray'> = {
  EXCELLENT: 'green',
  GOOD: 'blue',
  FAIR: 'amber',
  POOR: 'red',
  REUPLOAD_REQUIRED: 'red',
};

const PROCESSING_TONES: Record<string, 'gray' | 'blue' | 'amber' | 'green' | 'red'> = {
  QUEUED: 'gray',
  ANALYZING_QUALITY: 'blue',
  PREPROCESSING: 'blue',
  READY_FOR_OCR: 'blue',
  EXTRACTING_TEXT: 'blue',
  DETECTING_CANDIDATES: 'blue',
  COMPLETED: 'green',
  IMAGE_REUPLOAD_REQUIRED: 'red',
  FAILED: 'red',
};

const IN_PROGRESS = new Set([
  'QUEUED',
  'ANALYZING_QUALITY',
  'PREPROCESSING',
  'READY_FOR_OCR',
  'EXTRACTING_TEXT',
  'DETECTING_CANDIDATES',
]);

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** CR-001 Sprint OCR-02 — Image Processing & Quality Engine inspection
 * page (design spec: "an image inspection page ... side-by-side
 * comparison"). Extended in Sprint OCR-02 Extension with the
 * drag-and-drop upload section and the preview/crop workspace — this is
 * the "existing prescriptions area" the Extension's DropZone wires into,
 * not a standalone upload page. Distinct from the Phase 10 /ocr review
 * screen. */
export default function PrescriptionImagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canUpload = hasPermission('ocr.upload');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: rx, isLoading: rxLoading } = useQuery({
    queryKey: ['prescription-summary', id],
    queryFn: () => api<PrescriptionSummary>(`/prescriptions/${id}`),
    refetchInterval: (q) =>
      q.state.data?.pages.some((p) => IN_PROGRESS.has(p.processingStatus)) ? 3000 : false,
  });
  const { data: images } = useQuery({
    queryKey: ['prescription-images', id],
    queryFn: () => api<PrescriptionImagesResponse>(`/prescriptions/${id}/images`),
    refetchInterval: () =>
      rx?.pages.some((p) => IN_PROGRESS.has(p.processingStatus)) ? 3000 : false,
    enabled: !!rx,
  });
  const { data: quality } = useQuery({
    queryKey: ['prescription-quality', id],
    queryFn: () => api<PrescriptionQualityResponse>(`/prescriptions/${id}/quality`),
    enabled: !!rx,
  });
  const { data: preprocessing } = useQuery({
    queryKey: ['prescription-preprocessing', id],
    queryFn: () => api<PrescriptionPreprocessingResponse>(`/prescriptions/${id}/preprocessing`),
    enabled: !!rx,
  });
  const { data: uploadConfig } = useQuery({
    queryKey: ['prescriptions-upload-config'],
    queryFn: () => api<PrescriptionUploadConfig>('/prescriptions/config'),
    staleTime: 300_000,
    enabled: !!rx && rx.status === 'UPLOADED' && canUpload,
  });

  const submit = useMutation({
    mutationFn: () => api(`/prescriptions/${id}/submit`, { method: 'POST' }),
    onSuccess: () => {
      setSubmitError(null);
      void qc.invalidateQueries({ queryKey: ['prescription-summary', id] });
    },
    onError: (err) => setSubmitError(err instanceof ApiError ? err.message : t('common.error')),
  });

  if (rxLoading || !rx) return <Spinner />;

  const pendingCropCount = rx.pages.filter((p) => p.manualCropRequired).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" dir="ltr">
            {rx.number}
          </h1>
          <Badge tone="gray">{t(`ocr.status.${rx.status}`)}</Badge>
        </div>
      </div>

      {rx.status === 'UPLOADED' && canUpload && (
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-900">
            {t('ocr.preprocessing.addPagesTitle')}
          </h2>
          {uploadConfig && (
            <DropZone
              accept={uploadConfig.allowedMime}
              maxSizeMb={uploadConfig.maxSizeMb}
              uploadUrl={`${API_BASE}/api/v1/prescriptions/${id}/pages`}
              headers={() => {
                const token = getAccessToken();
                const headers: Record<string, string> = {};
                if (token) headers.Authorization = `Bearer ${token}`;
                return headers;
              }}
              buildExtraFields={(_file, source) => ({
                clipboardPasted: source === 'paste' ? 'true' : 'false',
              })}
              extractDuplicateLabel={(json) =>
                (json as UploadPageResponse | null)?.possibleDuplicateOfPrescriptionId
                  ? t('ocr.preprocessing.duplicateHint')
                  : undefined
              }
              onFileSettled={() => {
                void qc.invalidateQueries({ queryKey: ['prescription-summary', id] });
              }}
            />
          )}
          {submitError && <ErrorState message={submitError} />}
          <div className="flex items-center justify-between gap-3">
            {pendingCropCount > 0 ? (
              <p className="text-xs text-amber-700">
                {t('ocr.preprocessing.pendingCropWarning', { count: pendingCropCount })}
              </p>
            ) : (
              <span />
            )}
            <Button
              onClick={() => submit.mutate()}
              disabled={rx.pages.length === 0 || submit.isPending}
            >
              {t('ocr.preprocessing.submitForProcessingBtn')}
            </Button>
          </div>
        </div>
      )}

      {rx.pages.length === 0 && <EmptyState message={t('ocr.preprocessing.noPages')} />}

      {rx.pages.map((page) => {
        if (page.manualCropRequired) {
          return (
            <PageCropWorkspace
              key={page.id}
              prescriptionId={id}
              pageId={page.id}
              pageNumber={page.pageNumber}
              regions={page.regions}
              sourceType={page.sourceType}
              screenshotDetected={page.screenshotDetected}
              screenshotApplicationHint={page.screenshotApplicationHint}
            />
          );
        }
        const q: PrescriptionQualityPage | undefined = quality?.pages.find(
          (p) => p.pageId === page.id,
        );
        const pre = preprocessing?.pages.find((p) => p.pageId === page.id);
        const imgs = images?.pages.find((p) => p.pageId === page.id);
        return (
          <PageInspector
            key={page.id}
            prescriptionId={id}
            pageId={page.id}
            pageNumber={page.pageNumber}
            processingStatus={page.processingStatus}
            processingError={page.processingError}
            quality={q}
            preprocessingVersion={pre?.preprocessingVersion ?? null}
            preprocessingDuration={pre?.preprocessingDuration ?? null}
            processorFailures={pre?.processorFailures ?? []}
            versions={imgs?.versions ?? []}
            sourceType={page.sourceType}
            screenshotDetected={page.screenshotDetected}
            screenshotApplicationHint={page.screenshotApplicationHint}
            regions={page.regions}
            selectedRegionIndex={page.selectedRegionIndex}
            requiresOcrReview={page.requiresOcrReview}
            ocrPageConfidence={page.ocrPageConfidence}
            hasOcrRun={!!page.currentOcrRunId}
          />
        );
      })}

      {rx.status !== 'UPLOADED' && rx.pages.length > 0 && (
        <>
          <DrugMatchReviewPanel prescriptionId={id} />
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
            <a href="/fulfillment" className="text-[#0b2545] underline-offset-2 hover:underline">
              {t('fulfillment.title')} →
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  const pct = Math.round(value * 100);
  const tone = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-gray-500">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 shrink-0 text-end text-gray-600" dir="ltr">
        {pct}%
      </span>
    </div>
  );
}

function PageInspector({
  prescriptionId,
  pageId,
  pageNumber,
  processingStatus,
  processingError,
  quality,
  preprocessingVersion,
  preprocessingDuration,
  processorFailures,
  versions,
  sourceType,
  screenshotDetected,
  screenshotApplicationHint,
  regions,
  selectedRegionIndex,
  requiresOcrReview,
  ocrPageConfidence,
  hasOcrRun,
}: {
  prescriptionId: string;
  pageId: string;
  pageNumber: number;
  processingStatus: string;
  processingError: string | null;
  quality: PrescriptionQualityPage | undefined;
  preprocessingVersion: string | null;
  preprocessingDuration: number | null;
  processorFailures: string[];
  versions: ImageVersionEntry[];
  sourceType: PrescriptionSourceType;
  screenshotDetected: boolean | null;
  screenshotApplicationHint: string | null;
  regions: PrescriptionRegionEntry[];
  selectedRegionIndex: number | null;
  requiresOcrReview: boolean;
  ocrPageConfidence: number | null;
  hasOcrRun: boolean;
}) {
  const t = useTranslations();
  const original = versions.find((v) => v.versionType === 'ORIGINAL');
  const processedOptions = versions.filter((v) => v.versionType !== 'ORIGINAL');
  const [processedType, setProcessedType] = useState<string>('');
  const processed =
    processedOptions.find((v) => v.versionType === processedType) ??
    processedOptions[processedOptions.length - 1];
  const selectedRegion = regions.find((r) => r.regionIndex === selectedRegionIndex);

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">
          {t('ocr.preprocessing.page')} #{pageNumber}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="gray">{t(`ocr.preprocessing.sourceType.${sourceType}`)}</Badge>
          {screenshotDetected && (
            <Badge tone="blue">
              {t('ocr.preprocessing.screenshotDetected')}
              {screenshotApplicationHint ? ` — ${screenshotApplicationHint}` : ''}
            </Badge>
          )}
          <Badge tone={PROCESSING_TONES[processingStatus] ?? 'gray'}>
            {t(`ocr.preprocessing.status.${processingStatus}`)}
          </Badge>
          {quality?.qualityStatus && (
            <Badge tone={QUALITY_TONES[quality.qualityStatus] ?? 'gray'}>
              {t(`ocr.preprocessing.quality.${quality.qualityStatus}`)}
              {quality.finalQualityScore !== null && ` — ${quality.finalQualityScore}/100`}
            </Badge>
          )}
          {requiresOcrReview && <Badge tone="amber">{t('ocr.results.requiresReview')}</Badge>}
        </div>
      </div>

      {selectedRegion && regions.length > 1 && (
        <p className="text-xs text-gray-500">
          {t('ocr.preprocessing.autoCroppedHint', {
            index: selectedRegion.regionIndex + 1,
            total: regions.length,
            confidence: Math.round(selectedRegion.confidence * 100),
          })}
        </p>
      )}

      {processingError && <ErrorState message={processingError} />}
      {processorFailures.length > 0 && (
        <p className="text-xs text-amber-700">
          {t('ocr.preprocessing.processorFailures')}: {processorFailures.join('; ')}
        </p>
      )}

      {quality && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-md bg-gray-50 p-3 sm:grid-cols-2">
          <ScoreBar label={t('ocr.preprocessing.blur')} value={quality.blurScore} />
          <ScoreBar label={t('ocr.preprocessing.brightness')} value={quality.brightnessScore} />
          <ScoreBar label={t('ocr.preprocessing.contrast')} value={quality.contrastScore} />
          <ScoreBar label={t('ocr.preprocessing.noise')} value={quality.noiseScore} />
          <div className="flex items-center gap-2 text-xs text-gray-600 sm:col-span-2">
            <span>
              {t('ocr.preprocessing.rotation')}:{' '}
              <span dir="ltr">{quality.rotationAngle ?? 0}°</span>
            </span>
            <span>
              {t('ocr.preprocessing.cropConfidence')}:{' '}
              <span dir="ltr">
                {quality.cropConfidence !== null ? Math.round(quality.cropConfidence * 100) : 0}%
              </span>
            </span>
            {preprocessingVersion && (
              <span dir="ltr">
                v{preprocessingVersion}
                {preprocessingDuration !== null ? ` · ${preprocessingDuration}ms` : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {versions.length === 0 ? (
        <EmptyState message={t('ocr.preprocessing.noImagesYet')} />
      ) : (
        <div>
          {processedOptions.length > 0 && (
            <Select
              value={processed?.versionType ?? ''}
              onChange={(e) => setProcessedType(e.target.value)}
              className="mb-2 w-56"
              label={t('ocr.preprocessing.processedVersion')}
            >
              {processedOptions.map((v) => (
                <option key={v.versionType} value={v.versionType}>
                  {t(`ocr.preprocessing.versionType.${v.versionType}`)}
                </option>
              ))}
            </Select>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ImagePane label={t('ocr.preprocessing.original')} version={original} />
            <ImagePane label={t('ocr.preprocessing.processed')} version={processed} />
          </div>
        </div>
      )}

      <OcrResultsPanel
        prescriptionId={prescriptionId}
        pageId={pageId}
        requiresOcrReview={requiresOcrReview}
        ocrPageConfidence={ocrPageConfidence}
        hasRun={hasOcrRun}
        ocrImageVersion={pickOcrImageVersion(versions)}
      />
    </div>
  );
}

function ImagePane({ label, version }: { label: string; version: ImageVersionEntry | undefined }) {
  const t = useTranslations();
  return (
    <div className="rounded-md border border-gray-200 p-2">
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-gray-500">
        <span>{label}</span>
        {version && version.width && version.height && (
          <span dir="ltr">
            {version.width}×{version.height}
          </span>
        )}
      </div>
      {version ? (
        // A signed, short-TTL storage URL — not a static asset next/image can optimize.
        <img
          src={version.url}
          alt={label}
          className="max-h-96 w-full rounded bg-gray-50 object-contain"
        />
      ) : (
        <div className="flex h-48 items-center justify-center text-xs text-gray-400">
          {t('ocr.preprocessing.notAvailable')}
        </div>
      )}
    </div>
  );
}
