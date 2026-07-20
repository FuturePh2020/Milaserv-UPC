'use client';

/**
 * CR-001 Phase 5 — Intelligent OCR-to-Drug Matching Engine: the
 * pharmacist review panel (design summary §21-23). Renders once per
 * prescription (matching runs across every page together, unlike the
 * per-page OcrResultsPanel above it). Every score/evidence/conflict the
 * engine produced is shown directly — never hidden behind backend-only
 * logs — and every mutating action here is an explicit pharmacist
 * decision; nothing here is ever auto-confirmed by the engine itself.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type {
  DrugMatchesResponse,
  DrugMatchRunStatus,
  MatchConfidenceLevel,
  MedicationLineMatchingStatus,
  PrescriptionDrugCandidateEntry,
  PrescriptionMedicationLineEntry,
} from '@/lib/prescription-types';
import type { DrugSummary } from '@/lib/dic-types';
import { Badge, Button, Dialog, EmptyState, ErrorState, Spinner } from '@/components/ui';

type Tone = 'gray' | 'green' | 'red' | 'blue' | 'amber' | 'purple';

const CONFIDENCE_TONES: Record<MatchConfidenceLevel, Tone> = {
  VERY_HIGH: 'purple',
  HIGH: 'green',
  MEDIUM: 'amber',
  LOW: 'red',
  UNRESOLVED: 'gray',
};

const LINE_STATUS_TONES: Record<MedicationLineMatchingStatus, Tone> = {
  CANDIDATES_FOUND: 'gray',
  HIGH_CONFIDENCE: 'green',
  AMBIGUOUS: 'amber',
  LOW_CONFIDENCE: 'red',
  UNRESOLVED: 'gray',
  CONFIRMED: 'blue',
  REJECTED: 'red',
  MANUALLY_SELECTED: 'blue',
  NOT_A_MEDICATION: 'gray',
};

const RUN_STATUS_TONES: Record<DrugMatchRunStatus, Tone> = {
  MATCHING_QUEUED: 'gray',
  MATCHING_PROCESSING: 'blue',
  MATCHING_COMPLETED: 'green',
  MATCHING_REVIEW_REQUIRED: 'amber',
  MATCHING_PARTIALLY_RESOLVED: 'amber',
  MATCHING_RESOLVED: 'green',
  MATCHING_FAILED: 'red',
};

const CONFLICT_TONES: Record<string, Tone> = {
  BLOCKING: 'red',
  WARNING: 'amber',
  INFO: 'gray',
};

interface Props {
  prescriptionId: string;
}

export function DrugMatchReviewPanel({ prescriptionId }: Props) {
  const t = useTranslations();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canReview = hasPermission('ocr.review');
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectDialogLineId, setSelectDialogLineId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['prescription-drug-matches', prescriptionId],
    queryFn: () => api<DrugMatchesResponse>(`/prescriptions/${prescriptionId}/drug-matches`),
    retry: false,
  });

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ['prescription-drug-matches', prescriptionId] });

  const reprocess = useMutation({
    mutationFn: () =>
      api(`/prescriptions/${prescriptionId}/drug-matches/reprocess`, { method: 'POST' }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : t('common.error')),
  });

  const confirmCandidate = useMutation({
    mutationFn: (vars: { lineId: string; candidateId: string }) =>
      api(
        `/prescriptions/${prescriptionId}/medication-lines/${vars.lineId}/candidates/${vars.candidateId}/confirm`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : t('common.error')),
  });

  const rejectCandidate = useMutation({
    mutationFn: (vars: { lineId: string; candidateId: string }) =>
      api(
        `/prescriptions/${prescriptionId}/medication-lines/${vars.lineId}/candidates/${vars.candidateId}/reject`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : t('common.error')),
  });

  const selectDrug = useMutation({
    mutationFn: (vars: { lineId: string; drugId: string }) =>
      api(`/prescriptions/${prescriptionId}/medication-lines/${vars.lineId}/select-drug`, {
        method: 'POST',
        body: { drugId: vars.drugId },
      }),
    onSuccess: () => {
      setActionError(null);
      setSelectDialogLineId(null);
      invalidate();
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : t('common.error')),
  });

  const markNotMedication = useMutation({
    mutationFn: (vars: { lineId: string }) =>
      api(`/prescriptions/${prescriptionId}/medication-lines/${vars.lineId}/mark-not-medication`, {
        method: 'POST',
      }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : t('common.error')),
  });

  if (isLoading) return <Spinner />;

  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-1 text-lg font-semibold text-gray-900">{t('ocr.drugMatches.title')}</h2>
          <p className="text-xs text-gray-400">{t('ocr.drugMatches.noRunYet')}</p>
        </div>
      );
    }
    return <ErrorState message={error instanceof ApiError ? error.message : t('common.error')} />;
  }
  if (!data) return null;

  const busy =
    confirmCandidate.isPending ||
    rejectCandidate.isPending ||
    markNotMedication.isPending ||
    selectDrug.isPending;

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <h2 className="text-lg font-semibold text-gray-900">{t('ocr.drugMatches.title')}</h2>
          <Badge tone={RUN_STATUS_TONES[data.run.status] ?? 'gray'}>
            {t(`ocr.drugMatches.runStatus.${data.run.status}`)}
          </Badge>
          <span className="text-xs text-gray-400" dir="ltr">
            v{data.run.matchingEngineVersion} · {data.run.lineCount}{' '}
            {t('ocr.drugMatches.linesLabel')}
          </span>
        </div>
        {canReview && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => reprocess.mutate()}
            disabled={reprocess.isPending}
          >
            {reprocess.isPending
              ? t('ocr.drugMatches.reprocessing')
              : t('ocr.drugMatches.reprocessBtn')}
          </Button>
        )}
      </div>

      {actionError && <ErrorState message={actionError} />}

      {data.lines.length === 0 ? (
        <EmptyState message={t('ocr.drugMatches.noLines')} />
      ) : (
        <ul className="space-y-3">
          {data.lines.map((line) => (
            <MedicationLineCard
              key={line.id}
              line={line}
              canReview={canReview}
              busy={busy}
              onConfirm={(candidateId) => confirmCandidate.mutate({ lineId: line.id, candidateId })}
              onReject={(candidateId) => rejectCandidate.mutate({ lineId: line.id, candidateId })}
              onOpenSelectDialog={() => setSelectDialogLineId(line.id)}
              onMarkNotMedication={() => markNotMedication.mutate({ lineId: line.id })}
            />
          ))}
        </ul>
      )}

      {selectDialogLineId && (
        <SelectDrugDialog
          onClose={() => setSelectDialogLineId(null)}
          onPick={(drugId) => selectDrug.mutate({ lineId: selectDialogLineId, drugId })}
          saving={selectDrug.isPending}
        />
      )}
    </div>
  );
}

function MedicationLineCard({
  line,
  canReview,
  busy,
  onConfirm,
  onReject,
  onOpenSelectDialog,
  onMarkNotMedication,
}: {
  line: PrescriptionMedicationLineEntry;
  canReview: boolean;
  busy: boolean;
  onConfirm: (candidateId: string) => void;
  onReject: (candidateId: string) => void;
  onOpenSelectDialog: () => void;
  onMarkNotMedication: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const dir = line.detectedLanguage === 'ar' ? 'rtl' : 'ltr';
  const ocrConfPct = line.ocrConfidence !== null ? Math.round(line.ocrConfidence * 100) : null;

  return (
    <li className="rounded-md border border-gray-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={LINE_STATUS_TONES[line.matchingStatus] ?? 'gray'}>
            {t(`ocr.drugMatches.lineStatus.${line.matchingStatus}`)}
          </Badge>
          {ocrConfPct !== null && (
            <span className="text-xs text-gray-400" dir="ltr">
              {t('ocr.drugMatches.ocrConfidence')}: {ocrConfPct}%
            </span>
          )}
          {line.reviewRequired && (
            <Badge tone="amber">{t('ocr.drugMatches.reviewRequired')}</Badge>
          )}
        </div>
      </div>

      <p dir={dir} className="mb-2 text-sm text-gray-900">
        {line.rawText}
      </p>

      {line.selectedDrug && (
        <p className="mb-2 rounded bg-blue-50 px-2 py-1 text-xs text-blue-800">
          {t('ocr.drugMatches.selectedLabel')}:{' '}
          <span className="font-medium">
            {locale === 'ar' && line.selectedDrug.nameAr
              ? line.selectedDrug.nameAr
              : line.selectedDrug.nameEn}
          </span>{' '}
          <span dir="ltr">({line.selectedDrug.materialNo})</span>
        </p>
      )}

      {line.candidates.length === 0 ? (
        <p className="text-xs text-gray-400">{t('ocr.drugMatches.noCandidates')}</p>
      ) : (
        <ul className="space-y-2">
          {line.candidates.map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              canReview={canReview}
              busy={busy}
              onConfirm={() => onConfirm(c.id)}
              onReject={() => onReject(c.id)}
            />
          ))}
        </ul>
      )}

      {canReview && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-gray-100 pt-2">
          <Button type="button" variant="ghost" onClick={onOpenSelectDialog} disabled={busy}>
            {t('ocr.drugMatches.selectManuallyBtn')}
          </Button>
          <Button type="button" variant="ghost" onClick={onMarkNotMedication} disabled={busy}>
            {t('ocr.drugMatches.markNotMedicationBtn')}
          </Button>
        </div>
      )}
    </li>
  );
}

function CandidateCard({
  candidate,
  canReview,
  busy,
  onConfirm,
  onReject,
}: {
  candidate: PrescriptionDrugCandidateEntry;
  canReview: boolean;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const scorePct = candidate.matchConfidence !== null ? Math.round(candidate.matchConfidence * 100) : null;
  const conflicts = candidate.conflictsJson ?? [];

  return (
    <li
      className={`rounded-md border p-2.5 text-sm ${
        candidate.selected
          ? 'border-blue-400 bg-blue-50/50'
          : candidate.rejected
            ? 'border-gray-200 bg-gray-50 opacity-60'
            : 'border-gray-200'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {candidate.rank !== null && (
            <span className="text-xs font-medium text-gray-400" dir="ltr">
              #{candidate.rank}
            </span>
          )}
          <span className="font-medium text-gray-900">
            {candidate.matchedDrug
              ? locale === 'ar' && candidate.matchedDrug.nameAr
                ? candidate.matchedDrug.nameAr
                : candidate.matchedDrug.nameEn
              : t('ocr.drugMatches.unknownDrug')}
          </span>
          {candidate.matchedDrug && (
            <span className="text-xs text-gray-400" dir="ltr">
              {candidate.matchedDrug.materialNo}
            </span>
          )}
          {candidate.confidenceLevel && (
            <Badge tone={CONFIDENCE_TONES[candidate.confidenceLevel]}>
              {t(`ocr.drugMatches.confidenceLevel.${candidate.confidenceLevel}`)}
            </Badge>
          )}
          {scorePct !== null && (
            <span className="text-xs text-gray-500" dir="ltr">
              {scorePct}/100
            </span>
          )}
          {candidate.selected && <Badge tone="blue">{t('ocr.drugMatches.confirmed')}</Badge>}
          {candidate.rejected && <Badge tone="red">{t('ocr.drugMatches.rejected')}</Badge>}
        </div>
        <button
          type="button"
          className="text-xs text-gray-500 underline hover:text-gray-700"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? t('ocr.drugMatches.hideDetails') : t('ocr.drugMatches.showDetails')}
        </button>
      </div>

      {conflicts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {conflicts.map((conflict, i) => (
            <Badge key={i} tone={CONFLICT_TONES[conflict.severity] ?? 'gray'}>
              {conflict.message}
            </Badge>
          ))}
        </div>
      )}

      {expanded && (
        <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
          {candidate.explanationText && (
            <p className="text-xs text-gray-600">{candidate.explanationText}</p>
          )}
          {candidate.evidenceJson && candidate.evidenceJson.length > 0 && (
            <div className="grid grid-cols-2 gap-1 text-xs text-gray-500 sm:grid-cols-3">
              {candidate.evidenceJson.map((e, i) => (
                <span key={i} dir="ltr">
                  {e.type}: {Math.round(e.rawScore)}/100
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {canReview && !candidate.rejected && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {!candidate.selected && (
            <Button type="button" variant="ghost" onClick={onConfirm} disabled={busy}>
              {t('ocr.drugMatches.confirmBtn')}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onReject} disabled={busy}>
            {t('ocr.drugMatches.rejectBtn')}
          </Button>
        </div>
      )}
    </li>
  );
}

/** Mirrors the legacy /ocr module's own CorrectDialog (DIC search picker,
 *  spec I5/§15.1) — same interaction, reused for Phase 5's manual
 *  drug-selection flow. */
function SelectDrugDialog({
  onClose,
  onPick,
  saving,
}: {
  onClose: () => void;
  onPick: (drugId: string) => void;
  saving: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [q, setQ] = useState('');

  const { data } = useQuery({
    queryKey: ['drug-match-select-search', q],
    queryFn: () => api<{ items: DrugSummary[] }>(`/dic/search?q=${encodeURIComponent(q)}&limit=8`),
    enabled: q.trim().length > 1,
  });

  return (
    <Dialog open onClose={onClose} title={t('ocr.drugMatches.selectManuallyTitle')}>
      <div className="space-y-3">
        <input
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#0b2545]"
          placeholder={t('dic.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          disabled={saving}
        />
        <ul className="divide-y divide-gray-100">
          {data?.items.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="w-full rounded px-2 py-2 text-start text-sm hover:bg-gray-50"
                onClick={() => onPick(d.id)}
                disabled={saving}
              >
                <span className="font-medium text-gray-900">
                  {locale === 'ar' && d.nameAr ? d.nameAr : d.nameEn}
                </span>{' '}
                <span className="text-xs text-gray-400" dir="ltr">
                  {d.materialNo}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
