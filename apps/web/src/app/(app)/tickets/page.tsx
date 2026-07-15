'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickName } from '@/lib/names';
import type { Page } from '@/lib/types';
import type { TicketCatalogs, TicketRow } from '@/lib/ticket-types';
import { DataTable } from '@/components/data-table';
import { Badge, Button, Input, Select } from '@/components/ui';

const VIEWS = [
  'my_tickets',
  'assigned_to_me',
  'all',
  'unassigned',
  'escalated',
  'critical',
  'branch_complaints',
  'closed_today',
] as const;

function slaTone(state: TicketRow['slaState']): 'gray' | 'green' | 'red' | 'blue' | 'amber' {
  switch (state) {
    case 'ON_TRACK':
      return 'green';
    case 'WARNING':
      return 'amber';
    case 'BREACHED':
      return 'red';
    case 'PAUSED':
      return 'gray';
    case 'MET':
      return 'blue';
  }
}

export default function TicketsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [view, setView] = useState<(typeof VIEWS)[number]>('my_tickets');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [statusId, setStatusId] = useState('');
  const [urgencyId, setUrgencyId] = useState('');

  const { data: catalogs } = useQuery({
    queryKey: ['ticket-config'],
    queryFn: () => api<TicketCatalogs>('/ticket-config'),
    staleTime: 300_000,
  });

  const query = useMemo(() => {
    const params = new URLSearchParams({ view, page: String(page), pageSize: '20' });
    if (q) params.set('q', q);
    if (statusId) params.set('statusId', statusId);
    if (urgencyId) params.set('urgencyId', urgencyId);
    return params.toString();
  }, [view, page, q, statusId, urgencyId]);

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', query],
    queryFn: () => api<Page<TicketRow>>(`/tickets?${query}`),
  });

  const columns = useMemo<ColumnDef<TicketRow, unknown>[]>(
    () => [
      {
        header: t('tickets.number'),
        cell: ({ row }) => (
          <Link
            href={`/tickets/${row.original.id}`}
            className="font-mono text-xs text-blue-700 underline"
          >
            {row.original.internalNumber}
          </Link>
        ),
      },
      {
        header: t('tickets.customer'),
        cell: ({ row }) => (
          <div>
            <div>{row.original.customerName}</div>
            <div className="text-xs text-gray-400" dir="ltr">
              {row.original.customerPhone}
            </div>
          </div>
        ),
      },
      { header: t('tickets.subject'), accessorKey: 'subject' },
      {
        header: t('tickets.category'),
        cell: ({ row }) =>
          `${pickName(locale, row.original.type)} · ${pickName(locale, row.original.category)}`,
      },
      {
        header: t('tickets.urgency'),
        cell: ({ row }) => (
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: row.original.urgency.color }}
          >
            {pickName(locale, row.original.urgency)}
          </span>
        ),
      },
      {
        header: t('tickets.status'),
        cell: ({ row }) => (
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: row.original.status.color }}
          >
            {pickName(locale, row.original.status)}
          </span>
        ),
      },
      {
        header: t('tickets.sla'),
        cell: ({ row }) => (
          <Badge tone={slaTone(row.original.slaState)}>
            {t(`tickets.slaStates.${row.original.slaState}`)}
          </Badge>
        ),
      },
      {
        header: t('tickets.responsible'),
        cell: ({ row }) =>
          row.original.responsible ? pickName(locale, row.original.responsible) : '—',
      },
    ],
    [t, locale],
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('tickets.title')}</h1>
        <div className="flex gap-2">
          {hasPermission('ticket.export') && (
            <Button
              variant="secondary"
              onClick={() =>
                window.open(
                  `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/tickets/export`,
                  '_blank',
                )
              }
            >
              {t('tickets.export')}
            </Button>
          )}
          {hasPermission('ticket.create') && (
            <Button onClick={() => router.push('/tickets/new')}>{t('tickets.create')}</Button>
          )}
        </div>
      </div>

      {/* Views (§9.10) */}
      <div className="mb-3 flex flex-wrap gap-1">
        {VIEWS.map((v) => (
          <button
            key={v}
            onClick={() => {
              setView(v);
              setPage(1);
            }}
            className={`rounded-full px-3 py-1 text-sm ${
              view === v
                ? 'bg-[#0b2545] font-medium text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t(`tickets.views.${v}`)}
          </button>
        ))}
      </div>

      {/* Filters (§9.11 core set; more available via API) */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          placeholder={t('common.search')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <Select
          value={statusId}
          onChange={(e) => {
            setStatusId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('tickets.status')} —</option>
          {catalogs?.statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {pickName(locale, s)}
            </option>
          ))}
        </Select>
        <Select
          value={urgencyId}
          onChange={(e) => {
            setUrgencyId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('tickets.urgency')} —</option>
          {catalogs?.urgencies.map((u) => (
            <option key={u.id} value={u.id}>
              {pickName(locale, u)}
            </option>
          ))}
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={data?.items}
        isLoading={isLoading}
        total={data?.total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
      />
    </div>
  );
}
