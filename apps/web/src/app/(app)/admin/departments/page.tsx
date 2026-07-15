'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickName } from '@/lib/names';
import type { DepartmentRow, Page } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { Badge, Button, Dialog, ErrorState, Input } from '@/components/ui';

interface FormState {
  id?: string;
  code: string;
  nameAr: string;
  nameEn: string;
}

const EMPTY: FormState = { code: '', nameAr: '', nameEn: '' };

export default function DepartmentsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['departments', page],
    queryFn: () => api<Page<DepartmentRow>>(`/departments?page=${page}&pageSize=20`),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['departments'] });

  const save = useMutation({
    mutationFn: (f: FormState) =>
      f.id
        ? api(`/departments/${f.id}`, {
            method: 'PATCH',
            body: { nameAr: f.nameAr, nameEn: f.nameEn },
          })
        : api('/departments', { method: 'POST', body: f }),
    onSuccess: () => {
      setForm(null);
      setError(null);
      void invalidate();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api(`/departments/${id}`, { method: 'DELETE' }),
    onSuccess: () => void invalidate(),
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const canManage = hasPermission('department.manage');

  const columns = useMemo<ColumnDef<DepartmentRow, unknown>[]>(
    () => [
      { header: t('departments.code'), accessorKey: 'code' },
      { header: t('users.name'), cell: ({ row }) => pickName(locale, row.original) },
      {
        header: t('departments.teamsCount'),
        cell: ({ row }) => row.original._count?.teams ?? 0,
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
              cell: ({ row }: { row: { original: DepartmentRow } }) => (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setForm({ ...row.original })}>
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
            } as ColumnDef<DepartmentRow, unknown>,
          ]
        : []),
    ],
    [t, locale, canManage, archive],
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('departments.title')}</h1>
        {canManage && <Button onClick={() => setForm(EMPTY)}>{t('departments.create')}</Button>}
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
        title={form?.id ? t('common.edit') : t('departments.create')}
      >
        {form && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
          >
            {!form.id && (
              <Input
                label={t('departments.code')}
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
            <div className="flex justify-end gap-2">
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
    </div>
  );
}
