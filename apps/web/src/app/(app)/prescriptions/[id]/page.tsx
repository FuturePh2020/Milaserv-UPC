'use client';

import { use, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  ImageVersionEntry,
  PrescriptionImagesResponse,
  PrescriptionPreprocessingResponse,
  PrescriptionQualityPage,
  PrescriptionQualityResponse,
  PrescriptionSummary,
} from '@/lib/prescription-types';
import { Badge, EmptyState, ErrorState, Select, Spinner } from '@/components/ui';

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

/** CR-001 Sprint OCR-02 — Image Processing & Quality Engine inspection
 * page (design spec: "an image inspection page ... side-by-side
 * comparison"). Distinct from the Phase 10 /ocr review screen. */
export default function PrescriptionImagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();

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

  if (rxLoading || !rx) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" dir="ltr">
            {rx.number}
          </h1>
          <Badge tone="gray">{rx.status}</Badge>
        </div>
      </div>

      {rx.pages.length === 0 && <EmptyState message={t('ocr.preprocessing.noPages')} />}

      {rx.pages.map((page) => {
        const q: PrescriptionQualityPage | undefined = quality?.pages.find(
          (p) => p.pageId === page.id,
        );
        const pre = preprocessing?.pages.find((p) => p.pageId === page.id);
        const imgs = images?.pages.find((p) => p.pageId === page.id);
        return (
          <PageInspector
            key={page.id}
            pageNumber={page.pageNumber}
            processingStatus={page.processingStatus}
            processingError={page.processingError}
            quality={q}
            preprocessingVersion={pre?.preprocessingVersion ?? null}
            preprocessingDuration={pre?.preprocessingDuration ?? null}
            processorFailures={pre?.processorFailures ?? []}
            versions={imgs?.versions ?? []}
          />
        );
      })}
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
  pageNumber,
  processingStatus,
  processingError,
  quality,
  preprocessingVersion,
  preprocessingDuration,
  processorFailures,
  versions,
}: {
  pageNumber: number;
  processingStatus: string;
  processingError: string | null;
  quality: PrescriptionQualityPage | undefined;
  preprocessingVersion: string | null;
  preprocessingDuration: number | null;
  processorFailures: string[];
  versions: ImageVersionEntry[];
}) {
  const t = useTranslations();
  const original = versions.find((v) => v.versionType === 'ORIGINAL');
  const processedOptions = versions.filter((v) => v.versionType !== 'ORIGINAL');
  const [processedType, setProcessedType] = useState<string>('');
  const processed =
    processedOptions.find((v) => v.versionType === processedType) ??
    processedOptions[processedOptions.length - 1];

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">
          {t('ocr.preprocessing.page')} #{pageNumber}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={PROCESSING_TONES[processingStatus] ?? 'gray'}>
            {t(`ocr.preprocessing.status.${processingStatus}`)}
          </Badge>
          {quality?.qualityStatus && (
            <Badge tone={QUALITY_TONES[quality.qualityStatus] ?? 'gray'}>
              {t(`ocr.preprocessing.quality.${quality.qualityStatus}`)}
              {quality.finalQualityScore !== null && ` — ${quality.finalQualityScore}/100`}
            </Badge>
          )}
        </div>
      </div>

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
