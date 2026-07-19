'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Page } from '@/lib/types';
import type { PrescriptionListItem } from '@/lib/prescription-types';
import { DataTable } from '@/components/data-table';
import { Badge, Button, Select } from '@/components/ui';

const STATUS_TONES: Record<string, 'gray' | 'blue' | 'amber' | 'green' | 'red'> = {
  UPLOADED: 'gray',
  EXTRACTING: 'blue',
  REVIEW: 'amber',
  CONFIRMED: 'green',
  REJECTED: 'red',
};

/** CR-001 Sprint OCR-02 Extension — the CR-001 intake list, distinct from
 * the legacy Phase 10 /ocr screen. Entry point into upload + the
 * preview/crop workspace on the detail page. */
export default function PrescriptionsIntakePage() {
  const t = useTranslations();
  const { hasPermission } = useAuth();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const canUpload = hasPermission('ocr.upload');

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) params.set('status', status);
    return params.toString();
  }, [status, page]);

  const { data, isLoading } = useQuery({
    queryKey: ['prescriptions-intake-list', query],
    queryFn: () => api<Page<PrescriptionListItem>>(`/prescriptions?${query}`),
  });

  const columns = useMemo<ColumnDef<PrescriptionListItem, unknown>[]>(
    () => [
      {
        header: t('ocr.intake.number'),
        cell: ({ row }) => (
          <Link
            href={`/prescriptions/${row.original.id}`}
            className="font-mono text-xs text-blue-700 underline"
            dir="ltr"
          >
            {row.original.number}
          </Link>
        ),
      },
      {
        header: t('ocr.intake.statusHeader'),
        cell: ({ row }) => (
          <Badge tone={STATUS_TONES[row.original.status] ?? 'gray'}>
            {t(`ocr.status.${row.original.status}`)}
          </Badge>
        ),
      },
      {
        header: t('ocr.intake.pages'),
        cell: ({ row }) => row.original._count.pages,
      },
      {
        header: t('ocr.intake.candidates'),
        cell: ({ row }) => row.original._count.drugCandidates,
      },
      {
        header: t('ocr.intake.note'),
        cell: ({ row }) => row.original.note ?? '—',
      },
      {
        header: t('ocr.intake.createdAt'),
        cell: ({ row }) => (
          <span dir="ltr" className="text-gray-500">
            {new Date(row.original.createdAt).toLocaleString()}
          </span>
        ),
      },
    ],
    [t],
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('ocr.intake.title')}</h1>
        <div className="flex items-center gap-2">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-44"
          >
            <option value="">{t('ocr.allStatuses')}</option>
            {(['UPLOADED', 'EXTRACTING', 'REVIEW', 'CONFIRMED', 'REJECTED'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`ocr.status.${s}`)}
              </option>
            ))}
          </Select>
          {canUpload && (
            <Link href="/prescriptions/new">
              <Button>{t('ocr.intake.newBtn')}</Button>
            </Link>
          )}
        </div>
      </div>
      <DataTable
        columns={columns}
        data={data?.items}
        isLoading={isLoading}
        total={data?.total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
      />
    </div>
  );
}
