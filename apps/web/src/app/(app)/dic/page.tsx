'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickName } from '@/lib/names';
import type {
  ChangeRequestRow,
  DicCatalogs,
  DrugCard,
  DrugSummary,
  ImportChunkResult,
} from '@/lib/dic-types';
import { Badge, Button, Dialog, EmptyState, ErrorState, Select, Spinner } from '@/components/ui';

const SEARCH_FIELDS = ['all', 'brand', 'ingredient', 'material', 'nameAr', 'nameEn'] as const;

/** H5 pharmacist-editable fields — everything else is feed-owned. */
const EDITABLE_FIELDS = ['activeIngredient', 'usage', 'offers', 'note'] as const;

export default function DicPage() {
  const t = useTranslations();
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<'search' | 'approvals'>('search');
  const [showImport, setShowImport] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);

  const canManage = hasPermission('dic.manage');
  const canApprove = hasPermission('dic.approve');

  const { data: catalogs } = useQuery({
    queryKey: ['dic-catalogs'],
    queryFn: () => api<DicCatalogs>('/dic/catalogs'),
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('dic.title')}</h1>
        <div className="flex items-center gap-2">
          {canManage && (
            <>
              <Button variant="secondary" onClick={() => setShowCoverage(true)}>
                {t('dic.covImportBtn')}
              </Button>
              <Button onClick={() => setShowImport(true)}>{t('dic.importBtn')}</Button>
            </>
          )}
        </div>
      </div>

      {canApprove && (
        <div className="mb-4 flex gap-1 border-b border-gray-200">
          {(['search', 'approvals'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`border-b-2 px-4 py-2 text-sm font-medium ${
                tab === k
                  ? 'border-[#0b2545] text-[#0b2545]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t(`dic.tabs.${k}`)}
            </button>
          ))}
        </div>
      )}

      {tab === 'search' ? <SearchTab /> : <ApprovalsTab />}

      {showImport && catalogs && (
        <ImportDialog chunkSize={catalogs.chunkSize} onClose={() => setShowImport(false)} />
      )}
      {showCoverage && catalogs && (
        <CoverageDialog companies={catalogs.companies} onClose={() => setShowCoverage(false)} />
      )}
    </div>
  );
}

// ── §15.1 search + auto-complete, §15.2 drug card ─────────────────────

function SearchTab() {
  const t = useTranslations();
  const locale = useLocale();
  const [q, setQ] = useState('');
  const [field, setField] = useState<(typeof SEARCH_FIELDS)[number]>('all');
  const [debounced, setDebounced] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const { data: results, isFetching } = useQuery({
    queryKey: ['dic-search', debounced, field],
    queryFn: () =>
      api<{ items: DrugSummary[] }>(
        `/dic/search?q=${encodeURIComponent(debounced)}&field=${field}&limit=8`,
      ),
    enabled: debounced.length > 0,
  });

  const { data: drug, isLoading: drugLoading } = useQuery({
    queryKey: ['dic-drug', selectedId],
    queryFn: () => api<DrugCard>(`/dic/drugs/${selectedId}`),
    enabled: selectedId !== null,
  });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex gap-2">
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#0b2545] focus:ring-2 focus:ring-[#0b2545]/20"
              placeholder={t('dic.searchPlaceholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
            <Select
              value={field}
              onChange={(e) => setField(e.target.value as (typeof SEARCH_FIELDS)[number])}
              className="w-40"
            >
              {SEARCH_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {t(`dic.field.${f}`)}
                </option>
              ))}
            </Select>
          </div>

          <div className="mt-3">
            {debounced.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">{t('dic.typeToSearch')}</p>
            ) : isFetching && !results ? (
              <Spinner />
            ) : results && results.items.length === 0 ? (
              <EmptyState message={t('dic.noResults')} />
            ) : (
              <ul className="divide-y divide-gray-100">
                {results?.items.map((d) => (
                  <li key={d.id}>
                    <button
                      onClick={() => setSelectedId(d.id)}
                      className={`w-full rounded px-2 py-2 text-start hover:bg-gray-50 ${
                        selectedId === d.id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-900">{d.nameEn}</span>
                        <span className="text-xs text-gray-400" dir="ltr">
                          {d.materialNo}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {d.nameAr && (
                          <span className="text-xs text-gray-500" dir="rtl">
                            {d.nameAr}
                          </span>
                        )}
                        <Badge tone={d.coded ? 'green' : 'amber'}>
                          {d.coded ? t('dic.coded') : t('dic.notCoded')}
                        </Badge>
                        {d.raqeeb && <Badge tone="red">{t('dic.raqeeb')}</Badge>}
                        {d.priceWithTax !== null && (
                          <span className="text-xs text-gray-500" dir="ltr">
                            {Number(d.priceWithTax).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="lg:col-span-3">
        {selectedId === null ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400">
            {t('dic.pickDrug')}
          </div>
        ) : drugLoading || !drug ? (
          <Spinner />
        ) : (
          <DrugCardView drug={drug} locale={locale} onNavigate={setSelectedId} />
        )}
      </div>
    </div>
  );
}

function Field({ label, value, dir }: { label: string; value: React.ReactNode; dir?: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm text-gray-800" dir={dir}>
        {value ?? '—'}
      </div>
    </div>
  );
}

function DrugCardView({
  drug,
  locale,
  onNavigate,
}: {
  drug: DrugCard;
  locale: string;
  onNavigate: (id: string) => void;
}) {
  const t = useTranslations();
  const [propose, setPropose] = useState(false);

  const availability = Object.entries(drug.availability ?? {}).filter(([, v]) => v > 0);

  const relatedList = (
    rows: {
      materialNo: string;
      drug: {
        id: string;
        nameEn: string;
        nameAr: string | null;
        priceWithTax: string | null;
      } | null;
    }[],
  ) => (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.materialNo} className="flex items-center justify-between gap-2 text-sm">
          {r.drug ? (
            <button
              className="text-start text-[#0b2545] underline-offset-2 hover:underline"
              onClick={() => onNavigate(r.drug!.id)}
            >
              {locale === 'ar' && r.drug.nameAr ? r.drug.nameAr : r.drug.nameEn}
            </button>
          ) : (
            <span className="text-gray-500" dir="ltr">
              {r.materialNo}
            </span>
          )}
          {r.drug?.priceWithTax != null && (
            <span className="text-xs text-gray-400" dir="ltr">
              {Number(r.drug.priceWithTax).toFixed(2)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{drug.nameEn}</h2>
          {drug.nameAr && (
            <div className="text-sm text-gray-600" dir="rtl">
              {drug.nameAr}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone={drug.coded ? 'green' : 'amber'}>
              {drug.coded ? t('dic.coded') : t('dic.notCoded')}
            </Badge>
            {drug.itemType && <Badge tone="blue">{pickName(locale, drug.itemType)}</Badge>}
            {drug.raqeeb && <Badge tone="red">{t('dic.raqeeb')}</Badge>}
            {drug.acuteChronic && <Badge tone="gray">{drug.acuteChronic}</Badge>}
          </div>
        </div>
        <Button variant="secondary" onClick={() => setPropose(true)}>
          {t('dic.propose')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label={t('dic.material')} value={drug.materialNo} dir="ltr" />
        <Field label={t('dic.brand')} value={drug.brand} />
        <Field label={t('dic.sfda')} value={drug.sfdaCode} dir="ltr" />
        <Field
          label={t('dic.price')}
          value={drug.price != null ? Number(drug.price).toFixed(2) : null}
          dir="ltr"
        />
        <Field
          label={t('dic.priceWithTax')}
          value={drug.priceWithTax != null ? Number(drug.priceWithTax).toFixed(2) : null}
          dir="ltr"
        />
        <Field
          label={t('dic.categoryLabel')}
          value={[drug.category, drug.subCategory].filter(Boolean).join(' / ') || null}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('dic.activeIngredient')} value={drug.activeIngredient} />
        <Field label={t('dic.usage')} value={drug.usage} />
        <Field label={t('dic.offers')} value={drug.offers} />
        <Field label={t('dic.note')} value={drug.note} />
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-gray-700">{t('dic.coverage')}</h3>
        {drug.coverages.length === 0 ? (
          <p className="text-sm text-gray-400">{t('dic.noCoverageData')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {drug.coverages.map((c) => (
              <Badge key={c.companyKey} tone={c.covered ? 'green' : 'red'}>
                {pickName(locale, c.company)}: {c.covered ? t('dic.covered') : t('dic.notCovered')}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-700">
            {t('dic.alternatives')} ({drug.alternatives.length})
          </h3>
          {drug.alternatives.length === 0 ? (
            <p className="text-sm text-gray-400">—</p>
          ) : (
            relatedList(drug.alternatives)
          )}
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-700">
            {t('dic.crossSell')} ({drug.crossSells.length})
          </h3>
          {drug.crossSells.length === 0 ? (
            <p className="text-sm text-gray-400">—</p>
          ) : (
            relatedList(drug.crossSells)
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-gray-700">{t('dic.availability')}</h3>
        {availability.length === 0 ? (
          <p className="text-sm text-gray-400">{t('dic.noAvailability')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {availability.map(([city, qty]) => (
              <Badge key={city} tone="blue">
                {city}: {qty}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {propose && <ProposeDialog drug={drug} onClose={() => setPropose(false)} />}
    </div>
  );
}

// ── §15.3 change requests (spec H8): propose → approve ────────────────

function ProposeDialog({ drug, onClose }: { drug: DrugCard; onClose: () => void }) {
  const t = useTranslations();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, (drug[f] as string | null) ?? ''])),
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = useMutation({
    mutationFn: () => {
      const patch: Record<string, unknown> = {};
      for (const f of EDITABLE_FIELDS) {
        const original = (drug[f] as string | null) ?? '';
        if (values[f] !== original) patch[f] = values[f] === '' ? null : values[f];
      }
      return api(`/dic/drugs/${drug.id}/change-request`, { method: 'POST', body: { patch } });
    },
    onSuccess: () => {
      setError(null);
      setDone(true);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  return (
    <Dialog open onClose={onClose} title={t('dic.proposeTitle')}>
      {done ? (
        <div className="space-y-3">
          <p className="text-sm text-green-700">{t('dic.proposed')}</p>
          <div className="flex justify-end">
            <Button onClick={onClose}>{t('common.close')}</Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <p className="text-sm text-gray-500">{t('dic.proposeHint')}</p>
          {error && <ErrorState message={error} />}
          {EDITABLE_FIELDS.map((f) => (
            <label key={f} className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">{t(`dic.${f}`)}</span>
              <textarea
                rows={2}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#0b2545] focus:ring-2 focus:ring-[#0b2545]/20"
                value={values[f]}
                onChange={(e) => setValues({ ...values, [f]: e.target.value })}
              />
            </label>
          ))}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={submit.isPending}>
              {t('dic.propose')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function ApprovalsTab() {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['dic-change-requests'],
    queryFn: () => api<ChangeRequestRow[]>('/dic/change-requests?status=PENDING'),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      api(`/dic/change-requests/${id}/decide`, {
        method: 'POST',
        body: { decision, note: note[id] || undefined },
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['dic-change-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['dic-drug'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <EmptyState message={t('dic.approvals.empty')} />;

  return (
    <div className="space-y-3">
      {error && <ErrorState message={error} />}
      {data.map((r) => (
        <div key={r.id} className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-medium text-gray-900">
                {locale === 'ar' && r.drug.nameAr ? r.drug.nameAr : r.drug.nameEn}
              </span>{' '}
              <span className="text-xs text-gray-400" dir="ltr">
                {r.drug.materialNo}
              </span>
            </div>
            <span className="text-xs text-gray-400">
              {new Date(r.createdAt).toLocaleString(locale)}
            </span>
          </div>
          <div className="mt-2 rounded bg-gray-50 p-2">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
              {t('dic.approvals.requested')}
            </div>
            <ul className="space-y-0.5 text-sm text-gray-700">
              {Object.entries(r.patch).map(([k, v]) => (
                <li key={k}>
                  <span className="font-medium">{k}</span>:{' '}
                  {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-[#0b2545]"
              placeholder={t('dic.approvals.note')}
              value={note[r.id] ?? ''}
              onChange={(e) => setNote({ ...note, [r.id]: e.target.value })}
            />
            <Button
              onClick={() => decide.mutate({ id: r.id, decision: 'approve' })}
              disabled={decide.isPending}
            >
              {t('dic.approvals.approve')}
            </Button>
            <Button
              variant="danger"
              onClick={() => decide.mutate({ id: r.id, decision: 'reject' })}
              disabled={decide.isPending}
            >
              {t('dic.approvals.reject')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── §15 master import: chunked upload of the Mapping export (H2) ──────

async function parseWorkbook(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  // The Mapping export splits Hospital-At-Home rows into a second sheet —
  // read every sheet so nothing is silently dropped (spec H1).
  return wb.SheetNames.flatMap((name) => {
    const sheet = wb.Sheets[name];
    return sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }) : [];
  });
}

function ImportDialog({ chunkSize, onClose }: { chunkSize: number; onClose: () => void }) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [totals, setTotals] = useState<{
    created: number;
    updated: number;
    invalid: number;
    missingArabicName: number;
    notCoded: number;
  } | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    const size = chunkSize > 0 ? chunkSize : 2000;
    const chunks: Record<string, unknown>[][] = [];
    for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
    setProgress({ done: 0, total: chunks.length });
    const sum = { created: 0, updated: 0, invalid: 0, missingArabicName: 0, notCoded: 0 };
    try {
      for (const [i, chunk] of chunks.entries()) {
        const res = await api<ImportChunkResult>('/dic/import', {
          method: 'POST',
          body: { fileName, rows: chunk },
        });
        sum.created += res.created;
        sum.updated += res.updated;
        sum.invalid += res.invalid.length;
        sum.missingArabicName += res.quality.missingArabicName;
        sum.notCoded += res.quality.notCoded;
        setProgress({ done: i + 1, total: chunks.length });
        setTotals({ ...sum });
      }
      void queryClient.invalidateQueries({ queryKey: ['dic-search'] });
      void queryClient.invalidateQueries({ queryKey: ['dic-drug'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.error'));
    } finally {
      setRunning(false);
    }
  }

  const finished = totals !== null && !running && progress.done === progress.total;

  return (
    <Dialog open onClose={() => !running && onClose()} title={t('dic.importTitle')} wide>
      <div className="space-y-3">
        <p className="text-sm text-gray-500">{t('dic.importHint')}</p>
        {error && <ErrorState message={error} />}
        {!running && totals === null && (
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="block w-full text-sm text-gray-600"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              void parseWorkbook(file)
                .then(setRows)
                .catch(() => setError(t('dic.parseError')));
            }}
          />
        )}
        {rows.length > 0 && totals === null && !running && (
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>{t('dic.rowsParsed', { count: rows.length })}</span>
            <Button onClick={() => void run()}>
              {t('dic.startImport', { count: rows.length })}
            </Button>
          </div>
        )}
        {progress.total > 0 && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-gray-500">
              <span>{t('dic.chunkProgress', { done: progress.done, total: progress.total })}</span>
              <span>{Math.round((progress.done / progress.total) * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-gray-100">
              <div
                className="h-full bg-[#0b2545] transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
        {totals && (
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="green">{t('dic.created', { count: totals.created })}</Badge>
            <Badge tone="blue">{t('dic.updated', { count: totals.updated })}</Badge>
            <Badge tone="red">{t('dic.invalidCount', { count: totals.invalid })}</Badge>
            <Badge tone="amber">
              {t('dic.qMissingArabic', { count: totals.missingArabicName })}
            </Badge>
            <Badge tone="amber">{t('dic.qNotCoded', { count: totals.notCoded })}</Badge>
          </div>
        )}
        {finished && (
          <div className="flex justify-end">
            <Button onClick={onClose}>{t('common.close')}</Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ── §15.3 per-company coverage import (spec H3) ───────────────────────

function CoverageDialog({
  companies,
  onClose,
}: {
  companies: { key: string; nameAr: string; nameEn: string }[];
  onClose: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [companyKey, setCompanyKey] = useState(companies[0]?.key ?? '');
  const [rows, setRows] = useState<{ material: string; covered: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ applied: number; rejected: unknown[] } | null>(null);

  async function parse(file: File) {
    const parsed = await parseWorkbook(file);
    const mapped: { material: string; covered: boolean }[] = [];
    for (const r of parsed) {
      const material = String(r['Material'] ?? r['CODE'] ?? Object.values(r)[0] ?? '').trim();
      if (!material) continue;
      const covered = String(r['Covered'] ?? 'yes')
        .trim()
        .toLowerCase();
      mapped.push({
        material,
        covered: !['no', 'not covered', 'false', '0'].includes(covered),
      });
    }
    return mapped;
  }

  const doImport = useMutation({
    mutationFn: async () => {
      // The API caps one call at 5000 rows — send larger files in slices.
      const sum = { applied: 0, rejected: [] as unknown[] };
      for (let i = 0; i < rows.length; i += 5000) {
        const res = await api<{ applied: number; rejected: unknown[] }>('/dic/coverage/import', {
          method: 'POST',
          body: { companyKey, rows: rows.slice(i, i + 5000) },
        });
        sum.applied += res.applied;
        sum.rejected.push(...res.rejected);
      }
      return sum;
    },
    onSuccess: (d) => {
      setError(null);
      setResult(d);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  return (
    <Dialog open onClose={onClose} title={t('dic.covImportTitle')}>
      <div className="space-y-3">
        <p className="text-sm text-gray-500">{t('dic.covImportHint')}</p>
        {error && <ErrorState message={error} />}
        {result ? (
          <>
            <p className="text-sm text-gray-700">
              {t('dic.covApplied', { applied: result.applied, rejected: result.rejected.length })}
            </p>
            <div className="flex justify-end">
              <Button onClick={onClose}>{t('common.close')}</Button>
            </div>
          </>
        ) : (
          <>
            <Select
              label={t('dic.coverageCompany')}
              value={companyKey}
              onChange={(e) => setCompanyKey(e.target.value)}
            >
              {companies.map((c) => (
                <option key={c.key} value={c.key}>
                  {pickName(locale, c)}
                </option>
              ))}
            </Select>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="block w-full text-sm text-gray-600"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void parse(file)
                  .then(setRows)
                  .catch(() => setError(t('dic.parseError')));
              }}
            />
            {rows.length > 0 && (
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>{t('dic.rowsParsed', { count: rows.length })}</span>
                <Button onClick={() => doImport.mutate()} disabled={doImport.isPending}>
                  {t('dic.covImportBtn')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
