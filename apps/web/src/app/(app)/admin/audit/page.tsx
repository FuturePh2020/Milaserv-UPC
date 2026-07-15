'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import type { AuditRow, Page } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { Badge, Dialog, Input } from '@/components/ui';

export default function AuditPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', page, action, entityType],
    queryFn: () =>
      api<Page<AuditRow>>(
        `/audit?page=${page}&pageSize=25${action ? `&action=${encodeURIComponent(action)}` : ''}${
          entityType ? `&entityType=${encodeURIComponent(entityType)}` : ''
        }`,
      ),
  });

  const columns = useMemo<ColumnDef<AuditRow, unknown>[]>(
    () => [
      {
        header: t('audit.when'),
        cell: ({ row }) =>
          new Date(row.original.createdAt).toLocaleString(locale === 'ar' ? 'ar' : 'en'),
      },
      {
        header: t('audit.actor'),
        cell: ({ row }) =>
          row.original.actorEmail ?? <Badge tone="gray">{t('audit.system')}</Badge>,
      },
      {
        header: t('audit.action'),
        cell: ({ row }) => <code className="text-xs">{row.original.action}</code>,
      },
      {
        header: t('audit.entity'),
        cell: ({ row }) => (
          <span className="text-xs text-gray-600">
            {row.original.entityType}
            {row.original.entityId ? ` · ${row.original.entityId.slice(0, 10)}…` : ''}
          </span>
        ),
      },
      {
        id: 'details',
        header: t('audit.details'),
        cell: ({ row }) => (
          <button
            className="text-xs text-blue-700 underline"
            onClick={() => setDetail(row.original)}
          >
            {t('audit.details')}
          </button>
        ),
      },
    ],
    [t, locale],
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('audit.title')}</h1>
        <div className="flex gap-2">
          <Input
            placeholder={t('audit.filterAction')}
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          />
          <Input
            placeholder={t('audit.filterEntityType')}
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>
      <DataTable
        columns={columns}
        data={data?.items}
        isLoading={isLoading}
        total={data?.total}
        page={page}
        pageSize={25}
        onPageChange={setPage}
      />

      <Dialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.action ?? ''}
        wide
      >
        {detail && (
          <div className="flex flex-col gap-3 text-sm" dir="ltr">
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
              <div>
                <span className="font-medium">{t('audit.actor')}: </span>
                {detail.actorEmail ?? t('audit.system')}
              </div>
              <div>
                <span className="font-medium">IP: </span>
                {detail.ip ?? '—'}
              </div>
              <div>
                <span className="font-medium">{t('audit.entity')}: </span>
                {detail.entityType} {detail.entityId ?? ''}
              </div>
              <div>
                <span className="font-medium">{t('audit.when')}: </span>
                {new Date(detail.createdAt).toISOString()}
              </div>
            </div>
            {detail.before != null && (
              <div>
                <div className="mb-1 font-medium text-gray-700">before</div>
                <pre className="overflow-x-auto rounded-md bg-gray-50 p-3 text-xs">
                  {JSON.stringify(detail.before, null, 2)}
                </pre>
              </div>
            )}
            {detail.after != null && (
              <div>
                <div className="mb-1 font-medium text-gray-700">after</div>
                <pre className="overflow-x-auto rounded-md bg-gray-50 p-3 text-xs">
                  {JSON.stringify(detail.after, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
