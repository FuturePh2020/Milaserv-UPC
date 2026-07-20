'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickName } from '@/lib/names';
import type { Page } from '@/lib/types';
import type {
  CrmCatalogs,
  ImportResponse,
  LeadRow,
  OrderRow,
  PreviewResponse,
} from '@/lib/crm-types';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Spinner,
} from '@/components/ui';

type Tab = 'queue' | 'leads' | 'orders';

const LEAD_TONES = { NEW: 'blue', ASSIGNED: 'amber', CLOSED: 'gray' } as const;
const ORDER_TONES = { OPEN: 'amber', COMPLETED: 'green', CANCELLED: 'gray' } as const;

export default function CrmPage() {
  const t = useTranslations();
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<Tab>('queue');
  const [showUpload, setShowUpload] = useState(false);

  const { data: catalogs } = useQuery({
    queryKey: ['crm-catalogs'],
    queryFn: () => api<CrmCatalogs>('/crm/catalogs'),
  });

  return (
    <div className="max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('crm.title')}</h1>
        <div className="flex items-center gap-2">
          {hasPermission('crm.upload') && (
            <Button variant="secondary" onClick={() => setShowUpload(true)}>
              {t('crm.uploadLeads')}
            </Button>
          )}
          <div className="flex gap-1">
            {(['queue', 'leads', 'orders'] as const).map((x) => (
              <button
                key={x}
                onClick={() => setTab(x)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  tab === x ? 'bg-[#0b2545] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t(`crm.tabs.${x}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'queue' && catalogs && <QueueTab catalogs={catalogs} />}
      {tab === 'leads' && <LeadsTab />}
      {tab === 'orders' && <OrdersTab />}

      {showUpload && <UploadDialog onClose={() => setShowUpload(false)} />}
    </div>
  );
}

// ── My Queue: one-by-one distribution + call logging (§14.1) ─────────

function QueueTab({ catalogs }: { catalogs: CrmCatalogs }) {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [lead, setLead] = useState<LeadRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const [callStatusKey, setCallStatusKey] = useState('ANSWERED');
  const [dispositionKey, setDispositionKey] = useState('ORDER_CREATED');
  const [notes, setNotes] = useState('');
  const [rescheduledAt, setRescheduledAt] = useState('');
  const [orderTypeKey, setOrderTypeKey] = useState('CASH');
  const [orderValue, setOrderValue] = useState('');

  const disposition = catalogs.dispositions.find((d) => d.key === dispositionKey);

  useEffect(() => {
    if (callStartedAt === null) return;
    const timer = setInterval(
      () => setElapsed(Math.round((Date.now() - callStartedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [callStartedAt]);

  const next = useMutation({
    mutationFn: () => api<LeadRow | null>('/crm/leads/next', { method: 'POST', body: {} }),
    onSuccess: (data) => {
      setError(null);
      setLead(data);
      setCallStartedAt(data ? Date.now() : null);
      setElapsed(0);
      setNotes('');
      setRescheduledAt('');
      setOrderValue('');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const logCall = useMutation({
    mutationFn: () =>
      api(`/crm/leads/${lead!.id}/call`, {
        method: 'POST',
        body: {
          callStatusKey,
          dispositionKey,
          durationSeconds: elapsed,
          ...(notes ? { notes } : {}),
          ...(disposition?.requiresReschedule && rescheduledAt
            ? { rescheduledAt: new Date(rescheduledAt).toISOString() }
            : {}),
          ...(disposition?.createsOrder
            ? { order: { orderTypeKey, value: Number(orderValue) } }
            : {}),
        },
      }),
    onSuccess: () => {
      setError(null);
      setLead(null);
      setCallStartedAt(null);
      void queryClient.invalidateQueries({ queryKey: ['crm-leads'] });
      void queryClient.invalidateQueries({ queryKey: ['crm-orders'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const canSubmit =
    (!disposition?.requiresReschedule || rescheduledAt) &&
    (!disposition?.createsOrder || Number(orderValue) > 0);

  return (
    <div className="max-w-3xl">
      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}
      {!lead ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="mb-4 text-gray-500">{t('crm.queueHint')}</p>
          <Button onClick={() => next.mutate()} disabled={next.isPending}>
            {t('crm.nextLead')}
          </Button>
          {next.isSuccess && next.data === null && (
            <p className="mt-3 text-sm text-gray-400">{t('crm.noLeads')}</p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div className="font-semibold text-gray-800">{lead.name}</div>
            <div className="font-mono text-sm text-gray-500">
              ⏱ {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 border-b border-gray-100 px-4 py-3 text-sm sm:grid-cols-4">
            <Info label={t('crm.phone')} value={lead.phone} dir="ltr" />
            <Info label={t('crm.city')} value={lead.city ?? '—'} />
            <Info label={t('crm.source')} value={lead.leadSource} />
            <Info label={t('crm.campaign')} value={lead.campaign ?? '—'} />
          </div>
          {lead.notes && (
            <p className="border-b border-gray-100 px-4 py-2 text-sm text-gray-500">{lead.notes}</p>
          )}

          <form
            className="space-y-3 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) logCall.mutate();
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label={t('crm.callStatus')}
                value={callStatusKey}
                onChange={(e) => setCallStatusKey(e.target.value)}
              >
                {catalogs.callStatuses.map((s) => (
                  <option key={s.key} value={s.key}>
                    {pickName(locale, s)}
                  </option>
                ))}
              </Select>
              <Select
                label={t('crm.disposition')}
                value={dispositionKey}
                onChange={(e) => setDispositionKey(e.target.value)}
              >
                {catalogs.dispositions.map((d) => (
                  <option key={d.key} value={d.key}>
                    {pickName(locale, d)}
                  </option>
                ))}
              </Select>
            </div>

            {disposition?.requiresReschedule && (
              <Input
                label={t('crm.rescheduleAt')}
                type="datetime-local"
                value={rescheduledAt}
                onChange={(e) => setRescheduledAt(e.target.value)}
                required
              />
            )}

            {disposition?.createsOrder && (
              <div className="grid grid-cols-1 gap-3 rounded-md bg-gray-50 p-3 sm:grid-cols-2">
                <Select
                  label={t('crm.orderType')}
                  value={orderTypeKey}
                  onChange={(e) => setOrderTypeKey(e.target.value)}
                >
                  {catalogs.orderTypes.map((o) => (
                    <option key={o.key} value={o.key}>
                      {pickName(locale, o)}
                    </option>
                  ))}
                </Select>
                <Input
                  label={t('crm.orderValue')}
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={orderValue}
                  onChange={(e) => setOrderValue(e.target.value)}
                  required
                />
              </div>
            )}

            <Input
              label={t('crm.notes')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={logCall.isPending || !canSubmit}>
                {t('crm.saveCall')}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Info({ label, value, dir }: { label: string; value: string; dir?: string }) {
  return (
    <div>
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-gray-800" dir={dir}>
        {value}
      </div>
    </div>
  );
}

// ── Leads list ────────────────────────────────────────────────────────

function LeadsTab() {
  const t = useTranslations();
  const locale = useLocale();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['crm-leads', status, q],
    queryFn: () =>
      api<Page<LeadRow>>(
        `/crm/leads?page=1&pageSize=50${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
  });

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap gap-3 border-b border-gray-100 p-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">
            {t('common.status')}: {t('crm.all')}
          </option>
          {(['NEW', 'ASSIGNED', 'CLOSED'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`crm.leadStates.${s}`)}
            </option>
          ))}
        </Select>
        <Input
          placeholder={t('common.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-64"
        />
      </div>
      {isLoading || !data ? (
        <div className="p-6">
          <Spinner />
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState message={t('common.empty')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 text-start">{t('users.name')}</th>
                <th className="px-4 py-2 text-start">{t('crm.phone')}</th>
                <th className="px-4 py-2 text-start">{t('common.status')}</th>
                <th className="px-4 py-2 text-start">{t('crm.assignedTo')}</th>
                <th className="px-4 py-2 text-start">{t('crm.source')}</th>
                <th className="px-4 py-2 text-start">{t('crm.rescheduleAt')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.items.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2">{l.name}</td>
                  <td className="px-4 py-2" dir="ltr">
                    {l.phone}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={LEAD_TONES[l.status]}>{t(`crm.leadStates.${l.status}`)}</Badge>
                  </td>
                  <td className="px-4 py-2 text-gray-500">
                    {l.assignedTo ? pickName(locale, l.assignedTo) : '—'}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{l.leadSource}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {l.rescheduledAt
                      ? new Date(l.rescheduledAt).toLocaleString(locale === 'ar' ? 'ar' : 'en')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Orders list (§14.4) ───────────────────────────────────────────────

function OrdersTab() {
  const t = useTranslations();
  const locale = useLocale();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['crm-orders'],
    queryFn: () => api<Page<OrderRow>>('/crm/orders?page=1&pageSize=50'),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'COMPLETED' | 'CANCELLED' }) =>
      api(`/crm/orders/${id}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['crm-orders'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const canWork = hasPermission('crm.work');

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      {error && <ErrorState message={error} />}
      {isLoading || !data ? (
        <div className="p-6">
          <Spinner />
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState message={t('common.empty')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 text-start">{t('crm.orderNumber')}</th>
                <th className="px-4 py-2 text-start">{t('crm.customer')}</th>
                <th className="px-4 py-2 text-start">{t('crm.orderType')}</th>
                <th className="px-4 py-2 text-start">{t('crm.orderValue')}</th>
                <th className="px-4 py-2 text-start">{t('common.status')}</th>
                <th className="px-4 py-2 text-start">{t('crm.createdBy')}</th>
                {canWork && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.items.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2 font-mono text-xs">{o.number}</td>
                  <td className="px-4 py-2">{o.customerName}</td>
                  <td className="px-4 py-2 text-gray-500">{pickName(locale, o.orderType)}</td>
                  <td className="px-4 py-2 tabular-nums">{Number(o.value)}</td>
                  <td className="px-4 py-2">
                    <Badge tone={ORDER_TONES[o.status]}>{t(`crm.orderStates.${o.status}`)}</Badge>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{pickName(locale, o.createdBy)}</td>
                  {canWork && (
                    <td className="px-4 py-2 text-end">
                      {o.status === 'OPEN' && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="secondary"
                            disabled={setStatus.isPending}
                            onClick={() => setStatus.mutate({ id: o.id, status: 'COMPLETED' })}
                          >
                            {t('crm.complete')}
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={setStatus.isPending}
                            onClick={() => setStatus.mutate({ id: o.id, status: 'CANCELLED' })}
                          >
                            {t('crm.cancel')}
                          </Button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Upload with validation & preview (§14.1, spec E1) ────────────────

interface ParsedRow {
  name: string;
  phone: string;
  city?: string;
  notes?: string;
}

const HEADER_MAP: Record<string, keyof ParsedRow> = {
  name: 'name',
  الاسم: 'name',
  phone: 'phone',
  الهاتف: 'phone',
  الجوال: 'phone',
  city: 'city',
  المدينة: 'city',
  notes: 'notes',
  ملاحظات: 'notes',
};

function UploadDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [leadSource, setLeadSource] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [campaign, setCampaign] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  async function parseFile(file: File) {
    const XLSX = await import('xlsx');
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const sheet = wb.Sheets[wb.SheetNames[0]!];
    if (!sheet) throw new Error('Empty workbook');
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    return raw
      .map((r) => {
        const row: ParsedRow = { name: '', phone: '' };
        for (const [header, value] of Object.entries(r)) {
          const field = HEADER_MAP[header.trim().toLowerCase()] ?? HEADER_MAP[header.trim()];
          if (field) row[field] = String(value).trim();
        }
        return row;
      })
      .filter((r) => r.name || r.phone);
  }

  const doPreview = useMutation({
    mutationFn: () =>
      api<PreviewResponse>('/crm/leads/preview', {
        method: 'POST',
        body: {
          fileName,
          leadSource,
          partnerName: partnerName || undefined,
          campaign: campaign || undefined,
          rows,
        },
      }),
    onSuccess: (data) => {
      setError(null);
      setPreview(data);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const doImport = useMutation({
    mutationFn: () =>
      api<ImportResponse>('/crm/leads/import', {
        method: 'POST',
        body: {
          fileName,
          leadSource,
          partnerName: partnerName || undefined,
          campaign: campaign || undefined,
          rows,
        },
      }),
    onSuccess: (data) => {
      setError(null);
      setResult(data);
      void queryClient.invalidateQueries({ queryKey: ['crm-leads'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  return (
    <Dialog open onClose={onClose} title={t('crm.uploadLeads')} wide>
      {error && <ErrorState message={error} />}
      {result ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            {t('crm.importDone', { imported: result.imported, skipped: result.skipped.length })}
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>{t('common.close')}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label={t('crm.source')}
              value={leadSource}
              onChange={(e) => setLeadSource(e.target.value)}
              required
            />
            <Input
              label={t('crm.partner')}
              value={partnerName}
              onChange={(e) => setPartnerName(e.target.value)}
            />
            <Input
              label={t('crm.campaign')}
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="block w-full text-sm text-gray-600"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setPreview(null);
              void parseFile(file)
                .then(setRows)
                .catch(() => setError(t('crm.parseError')));
            }}
          />
          {rows.length > 0 && !preview && (
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>{t('crm.rowsParsed', { count: rows.length })}</span>
              <Button
                onClick={() => doPreview.mutate()}
                disabled={doPreview.isPending || leadSource.length < 2}
              >
                {t('crm.previewBtn')}
              </Button>
            </div>
          )}

          {preview && (
            <>
              <div className="flex gap-3 text-sm">
                <Badge tone="green">{t('crm.validCount', { count: preview.counts.valid })}</Badge>
                <Badge tone="amber">
                  {t('crm.dupCount', { count: preview.counts.duplicates })}
                </Badge>
                <Badge tone="red">{t('crm.invalidCount', { count: preview.counts.invalid })}</Badge>
              </div>
              <div className="max-h-64 overflow-y-auto rounded border border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-1.5 text-start">{t('users.name')}</th>
                      <th className="px-3 py-1.5 text-start">{t('crm.phone')}</th>
                      <th className="px-3 py-1.5 text-start">{t('common.status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {preview.rows.map((r) => (
                      <tr key={r.index}>
                        <td className="px-3 py-1.5">{r.name || '—'}</td>
                        <td className="px-3 py-1.5" dir="ltr">
                          {r.phone}
                        </td>
                        <td className="px-3 py-1.5">
                          <Badge
                            tone={
                              r.status === 'VALID'
                                ? 'green'
                                : r.status === 'INVALID'
                                  ? 'red'
                                  : 'amber'
                            }
                          >
                            {r.status === 'VALID' ? t('crm.rowValid') : (r.reason ?? r.status)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() => doImport.mutate()}
                  disabled={doImport.isPending || preview.counts.valid === 0}
                >
                  {t('crm.importBtn', { count: preview.counts.valid })}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
