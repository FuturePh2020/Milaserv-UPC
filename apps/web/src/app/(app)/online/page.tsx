'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { pickName } from '@/lib/names';
import type { Page } from '@/lib/types';
import type { OnlineOrderRow, OnlineStats } from '@/lib/online-types';
import { Badge, EmptyState, Input, Select, Spinner } from '@/components/ui';

export default function OnlinePage() {
  const t = useTranslations();
  const locale = useLocale();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sourceKey, setSourceKey] = useState('');
  const [q, setQ] = useState('');

  const { data: stats } = useQuery({
    queryKey: ['online-stats', date],
    queryFn: () => api<OnlineStats>(`/online/stats?date=${date}`),
  });
  const { data: catalogs } = useQuery({
    queryKey: ['online-catalogs'],
    queryFn: () =>
      api<{ orderSources: { key: string; nameAr: string; nameEn: string }[] }>('/online/catalogs'),
  });
  const { data: orders, isLoading } = useQuery({
    queryKey: ['online-orders', date, sourceKey, q],
    queryFn: () =>
      api<Page<OnlineOrderRow>>(
        `/online/orders?page=1&pageSize=50&from=${date}&to=${date}${sourceKey ? `&sourceKey=${sourceKey}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
  });

  return (
    <div className="max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('online.title')}</h1>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {/* §13 day counters */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={t('online.dailyOrders')} value={stats?.dailyOrders} />
        <Stat label={t('online.openIssues')} value={stats?.issues.open} />
        <Stat label={t('online.handledIssues')} value={stats?.issues.handledToday} />
        <Stat label={t('online.openRequests')} value={stats?.requests.open} />
        <Stat label={t('online.handledRequests')} value={stats?.requests.handledToday} />
        <div className="rounded-md border border-gray-200 bg-white p-3">
          <div className="text-xs text-gray-500">{t('online.slaAchievement')}</div>
          <div
            className={`text-xl font-bold ${
              stats?.slaAchievementPct !== null &&
              stats?.slaAchievementPct !== undefined &&
              stats.slaAchievementPct < 100
                ? 'text-red-600'
                : 'text-gray-900'
            }`}
          >
            {stats?.slaAchievementPct ?? '—'}
            {stats?.slaAchievementPct !== null && '%'}
          </div>
          <div className="text-xs text-gray-400">
            {t('online.avgHandling')}: {stats?.avgHandlingMinutes ?? '—'} {t('online.min')}
          </div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3">
          <Select value={sourceKey} onChange={(e) => setSourceKey(e.target.value)} className="w-48">
            <option value="">{t('online.allSources')}</option>
            {catalogs?.orderSources.map((s) => (
              <option key={s.key} value={s.key}>
                {pickName(locale, s)}
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
        <div className="flex gap-2 text-sm">
          <Link href="/tickets?view=all" className="text-blue-700 underline">
            {t('online.viewIssueTickets')}
          </Link>
          <Link href="/tickets/new" className="text-blue-700 underline">
            {t('online.newIssue')}
          </Link>
        </div>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white">
        {isLoading || !orders ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : orders.items.length === 0 ? (
          <EmptyState message={t('online.noOrders')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-start">{t('online.orderNumber')}</th>
                  <th className="px-4 py-2 text-start">{t('online.source')}</th>
                  <th className="px-4 py-2 text-start">{t('online.customer')}</th>
                  <th className="px-4 py-2 text-start">{t('online.value')}</th>
                  <th className="px-4 py-2 text-start">{t('online.orderedAt')}</th>
                  <th className="px-4 py-2 text-start">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.items.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2 font-mono text-xs">{o.externalNumber}</td>
                    <td className="px-4 py-2">
                      <Badge tone="blue">{pickName(locale, o.orderSource)}</Badge>
                    </td>
                    <td className="px-4 py-2">{o.customerName ?? '—'}</td>
                    <td className="px-4 py-2 tabular-nums">{o.value ? Number(o.value) : '—'}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {new Date(o.orderedAt).toLocaleString(locale === 'ar' ? 'ar' : 'en')}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">{o.externalStatus ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900">{value ?? '—'}</div>
    </div>
  );
}
