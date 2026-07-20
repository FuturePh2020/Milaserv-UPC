'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiDownload, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { parseWorkbookRows } from '@/lib/xlsx-parse';
import type { ImportBatch, ImportRow } from '@/lib/dic-types';
import { Badge, Button, Dialog, EmptyState, ErrorState, Select, Spinner } from '@/components/ui';

const IMPORTABLE_FIELDS = [
  'materialNo',
  'nameEn',
  'nameAr',
  'brand',
  'barcode',
  'strengthText',
  'activeIngredient',
  'manufacturerName',
  'dosageFormCode',
] as const;

const RESOLUTIONS = ['CREATE_NEW', 'LINK_EXISTING', 'MERGE', 'REJECT_ROW', 'DEFER_REVIEW'] as const;

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = {
  UPLOADED: 'gray',
  MAPPING: 'gray',
  VALIDATING: 'amber',
  VALIDATED: 'amber',
  APPROVED: 'blue',
  EXECUTING: 'amber',
  COMPLETED: 'green',
  FAILED: 'red',
  ROLLED_BACK: 'red',
};

/** dic.import_staged staged-import center (design doc §7/§20/§21):
 *  upload → map → validate (dry run + duplicate detection) → resolve →
 *  approve → execute → (dic.admin) rollback. */
export function ImportTab() {
  const t = useTranslations();
  const { hasPermission } = useAuth();
  const [showWizard, setShowWizard] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: batches, isLoading } = useQuery({
    queryKey: ['dic-import-batches'],
    queryFn: () => api<ImportBatch[]>('/dic/import/staged/batches'),
  });

  const rollback = useMutation({
    mutationFn: (id: string) =>
      api(`/dic/import/staged/batches/${id}/rollback`, { method: 'POST', body: {} }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['dic-import-batches'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        {hasPermission('dic.import_staged') && (
          <Button
            onClick={() => {
              setActiveBatchId(null);
              setShowWizard(true);
            }}
          >
            {t('dic.import2.newBtn')}
          </Button>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : !batches || batches.length === 0 ? (
        <EmptyState message={t('dic.import2.empty')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-start">{t('dic.import2.fileName')}</th>
                <th className="px-3 py-2 text-start">{t('dic.import2.status')}</th>
                <th className="px-3 py-2 text-start">{t('dic.import2.counts')}</th>
                <th className="px-3 py-2 text-start">{t('dic.import2.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2 text-gray-900">{b.fileName}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[b.status] ?? 'gray'}>{b.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {t('dic.import2.countsLine', {
                      total: b.totalRows,
                      valid: b.validRows,
                      invalid: b.invalidRows,
                      dup: b.duplicateRows,
                      imported: b.importedRows,
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {b.status !== 'COMPLETED' && b.status !== 'ROLLED_BACK' && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setActiveBatchId(b.id);
                            setShowWizard(true);
                          }}
                        >
                          {t('dic.import2.continue')}
                        </Button>
                      )}
                      {(b.invalidRows > 0 || b.failedRows > 0) && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            void apiDownload(
                              `/dic/import/staged/batches/${b.id}/error-report.csv`,
                              `${b.fileName}-errors.csv`,
                            )
                          }
                        >
                          {t('dic.import2.errorReport')}
                        </Button>
                      )}
                      {b.status === 'COMPLETED' && hasPermission('dic.admin') && (
                        <Button
                          variant="danger"
                          onClick={() => rollback.mutate(b.id)}
                          disabled={rollback.isPending}
                        >
                          {t('dic.import2.rollback')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showWizard && <ImportWizard batchId={activeBatchId} onClose={() => setShowWizard(false)} />}
    </div>
  );
}

function ImportWizard({ batchId, onClose }: { batchId: string | null; onClose: () => void }) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [id, setId] = useState<string | null>(batchId);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data: batch, refetch } = useQuery({
    queryKey: ['dic-import-batch', id],
    queryFn: () => api<ImportBatch>(`/dic/import/staged/batches/${id}`),
    enabled: id !== null,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['dic-import-batches'] });
    void refetch();
  };

  const upload = useMutation({
    mutationFn: () =>
      api<ImportBatch>('/dic/import/staged/batches', { method: 'POST', body: { fileName, rows } }),
    onSuccess: (b) => {
      setError(null);
      setId(b.id);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const saveMapping = useMutation({
    mutationFn: () =>
      api(`/dic/import/staged/batches/${id}/mapping`, { method: 'PATCH', body: { mapping } }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const validate = useMutation({
    mutationFn: () =>
      api(`/dic/import/staged/batches/${id}/validate`, { method: 'POST', body: {} }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const approve = useMutation({
    mutationFn: () => api(`/dic/import/staged/batches/${id}/approve`, { method: 'POST', body: {} }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const execute = useMutation({
    mutationFn: () => api(`/dic/import/staged/batches/${id}/execute`, { method: 'POST', body: {} }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const headers = rows.length > 0 ? Object.keys(rows[0] ?? {}) : [];

  return (
    <Dialog open onClose={onClose} title={t('dic.import2.wizardTitle')} wide>
      <div className="space-y-4">
        {error && <ErrorState message={error} />}

        {!batch && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">{t('dic.import2.uploadHint')}</p>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="block w-full text-sm text-gray-600"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                void parseWorkbookRows(file)
                  .then(setRows)
                  .catch(() => setError(t('dic.parseError')));
              }}
            />
            {rows.length > 0 && (
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>{t('dic.rowsParsed', { count: rows.length })}</span>
                <Button onClick={() => upload.mutate()} disabled={upload.isPending}>
                  {t('dic.import2.uploadBtn')}
                </Button>
              </div>
            )}
          </div>
        )}

        {batch && (batch.status === 'UPLOADED' || batch.status === 'MAPPING') && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">{t('dic.import2.mappingHint')}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(headers.length > 0 ? headers : Object.keys(batch.mappingJson ?? {})).map((h) => (
                <div key={h} className="flex items-center gap-2">
                  <span className="w-32 truncate text-xs text-gray-500" title={h}>
                    {h}
                  </span>
                  <Select
                    value={mapping[h] ?? batch.mappingJson?.[h] ?? ''}
                    onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                    className="flex-1"
                  >
                    <option value="">{t('dic.import2.ignore')}</option>
                    {IMPORTABLE_FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {t(`dic.import2.field.${f}`)}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button onClick={() => saveMapping.mutate()} disabled={saveMapping.isPending}>
                {t('dic.import2.saveMapping')}
              </Button>
            </div>
          </div>
        )}

        {batch && batch.status === 'MAPPING' && batch.mappingJson && (
          <div className="flex justify-end">
            <Button onClick={() => validate.mutate()} disabled={validate.isPending}>
              {t('dic.import2.runValidation')}
            </Button>
          </div>
        )}

        {batch && batch.status === 'VALIDATED' && (
          <ValidatedPanel
            batch={batch}
            onResolved={invalidate}
            onApprove={() => approve.mutate()}
            approving={approve.isPending}
          />
        )}

        {batch && batch.status === 'APPROVED' && (
          <div className="flex justify-end">
            <Button onClick={() => execute.mutate()} disabled={execute.isPending}>
              {t('dic.import2.executeBtn')}
            </Button>
          </div>
        )}

        {batch && ['EXECUTING'].includes(batch.status) && <Spinner />}

        {batch && ['COMPLETED', 'FAILED', 'ROLLED_BACK'].includes(batch.status) && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="green">{t('dic.import2.imported', { count: batch.importedRows })}</Badge>
              <Badge tone="red">{t('dic.import2.failed', { count: batch.failedRows })}</Badge>
              <Badge tone="amber">{t('dic.import2.skipped', { count: batch.invalidRows })}</Badge>
            </div>
            <div className="flex justify-end">
              <Button onClick={onClose}>{t('common.close')}</Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ValidatedPanel({
  batch,
  onResolved,
  onApprove,
  approving,
}: {
  batch: ImportBatch;
  onResolved: () => void;
  onApprove: () => void;
  approving: boolean;
}) {
  const t = useTranslations();

  const { data: duplicates, isLoading } = useQuery({
    queryKey: ['dic-import-preview', batch.id, 'DUPLICATE'],
    queryFn: () =>
      api<ImportRow[]>(`/dic/import/staged/batches/${batch.id}/preview?status=DUPLICATE`),
  });

  const resolve = useMutation({
    mutationFn: ({
      rowId,
      resolution,
      linkedDrugId,
    }: {
      rowId: string;
      resolution: string;
      linkedDrugId?: string;
    }) =>
      api(`/dic/import/staged/rows/${rowId}/resolve`, {
        method: 'PATCH',
        body: { resolution, linkedDrugId },
      }),
    onSuccess: onResolved,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone="green">{t('dic.import2.valid', { count: batch.validRows })}</Badge>
        <Badge tone="red">{t('dic.import2.invalid', { count: batch.invalidRows })}</Badge>
        <Badge tone="amber">{t('dic.import2.duplicate', { count: batch.duplicateRows })}</Badge>
      </div>

      {isLoading ? (
        <Spinner />
      ) : duplicates && duplicates.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">{t('dic.import2.resolveHint')}</p>
          {duplicates.map((row) => (
            <div key={row.id} className="rounded-lg border border-gray-200 p-3">
              <div className="mb-1 text-sm text-gray-900">
                {row.normalizedDataJson?.nameEn} (
                <span dir="ltr">{row.normalizedDataJson?.materialNo}</span>)
              </div>
              {row.duplicateCandidatesJson && row.duplicateCandidatesJson.length > 0 && (
                <ul className="mb-2 space-y-0.5 text-xs text-gray-500">
                  {row.duplicateCandidatesJson.map((c) => (
                    <li key={c.drugId}>
                      {c.nameEn} — <span dir="ltr">{c.materialNo}</span> (
                      {t('dic.import2.matchScore', { score: c.score })})
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  disabled={!!row.resolution}
                  defaultValue=""
                  onChange={(e) =>
                    resolve.mutate({
                      rowId: row.id,
                      resolution: e.target.value,
                      linkedDrugId: row.duplicateCandidatesJson?.[0]?.drugId,
                    })
                  }
                  className="w-56"
                >
                  <option value="" disabled>
                    {row.resolution ?? t('dic.import2.chooseResolution')}
                  </option>
                  {RESOLUTIONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`dic.import2.resolution.${r}`)}
                    </option>
                  ))}
                </Select>
                {row.resolution && <Badge tone="blue">{row.resolution}</Badge>}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={onApprove} disabled={approving}>
          {t('dic.import2.approveBtn')}
        </Button>
      </div>
    </div>
  );
}
