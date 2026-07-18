'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { getAccessToken } from '@/lib/tokens';
import { useAuth } from '@/lib/auth';
import type {
  OcrConfig,
  PrescriptionDetail,
  PrescriptionLineRow,
  PrescriptionRow,
  PrescriptionStatus,
} from '@/lib/ocr-types';
import type { DrugSummary } from '@/lib/dic-types';
import { Badge, Button, Dialog, EmptyState, ErrorState, Select, Spinner } from '@/components/ui';

const STATUS_TONES: Record<PrescriptionStatus, 'gray' | 'blue' | 'amber' | 'green' | 'red'> = {
  UPLOADED: 'gray',
  EXTRACTING: 'blue',
  REVIEW: 'amber',
  CONFIRMED: 'green',
  REJECTED: 'red',
};

const LINE_TONES: Record<PrescriptionLineRow['status'], 'gray' | 'green' | 'blue' | 'red'> = {
  SUGGESTED: 'gray',
  CONFIRMED: 'green',
  CORRECTED: 'blue',
  REJECTED: 'red',
};

async function uploadAttachment(prescriptionId: string, file: File) {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(
    `${base}/api/v1/attachments?entityType=prescription&entityId=${prescriptionId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${getAccessToken()}` },
      body: form,
    },
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(res.status, data?.message ?? `Upload failed (${res.status})`);
  }
}

export default function OcrPage() {
  const t = useTranslations();
  const { hasPermission } = useAuth();
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const canUpload = hasPermission('ocr.upload');
  const canReview = hasPermission('ocr.review');

  const { data, isLoading } = useQuery({
    queryKey: ['ocr-list', status],
    queryFn: () =>
      api<{ items: PrescriptionRow[]; total: number }>(
        `/ocr/prescriptions?pageSize=25${status ? `&status=${status}` : ''}`,
      ),
    refetchInterval: 5000,
  });
  const { data: config } = useQuery({
    queryKey: ['ocr-config'],
    queryFn: () => api<OcrConfig>('/ocr/config'),
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('ocr.title')}</h1>
        <div className="flex items-center gap-2">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            <option value="">{t('ocr.allStatuses')}</option>
            {(['UPLOADED', 'EXTRACTING', 'REVIEW', 'CONFIRMED', 'REJECTED'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`ocr.status.${s}`)}
              </option>
            ))}
          </Select>
          {canUpload && <Button onClick={() => setShowNew(true)}>{t('ocr.newBtn')}</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-gray-200 bg-white">
            {isLoading ? (
              <div className="p-6">
                <Spinner />
              </div>
            ) : !data || data.items.length === 0 ? (
              <div className="p-6">
                <EmptyState message={t('ocr.empty')} />
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.items.map((rx) => (
                  <li key={rx.id}>
                    <button
                      onClick={() => setSelectedId(rx.id)}
                      className={`w-full px-4 py-3 text-start hover:bg-gray-50 ${
                        selectedId === rx.id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-900" dir="ltr">
                          {rx.number}
                        </span>
                        <Badge tone={STATUS_TONES[rx.status]}>{t(`ocr.status.${rx.status}`)}</Badge>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-xs text-gray-400">
                        <span>{t('ocr.lineCount', { count: rx._count.lines })}</span>
                        <span>{new Date(rx.createdAt).toLocaleDateString()}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="lg:col-span-3">
          {selectedId === null ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400">
              {t('ocr.pickPrescription')}
            </div>
          ) : (
            <DetailPanel
              id={selectedId}
              canReview={canReview}
              minConfidence={config?.minConfidence ?? 0.6}
            />
          )}
        </div>
      </div>

      {showNew && <NewDialog onClose={() => setShowNew(false)} onCreated={setSelectedId} />}
    </div>
  );
}

// ── upload flow (spec I2): create → attach → submit ───────────────────

function NewDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      if (!file) throw new ApiError(400, t('ocr.fileRequired'));
      const rx = await api<{ id: string }>('/ocr/prescriptions', {
        method: 'POST',
        body: note ? { note } : {},
      });
      await uploadAttachment(rx.id, file);
      await api(`/ocr/prescriptions/${rx.id}/submit`, { method: 'POST', body: {} });
      return rx.id;
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: ['ocr-list'] });
      onCreated(id);
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  return (
    <Dialog open onClose={onClose} title={t('ocr.newTitle')}>
      <div className="space-y-3">
        <p className="text-sm text-gray-500">{t('ocr.newHint')}</p>
        {error && <ErrorState message={error} />}
        <input
          type="file"
          accept="image/*,.pdf"
          className="block w-full text-sm text-gray-600"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">{t('dic.note')}</span>
          <textarea
            rows={2}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#0b2545]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending || !file}>
            {t('ocr.submitBtn')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── §17 review: confidence, correction, availability, alternatives ────

function ConfidenceBadge({
  value,
  min,
  label,
}: {
  value: number | null;
  min: number;
  label: string;
}) {
  if (value === null) return null;
  const pct = Math.round(value * 100);
  return (
    <Badge tone={value < min ? 'amber' : 'green'}>
      {label} {pct}%
    </Badge>
  );
}

function DetailPanel({
  id,
  canReview,
  minConfidence,
}: {
  id: string;
  canReview: boolean;
  minConfidence: number;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [newLine, setNewLine] = useState('');

  const { data: rx, isLoading } = useQuery({
    queryKey: ['ocr-rx', id],
    queryFn: () => api<PrescriptionDetail>(`/ocr/prescriptions/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'EXTRACTING' ? 3000 : false),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['ocr-rx', id] });
    void queryClient.invalidateQueries({ queryKey: ['ocr-list'] });
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : t('common.error'));

  const decideLine = useMutation({
    mutationFn: (args: { lineId: string; decision: string; drugId?: string }) =>
      api(`/ocr/lines/${args.lineId}/decide`, {
        method: 'POST',
        body: { decision: args.decision, ...(args.drugId ? { drugId: args.drugId } : {}) },
      }),
    onSuccess: () => {
      setError(null);
      setCorrecting(null);
      invalidate();
    },
    onError,
  });

  const addLine = useMutation({
    mutationFn: () =>
      api(`/ocr/prescriptions/${id}/lines`, { method: 'POST', body: { rawText: newLine } }),
    onSuccess: () => {
      setError(null);
      setNewLine('');
      invalidate();
    },
    onError,
  });

  if (isLoading || !rx) return <Spinner />;

  const drugName = (d: { nameEn: string; nameAr: string | null }) =>
    locale === 'ar' && d.nameAr ? d.nameAr : d.nameEn;

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900" dir="ltr">
            {rx.number}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_TONES[rx.status]}>{t(`ocr.status.${rx.status}`)}</Badge>
            {rx.relatedOrderNo && (
              <Badge tone="blue">
                {t('ocr.orderNo')}: {rx.relatedOrderNo}
              </Badge>
            )}
          </div>
          {rx.note && <p className="mt-1 text-sm text-gray-500">{rx.note}</p>}
        </div>
        {canReview && rx.status === 'REVIEW' && (
          <div className="flex gap-2">
            <Button onClick={() => setConfirming(true)}>{t('ocr.confirmBtn')}</Button>
            <Button variant="danger" onClick={() => setRejecting(true)}>
              {t('ocr.rejectBtn')}
            </Button>
          </div>
        )}
      </div>

      {error && <ErrorState message={error} />}
      {rx.status === 'EXTRACTING' && <p className="text-sm text-blue-700">{t('ocr.extracting')}</p>}

      <div className="space-y-3">
        {rx.lines.map((line) => (
          <div key={line.id} className="rounded-md border border-gray-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">#{line.lineNo}</span>
                <span className="text-sm font-medium text-gray-900" dir="auto">
                  {line.rawText}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <ConfidenceBadge
                  value={line.engineConfidence}
                  min={minConfidence}
                  label={t('ocr.engineConf')}
                />
                <ConfidenceBadge
                  value={line.matchScore}
                  min={minConfidence}
                  label={t('ocr.matchScore')}
                />
                <Badge tone={LINE_TONES[line.status]}>{t(`ocr.lineStatus.${line.status}`)}</Badge>
              </div>
            </div>

            {line.matchedDrug ? (
              <div className="mt-2 rounded bg-gray-50 p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-gray-800">{drugName(line.matchedDrug)}</span>
                  <span className="text-xs text-gray-400" dir="ltr">
                    {line.matchedDrug.materialNo}
                    {line.matchedDrug.priceWithTax != null &&
                      ` · ${Number(line.matchedDrug.priceWithTax).toFixed(2)}`}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {Object.entries(line.matchedDrug.availability ?? {})
                    .filter(([, v]) => v > 0)
                    .map(([city, qty]) => (
                      <Badge key={city} tone="blue">
                        {city}: {qty}
                      </Badge>
                    ))}
                  {Object.keys(line.matchedDrug.availability ?? {}).length === 0 && (
                    <span className="text-xs text-gray-400">{t('dic.noAvailability')}</span>
                  )}
                </div>
                {line.alternatives.length > 0 && (
                  <div className="mt-1 text-xs text-gray-500">
                    {t('ocr.alternatives')}:{' '}
                    {line.alternatives
                      .filter((a) => a.drug)
                      .map((a) => drugName(a.drug!))
                      .join('، ')}
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-amber-700">{t('ocr.unmatched')}</p>
            )}

            {canReview && rx.status === 'REVIEW' && line.status === 'SUGGESTED' && (
              <div className="mt-2 flex flex-wrap gap-2">
                {line.matchedDrugId && (
                  <Button
                    onClick={() => decideLine.mutate({ lineId: line.id, decision: 'confirm' })}
                    disabled={decideLine.isPending}
                  >
                    {t('ocr.lineConfirm')}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setCorrecting(line.id)}>
                  {t('ocr.lineCorrect')}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => decideLine.mutate({ lineId: line.id, decision: 'reject' })}
                  disabled={decideLine.isPending}
                >
                  {t('ocr.lineReject')}
                </Button>
              </div>
            )}
          </div>
        ))}
        {rx.lines.length === 0 && rx.status !== 'EXTRACTING' && (
          <EmptyState message={t('ocr.noLines')} />
        )}
      </div>

      {canReview &&
        (rx.status === 'REVIEW' || rx.status === 'EXTRACTING' || rx.status === 'UPLOADED') && (
          <div className="flex gap-2">
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#0b2545]"
              placeholder={t('ocr.addLinePlaceholder')}
              value={newLine}
              onChange={(e) => setNewLine(e.target.value)}
            />
            <Button
              variant="secondary"
              onClick={() => addLine.mutate()}
              disabled={addLine.isPending || !newLine.trim()}
            >
              {t('ocr.addLineBtn')}
            </Button>
          </div>
        )}

      {correcting && (
        <CorrectDialog
          onClose={() => setCorrecting(null)}
          onPick={(drugId) =>
            decideLine.mutate({ lineId: correcting, decision: 'correct', drugId })
          }
        />
      )}
      {confirming && (
        <ConfirmDialog id={id} onClose={() => setConfirming(false)} onDone={invalidate} />
      )}
      {rejecting && (
        <RejectDialog id={id} onClose={() => setRejecting(false)} onDone={invalidate} />
      )}
    </div>
  );
}

/** Correction picker rides the §15.1 DIC search (spec I5). */
function CorrectDialog({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (drugId: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [q, setQ] = useState('');

  const { data } = useQuery({
    queryKey: ['ocr-correct-search', q],
    queryFn: () => api<{ items: DrugSummary[] }>(`/dic/search?q=${encodeURIComponent(q)}&limit=8`),
    enabled: q.trim().length > 1,
  });

  return (
    <Dialog open onClose={onClose} title={t('ocr.correctTitle')}>
      <div className="space-y-3">
        <input
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#0b2545]"
          placeholder={t('dic.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <ul className="divide-y divide-gray-100">
          {data?.items.map((d) => (
            <li key={d.id}>
              <button
                className="w-full rounded px-2 py-2 text-start text-sm hover:bg-gray-50"
                onClick={() => {
                  onPick(d.id);
                  onClose();
                }}
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

function ConfirmDialog({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations();
  const [ticketNo, setTicketNo] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const confirm = useMutation({
    mutationFn: () =>
      api(`/ocr/prescriptions/${id}/confirm`, {
        method: 'POST',
        body: {
          ...(ticketNo.trim() ? { ticketNo: ticketNo.trim() } : {}),
          ...(orderNo.trim() ? { orderNo: orderNo.trim() } : {}),
        },
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  return (
    <Dialog open onClose={onClose} title={t('ocr.confirmTitle')}>
      <div className="space-y-3">
        <p className="text-sm text-gray-500">{t('ocr.confirmHint')}</p>
        {error && <ErrorState message={error} />}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">{t('ocr.ticketNo')}</span>
          <input
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#0b2545]"
            dir="ltr"
            value={ticketNo}
            onChange={(e) => setTicketNo(e.target.value)}
            placeholder="TKT-2026-000123"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">{t('ocr.orderNo')}</span>
          <input
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#0b2545]"
            dir="ltr"
            value={orderNo}
            onChange={(e) => setOrderNo(e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => confirm.mutate()} disabled={confirm.isPending}>
            {t('ocr.confirmBtn')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RejectDialog({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reject = useMutation({
    mutationFn: () => api(`/ocr/prescriptions/${id}/reject`, { method: 'POST', body: { note } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  return (
    <Dialog open onClose={onClose} title={t('ocr.rejectTitle')}>
      <div className="space-y-3">
        {error && <ErrorState message={error} />}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t('ocr.rejectNote')}
          </span>
          <textarea
            rows={2}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#0b2545]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => reject.mutate()}
            disabled={reject.isPending || !note.trim()}
          >
            {t('ocr.rejectBtn')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
