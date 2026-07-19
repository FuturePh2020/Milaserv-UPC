'use client';

/**
 * CR-001 Sprint OCR-03 — OCR Results Viewer + Manual OCR Review
 * Foundation (design doc §14/§15): the current run's text blocks with a
 * bounding-polygon overlay on the image OCR actually ran against, plus
 * per-block review actions (mark correct/unreadable/irrelevant, or store
 * a corrected reading) — never mutating what OCR itself produced. A
 * re-run button (permission-gated) starts a brand-new, fully separate
 * PrescriptionOcrRun; every prior run stays intact (design doc §16).
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type {
  ImageVersionEntry,
  OcrTextBlockEntry,
  PrescriptionPageTextResponse,
  RerunOcrResponse,
} from '@/lib/prescription-types';
import { Badge, Button, ErrorState, Spinner } from '@/components/ui';

interface Props {
  prescriptionId: string;
  pageId: string;
  requiresOcrReview: boolean;
  ocrPageConfidence: number | null;
  hasRun: boolean;
  /** The best available OCR-ready-or-fallback image version, matching
   *  the worker's own priority so the overlay lines up with the
   *  coordinate space OCR actually ran against. */
  ocrImageVersion: ImageVersionEntry | undefined;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

function confidenceTone(pct: number): 'green' | 'amber' | 'red' {
  if (pct >= 80) return 'green';
  if (pct >= 50) return 'amber';
  return 'red';
}

export function OcrResultsPanel({
  prescriptionId,
  pageId,
  requiresOcrReview,
  ocrPageConfidence,
  hasRun,
  ocrImageVersion,
}: Props) {
  const t = useTranslations();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canReview = hasPermission('ocr.review');

  const [showOverlay, setShowOverlay] = useState(true);
  const [showNormalized, setShowNormalized] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['prescription-page-text', pageId],
    queryFn: () =>
      api<PrescriptionPageTextResponse>(`/prescriptions/${prescriptionId}/pages/${pageId}/text`),
    enabled: hasRun,
  });

  const rerun = useMutation({
    mutationFn: () =>
      api<RerunOcrResponse>(`/prescriptions/${prescriptionId}/pages/${pageId}/rerun-ocr`, {
        method: 'POST',
      }),
    onSuccess: () => {
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['prescription-page-text', pageId] });
      void qc.invalidateQueries({ queryKey: ['prescription-summary', prescriptionId] });
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : t('common.error')),
  });

  const correct = useMutation({
    mutationFn: (vars: { blockId: string; markedAs?: string; correctedText?: string }) =>
      api(`/prescriptions/${prescriptionId}/pages/${pageId}/blocks/${vars.blockId}/correct`, {
        method: 'POST',
        body: { markedAs: vars.markedAs, correctedText: vars.correctedText },
      }),
    onSuccess: () => {
      setActionError(null);
      setEditingBlockId(null);
      void qc.invalidateQueries({ queryKey: ['prescription-page-text', pageId] });
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : t('common.error')),
  });

  const blocks = useMemo(
    () => [...(data?.blocks ?? [])].sort((a, b) => a.lineNumber - b.lineNumber),
    [data?.blocks],
  );

  if (!hasRun) {
    return <p className="text-xs text-gray-400">{t('ocr.results.noRunYet')}</p>;
  }
  if (isLoading || !data) return <Spinner />;

  const pageConfPct = ocrPageConfidence !== null ? Math.round(ocrPageConfidence) : null;

  return (
    <div className="space-y-3 border-t border-gray-100 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="text-sm font-semibold text-gray-900">{t('ocr.results.title')}</h3>
          {pageConfPct !== null && (
            <Badge tone={confidenceTone(pageConfPct)}>
              {t('ocr.results.pageConfidence')}: <span dir="ltr">{pageConfPct}%</span>
            </Badge>
          )}
          {requiresOcrReview && <Badge tone="amber">{t('ocr.results.requiresReview')}</Badge>}
          {data.run && (
            <span className="text-xs text-gray-400" dir="ltr">
              {t('ocr.results.runLabel', { number: data.run.runNumber })} · {data.run.providerName}
            </span>
          )}
        </div>
        {canReview && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => rerun.mutate()}
            disabled={rerun.isPending}
          >
            {rerun.isPending ? t('ocr.results.rerunning') : t('ocr.results.rerunBtn')}
          </Button>
        )}
      </div>

      {actionError && <ErrorState message={actionError} />}

      {blocks.length === 0 ? (
        <p className="text-xs text-gray-400">{t('ocr.results.noBlocks')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Button type="button" variant="ghost" onClick={() => setShowOverlay((s) => !s)}>
              {showOverlay ? t('ocr.results.hideOverlay') : t('ocr.results.showOverlay')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowNormalized((s) => !s)}>
              {showNormalized ? t('ocr.results.showRaw') : t('ocr.results.showNormalized')}
            </Button>
            {ocrImageVersion && (
              <>
                <span className="mx-1 h-4 w-px bg-gray-200" />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
                  disabled={zoom <= ZOOM_MIN}
                >
                  {t('ocr.preprocessing.zoomOut')}
                </Button>
                <span dir="ltr" className="text-gray-500">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
                  disabled={zoom >= ZOOM_MAX}
                >
                  {t('ocr.preprocessing.zoomIn')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                >
                  {t('ocr.preprocessing.rotateBtn')} ({rotation}°)
                </Button>
              </>
            )}
          </div>

          {ocrImageVersion && (
            <div className="max-h-[420px] overflow-auto rounded border border-gray-300 bg-gray-100">
              <div
                className="relative"
                style={{
                  width: `${zoom * 100}%`,
                  transform: `rotate(${rotation}deg)`,
                  transformOrigin: 'center',
                }}
              >
                <img src={ocrImageVersion.url} alt="" className="block w-full" draggable={false} />
                {showOverlay &&
                  ocrImageVersion.width &&
                  ocrImageVersion.height &&
                  blocks.map((b) => (
                    <BlockOverlay
                      key={b.id}
                      block={b}
                      imageWidth={ocrImageVersion.width!}
                      imageHeight={ocrImageVersion.height!}
                      active={activeBlockId === b.id}
                      onSelect={() => setActiveBlockId((cur) => (cur === b.id ? null : b.id))}
                    />
                  ))}
              </div>
            </div>
          )}

          <ul className="space-y-2">
            {blocks.map((b) => (
              <BlockRow
                key={b.id}
                block={b}
                showNormalized={showNormalized}
                active={activeBlockId === b.id}
                canReview={canReview}
                onSelect={() => setActiveBlockId((cur) => (cur === b.id ? null : b.id))}
                editing={editingBlockId === b.id}
                draftText={draftText}
                onStartEdit={() => {
                  setEditingBlockId(b.id);
                  setDraftText(b.corrections[0]?.correctedText ?? b.rawText);
                }}
                onChangeDraft={setDraftText}
                onCancelEdit={() => setEditingBlockId(null)}
                onSaveEdit={() => correct.mutate({ blockId: b.id, correctedText: draftText })}
                onMark={(markedAs) => correct.mutate({ blockId: b.id, markedAs })}
                saving={correct.isPending}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function BlockOverlay({
  block,
  imageWidth,
  imageHeight,
  active,
  onSelect,
}: {
  block: OcrTextBlockEntry;
  imageWidth: number;
  imageHeight: number;
  active: boolean;
  onSelect: () => void;
}) {
  const stroke = active ? '#2563eb' : '#16a34a';
  const fill = active ? 'rgba(37,99,235,0.15)' : 'rgba(22,163,74,0.08)';

  if (block.boundingPolygonJson && block.boundingPolygonJson.length >= 3) {
    const points = block.boundingPolygonJson
      .map(([x, y]) => `${(x / imageWidth) * 100},${(y / imageHeight) * 100}`)
      .join(' ');
    return (
      <svg
        className="absolute inset-0 h-full w-full cursor-pointer"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onClick={onSelect}
      >
        <polygon
          points={points}
          fill={fill}
          stroke={stroke}
          strokeWidth={0.3}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (block.boundingBox) {
    const { x, y, width, height } = block.boundingBox;
    return (
      <button
        type="button"
        onClick={onSelect}
        className="absolute border-2"
        style={{
          left: `${(x / imageWidth) * 100}%`,
          top: `${(y / imageHeight) * 100}%`,
          width: `${(width / imageWidth) * 100}%`,
          height: `${(height / imageHeight) * 100}%`,
          borderColor: stroke,
          backgroundColor: fill,
        }}
      />
    );
  }
  return null;
}

function BlockRow({
  block,
  showNormalized,
  active,
  canReview,
  onSelect,
  editing,
  draftText,
  onStartEdit,
  onChangeDraft,
  onCancelEdit,
  onSaveEdit,
  onMark,
  saving,
}: {
  block: OcrTextBlockEntry;
  showNormalized: boolean;
  active: boolean;
  canReview: boolean;
  onSelect: () => void;
  editing: boolean;
  draftText: string;
  onStartEdit: () => void;
  onChangeDraft: (v: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onMark: (markedAs: 'correct' | 'unreadable' | 'irrelevant_ui') => void;
  saving: boolean;
}) {
  const t = useTranslations();
  const confPct = block.ocrConfidence !== null ? Math.round(block.ocrConfidence * 100) : null;
  const latestCorrection = block.corrections[0];
  const text = showNormalized ? (block.normalizedText ?? block.rawText) : block.rawText;
  const dir = block.textDirection === 'rtl' || block.language === 'ar' ? 'rtl' : 'ltr';

  return (
    <li
      className={`rounded-md border p-2.5 text-sm ${active ? 'border-blue-400 bg-blue-50/50' : 'border-gray-200'}`}
      onClick={onSelect}
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
        {confPct !== null && <Badge tone={confidenceTone(confPct)}>{confPct}%</Badge>}
        {block.language && <Badge tone="gray">{block.language.toUpperCase()}</Badge>}
        {latestCorrection?.markedAs && (
          <Badge
            tone={
              latestCorrection.markedAs === 'correct'
                ? 'green'
                : latestCorrection.markedAs === 'unreadable'
                  ? 'red'
                  : 'amber'
            }
          >
            {t(`ocr.results.markedAs.${latestCorrection.markedAs}`)}
          </Badge>
        )}
        {latestCorrection?.correctedText && <Badge tone="blue">{t('ocr.results.edited')}</Badge>}
      </div>

      {editing ? (
        <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
          <textarea
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-[#0b2545]"
            rows={2}
            dir={dir}
            value={draftText}
            onChange={(e) => onChangeDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="button" onClick={onSaveEdit} disabled={saving}>
              {t('common.save')}
            </Button>
            <Button type="button" variant="secondary" onClick={onCancelEdit}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <p dir={dir} className="text-gray-900">
          {text || <span className="text-gray-400">{t('ocr.results.emptyText')}</span>}
        </p>
      )}

      {canReview && !editing && (
        <div className="mt-2 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button type="button" variant="ghost" onClick={() => onMark('correct')} disabled={saving}>
            {t('ocr.results.markCorrect')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onMark('unreadable')}
            disabled={saving}
          >
            {t('ocr.results.markUnreadable')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onMark('irrelevant_ui')}
            disabled={saving}
          >
            {t('ocr.results.markIrrelevant')}
          </Button>
          <Button type="button" variant="ghost" onClick={onStartEdit} disabled={saving}>
            {t('ocr.results.editText')}
          </Button>
        </div>
      )}
    </li>
  );
}
