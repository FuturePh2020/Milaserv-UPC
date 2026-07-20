'use client';

/**
 * CR-001 Sprint OCR-02 Extension — "Prescription Region Detector" /
 * "Preview Workspace": lets a reviewer confirm one of the detected
 * candidate regions (optionally more than one, which spawns extra
 * pages), or draw a manual override box, before the page is queued.
 *
 * Coordinate space: every box (region + manual) is tracked as a
 * *fraction* of the image (0..1), independent of on-screen zoom — the
 * overlay is absolutely positioned inside the same element the <img>
 * fills at width:100%, so percentages always line up with the rendered
 * pixels regardless of zoom level. Only converted to real pixel
 * coordinates (against originalWidth/originalHeight) at submit time.
 *
 * Rotation is intentionally visual-only (a "is this sideways?" aid): the
 * region overlay and manual-draw interaction are disabled whenever
 * rotation != 0, which avoids inverse-transforming drag coordinates
 * through a CSS rotation.
 */
import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type {
  ConfirmCropResponse,
  CropBox,
  PageOriginalResponse,
  PrescriptionRegionEntry,
  PrescriptionSourceType,
} from '@/lib/prescription-types';
import { Badge, Button, ErrorState, Spinner } from '@/components/ui';

interface FracBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  prescriptionId: string;
  pageId: string;
  pageNumber: number;
  regions: PrescriptionRegionEntry[];
  sourceType: PrescriptionSourceType;
  screenshotDetected: boolean | null;
  screenshotApplicationHint: string | null;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
const MIN_DRAG_FRACTION = 0.02;

function toCropBox(box: FracBox, naturalWidth: number, naturalHeight: number): CropBox {
  return {
    x: Math.round(box.x * naturalWidth),
    y: Math.round(box.y * naturalHeight),
    width: Math.max(1, Math.round(box.w * naturalWidth)),
    height: Math.max(1, Math.round(box.h * naturalHeight)),
  };
}

function fracFromPixelBox(box: CropBox, naturalWidth: number, naturalHeight: number): FracBox {
  return {
    x: box.x / naturalWidth,
    y: box.y / naturalHeight,
    w: box.width / naturalWidth,
    h: box.height / naturalHeight,
  };
}

export function PageCropWorkspace({
  prescriptionId,
  pageId,
  pageNumber,
  regions,
  sourceType,
  screenshotDetected,
  screenshotApplicationHint,
}: Props) {
  const t = useTranslations();
  const qc = useQueryClient();
  const wrapRef = useRef<HTMLDivElement>(null);

  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [manualBox, setManualBox] = useState<FracBox | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: original, isLoading } = useQuery({
    queryKey: ['prescription-page-original', pageId],
    queryFn: () =>
      api<PageOriginalResponse>(`/prescriptions/${prescriptionId}/pages/${pageId}/original`),
  });

  const confirm = useMutation({
    mutationFn: (body: { selectedRegionIndices?: number[]; manualCropBox?: CropBox }) =>
      api<ConfirmCropResponse>(`/prescriptions/${prescriptionId}/pages/${pageId}/crop`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      setSubmitError(null);
      void qc.invalidateQueries({ queryKey: ['prescription-summary', prescriptionId] });
    },
    onError: (err) => setSubmitError(err instanceof ApiError ? err.message : t('common.error')),
  });

  const pointToFraction = useCallback((clientX: number, clientY: number) => {
    const el = wrapRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }, []);

  const canDraw = rotation === 0;

  const handleStart = (clientX: number, clientY: number) => {
    if (!canDraw) return;
    const p = pointToFraction(clientX, clientY);
    if (!p) return;
    setDragStart(p);
    setDragCurrent(p);
  };
  const handleMove = (clientX: number, clientY: number) => {
    if (!dragStart) return;
    const p = pointToFraction(clientX, clientY);
    if (p) setDragCurrent(p);
  };
  const handleEnd = () => {
    if (!dragStart || !dragCurrent) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }
    const x = Math.min(dragStart.x, dragCurrent.x);
    const y = Math.min(dragStart.y, dragCurrent.y);
    const w = Math.abs(dragCurrent.x - dragStart.x);
    const h = Math.abs(dragCurrent.y - dragStart.y);
    setDragStart(null);
    setDragCurrent(null);
    if (w < MIN_DRAG_FRACTION || h < MIN_DRAG_FRACTION) return; // treat as a click, not a drag
    setManualBox({ x, y, w, h });
    setSelectedIndices(new Set());
  };

  const toggleRegion = (index: number) => {
    if (!canDraw) return;
    setManualBox(null);
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const resetCrop = () => {
    setSelectedIndices(new Set());
    setManualBox(null);
    setDragStart(null);
    setDragCurrent(null);
  };

  const submit = () => {
    const naturalWidth = original?.width;
    const naturalHeight = original?.height;
    if (manualBox) {
      if (!naturalWidth || !naturalHeight) return;
      confirm.mutate({ manualCropBox: toCropBox(manualBox, naturalWidth, naturalHeight) });
    } else if (selectedIndices.size > 0) {
      confirm.mutate({ selectedRegionIndices: Array.from(selectedIndices).sort((a, b) => a - b) });
    }
  };

  const liveDragBox: FracBox | null =
    dragStart && dragCurrent
      ? {
          x: Math.min(dragStart.x, dragCurrent.x),
          y: Math.min(dragStart.y, dragCurrent.y),
          w: Math.abs(dragCurrent.x - dragStart.x),
          h: Math.abs(dragCurrent.y - dragStart.y),
        }
      : null;

  const canConfirm = (manualBox !== null || selectedIndices.size > 0) && !confirm.isPending;

  return (
    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="amber">{t('ocr.preprocessing.manualCropRequired')}</Badge>
          <Badge tone="gray">{t(`ocr.preprocessing.sourceType.${sourceType}`)}</Badge>
          {screenshotDetected && (
            <Badge tone="blue">
              {t('ocr.preprocessing.screenshotDetected')}
              {screenshotApplicationHint ? ` — ${screenshotApplicationHint}` : ''}
            </Badge>
          )}
        </div>
        <span className="text-xs text-gray-500">
          {t('ocr.preprocessing.page')} #{pageNumber}
        </span>
      </div>

      <p className="text-xs text-amber-800">{t('ocr.preprocessing.cropWorkspaceHint')}</p>

      {regions.length > 1 && (
        <p className="text-xs text-gray-600">
          {t('ocr.preprocessing.multipleRegionsHint', { count: regions.length })}
        </p>
      )}

      {isLoading || !original ? (
        <Spinner />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
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
            <Button type="button" variant="secondary" onClick={resetCrop}>
              {t('ocr.preprocessing.resetCropBtn')}
            </Button>
          </div>
          {!canDraw && (
            <p className="text-xs text-amber-700">{t('ocr.preprocessing.rotateDisablesDraw')}</p>
          )}

          <div className="max-h-[420px] overflow-auto rounded border border-gray-300 bg-gray-100">
            <div
              ref={wrapRef}
              className="relative select-none"
              style={{
                width: `${zoom * 100}%`,
                transform: `rotate(${rotation}deg)`,
                transformOrigin: 'center',
                cursor: canDraw ? 'crosshair' : 'default',
              }}
              onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
              onMouseMove={(e) => dragStart && handleMove(e.clientX, e.clientY)}
              onMouseUp={handleEnd}
              onMouseLeave={handleEnd}
              onTouchStart={(e) => {
                const touch = e.touches[0];
                if (touch) handleStart(touch.clientX, touch.clientY);
              }}
              onTouchMove={(e) => {
                const touch = e.touches[0];
                if (touch) handleMove(touch.clientX, touch.clientY);
              }}
              onTouchEnd={handleEnd}
            >
              {/* A signed, short-TTL storage URL — not a static asset next/image can optimize. */}
              <img src={original.url} alt="" className="block w-full" draggable={false} />

              {canDraw &&
                regions.map((r) => {
                  if (!original.width || !original.height) return null;
                  const frac = fracFromPixelBox(r.boundingBoxJson, original.width, original.height);
                  const active = selectedIndices.has(r.regionIndex);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleRegion(r.regionIndex)}
                      className={`absolute flex items-start justify-start border-2 text-[10px] font-medium ${
                        active
                          ? 'border-blue-600 bg-blue-500/20 text-blue-800'
                          : 'border-dashed border-gray-500 bg-black/5 text-gray-700 hover:bg-blue-500/10'
                      }`}
                      style={{
                        left: `${frac.x * 100}%`,
                        top: `${frac.y * 100}%`,
                        width: `${frac.w * 100}%`,
                        height: `${frac.h * 100}%`,
                      }}
                    >
                      <span className="m-0.5 rounded bg-white/90 px-1">
                        {t('ocr.preprocessing.regionLabel', {
                          index: r.regionIndex + 1,
                          confidence: Math.round(r.confidence * 100),
                        })}
                      </span>
                    </button>
                  );
                })}

              {canDraw && manualBox && (
                <div
                  className="absolute border-2 border-green-600 bg-green-500/20"
                  style={{
                    left: `${manualBox.x * 100}%`,
                    top: `${manualBox.y * 100}%`,
                    width: `${manualBox.w * 100}%`,
                    height: `${manualBox.h * 100}%`,
                  }}
                />
              )}
              {canDraw && liveDragBox && (
                <div
                  className="pointer-events-none absolute border-2 border-green-600 bg-green-500/10"
                  style={{
                    left: `${liveDragBox.x * 100}%`,
                    top: `${liveDragBox.y * 100}%`,
                    width: `${liveDragBox.w * 100}%`,
                    height: `${liveDragBox.h * 100}%`,
                  }}
                />
              )}
            </div>
          </div>

          {submitError && <ErrorState message={submitError} />}

          <div className="flex justify-end gap-2">
            <Button type="button" onClick={submit} disabled={!canConfirm}>
              {t('ocr.preprocessing.confirmCropBtn')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
