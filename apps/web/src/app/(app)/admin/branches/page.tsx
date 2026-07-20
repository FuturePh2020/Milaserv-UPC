'use client';

import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickName } from '@/lib/names';
import type { Page } from '@/lib/types';
import type { BranchRow } from '@/lib/ticket-types';
import { DataTable } from '@/components/data-table';
import { Badge, Button, Dialog, ErrorState, Input } from '@/components/ui';

interface FormState {
  id?: string;
  code: string;
  nameAr: string;
  nameEn: string;
  city: string;
  phone: string;
  supervisorName: string;
  supervisorEmail: string;
  supervisorPhone: string;
  areaManagerName: string;
  areaManagerEmail: string;
}

const EMPTY: FormState = {
  code: '',
  nameAr: '',
  nameEn: '',
  city: '',
  phone: '',
  supervisorName: '',
  supervisorEmail: '',
  supervisorPhone: '',
  areaManagerName: '',
  areaManagerEmail: '',
};

export default function BranchesPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['branches', page, search],
    queryFn: () =>
      api<Page<BranchRow>>(
        `/branches?page=${page}&pageSize=20${search ? `&q=${encodeURIComponent(search)}` : ''}`,
      ),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['branches'] });
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : t('common.error'));

  const save = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        nameAr: f.nameAr,
        nameEn: f.nameEn,
        city: f.city || undefined,
        phone: f.phone || undefined,
        supervisorName: f.supervisorName || undefined,
        supervisorEmail: f.supervisorEmail || undefined,
        supervisorPhone: f.supervisorPhone || undefined,
        areaManagerName: f.areaManagerName || undefined,
        areaManagerEmail: f.areaManagerEmail || undefined,
      };
      return f.id
        ? api(`/branches/${f.id}`, { method: 'PATCH', body })
        : api('/branches', { method: 'POST', body: { ...body, code: f.code } });
    },
    onSuccess: () => {
      setForm(null);
      setError(null);
      invalidate();
    },
    onError,
  });

  const archive = useMutation({
    mutationFn: (id: string) => api(`/branches/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError,
  });

  const canManage = hasPermission('branch.manage');

  const columns = useMemo<ColumnDef<BranchRow, unknown>[]>(
    () => [
      { header: t('branches.code'), accessorKey: 'code' },
      { header: t('users.name'), cell: ({ row }) => pickName(locale, row.original) },
      { header: t('branches.city'), cell: ({ row }) => row.original.city ?? '—' },
      { header: t('branches.region'), cell: ({ row }) => row.original.region ?? '—' },
      {
        header: t('branches.type'),
        cell: ({ row }) =>
          row.original.branchType ? (
            <Badge tone="blue">{pickName(locale, row.original.branchType)}</Badge>
          ) : (
            '—'
          ),
      },
      {
        header: t('branches.supervisorName'),
        cell: ({ row }) => row.original.supervisorName ?? <Badge tone="amber">—</Badge>,
      },
      {
        header: t('common.status'),
        cell: ({ row }) => (
          <Badge tone={row.original.status === 'ACTIVE' ? 'green' : 'red'}>
            {row.original.status === 'ACTIVE' ? t('common.active') : t('common.inactive')}
          </Badge>
        ),
      },
      ...(canManage
        ? [
            {
              id: 'actions',
              header: t('common.actions'),
              cell: ({ row }: { row: { original: BranchRow } }) => (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setForm({
                        id: row.original.id,
                        code: row.original.code,
                        nameAr: row.original.nameAr,
                        nameEn: row.original.nameEn,
                        city: row.original.city ?? '',
                        phone: row.original.phone ?? '',
                        supervisorName: row.original.supervisorName ?? '',
                        supervisorEmail: row.original.supervisorEmail ?? '',
                        supervisorPhone: row.original.supervisorPhone ?? '',
                        areaManagerName: row.original.areaManagerName ?? '',
                        areaManagerEmail: row.original.areaManagerEmail ?? '',
                      })
                    }
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      window.confirm(t('common.confirmArchive')) && archive.mutate(row.original.id)
                    }
                  >
                    {t('common.archive')}
                  </Button>
                </div>
              ),
            } as ColumnDef<BranchRow, unknown>,
          ]
        : []),
    ],
    [t, locale, canManage, archive],
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('branches.title')}</h1>
        <div className="flex items-center gap-3">
          <Input
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {canManage && (
            <Button variant="secondary" onClick={() => setShowImport(true)}>
              {t('branches.importBtn')}
            </Button>
          )}
          {canManage && <Button onClick={() => setForm(EMPTY)}>{t('branches.create')}</Button>}
        </div>
      </div>
      {error && <ErrorState message={error} />}
      <DataTable
        columns={columns}
        data={data?.items}
        isLoading={isLoading}
        total={data?.total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
      />

      <Dialog
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? t('common.edit') : t('branches.create')}
        wide
      >
        {form && (
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
          >
            {!form.id && (
              <Input
                label={t('branches.code')}
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
            )}
            <Input
              label={t('common.nameAr')}
              required
              dir="rtl"
              value={form.nameAr}
              onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
            />
            <Input
              label={t('common.nameEn')}
              required
              dir="ltr"
              value={form.nameEn}
              onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
            />
            <Input
              label={t('branches.city')}
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
            <Input
              label={t('branches.phone')}
              dir="ltr"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <Input
              label={t('branches.supervisorName')}
              value={form.supervisorName}
              onChange={(e) => setForm({ ...form, supervisorName: e.target.value })}
            />
            <Input
              label={t('branches.supervisorEmail')}
              type="email"
              dir="ltr"
              value={form.supervisorEmail}
              onChange={(e) => setForm({ ...form, supervisorEmail: e.target.value })}
            />
            <Input
              label={t('branches.supervisorPhone')}
              dir="ltr"
              value={form.supervisorPhone}
              onChange={(e) => setForm({ ...form, supervisorPhone: e.target.value })}
            />
            <Input
              label={t('branches.areaManagerName')}
              value={form.areaManagerName}
              onChange={(e) => setForm({ ...form, areaManagerName: e.target.value })}
            />
            <Input
              label={t('branches.areaManagerEmail')}
              type="email"
              dir="ltr"
              value={form.areaManagerEmail}
              onChange={(e) => setForm({ ...form, areaManagerEmail: e.target.value })}
            />
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onImported={() => {
            invalidate();
          }}
        />
      )}
    </div>
  );
}

// ── §16.1 master-data import (United Locations format, spec G2/G3) ────

interface PreviewCounts {
  valid: number;
  invalid: number;
  willCreate: number;
  willUpdate: number;
  missingLocation: number;
  missingSupervisor: number;
  unmappedType: number;
}

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const t = useTranslations();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [preview, setPreview] = useState<PreviewCounts | null>(null);
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    invalid: unknown[];
  } | null>(null);

  async function parseFile(file: File) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer());
    const sheet = wb.Sheets[wb.SheetNames[0]!];
    if (!sheet) throw new Error('empty');
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  }

  const doPreview = useMutation({
    mutationFn: () =>
      api<{ counts: PreviewCounts }>('/branches/import/preview', {
        method: 'POST',
        body: { fileName, rows },
      }),
    onSuccess: (d) => {
      setError(null);
      setPreview(d.counts);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const doImport = useMutation({
    mutationFn: () =>
      api<{ created: number; updated: number; invalid: unknown[] }>('/branches/import', {
        method: 'POST',
        body: { fileName, rows },
      }),
    onSuccess: (d) => {
      setError(null);
      setResult(d);
      onImported();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  return (
    <Dialog open onClose={onClose} title={t('branches.importTitle')} wide>
      {error && <ErrorState message={error} />}
      {result ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            {t('branches.importDone', {
              created: result.created,
              updated: result.updated,
              invalid: result.invalid.length,
            })}
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>{t('common.close')}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">{t('branches.importHint')}</p>
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
              <Button onClick={() => doPreview.mutate()} disabled={doPreview.isPending}>
                {t('crm.previewBtn')}
              </Button>
            </div>
          )}
          {preview && (
            <>
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge tone="green">
                  {t('branches.willCreate', { count: preview.willCreate })}
                </Badge>
                <Badge tone="blue">{t('branches.willUpdate', { count: preview.willUpdate })}</Badge>
                <Badge tone="red">{t('crm.invalidCount', { count: preview.invalid })}</Badge>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge tone="amber">
                  {t('branches.qMissingLocation', { count: preview.missingLocation })}
                </Badge>
                <Badge tone="amber">
                  {t('branches.qMissingSupervisor', { count: preview.missingSupervisor })}
                </Badge>
                <Badge tone="amber">
                  {t('branches.qUnmappedType', { count: preview.unmappedType })}
                </Badge>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() => doImport.mutate()}
                  disabled={doImport.isPending || preview.valid === 0}
                >
                  {t('branches.importConfirm', { count: preview.valid })}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
