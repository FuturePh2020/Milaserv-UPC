'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { Page } from '@/lib/types';
import type {
  IntegrationHealth,
  IntegrationOperationRow,
  IntegrationOpStatus,
} from '@/lib/online-types';
import { Badge, Button, EmptyState, ErrorState, Select, Spinner } from '@/components/ui';

const STATUS_TONES: Record<IntegrationOpStatus, 'blue' | 'green' | 'amber' | 'red'> = {
  PENDING: 'blue',
  SUCCEEDED: 'green',
  FAILED: 'amber',
  DEAD: 'red',
};

/** §13 Integration Monitor. */
export default function IntegrationsMonitorPage() {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: monitor } = useQuery({
    queryKey: ['integration-monitor'],
    queryFn: () => api<{ integrations: IntegrationHealth[] }>('/integrations/monitor'),
    refetchInterval: 15000,
  });
  const { data: ops, isLoading } = useQuery({
    queryKey: ['integration-ops', status],
    queryFn: () =>
      api<Page<IntegrationOperationRow>>(
        `/integrations/operations?page=1&pageSize=50${status ? `&status=${status}` : ''}`,
      ),
    refetchInterval: 15000,
  });

  const retry = useMutation({
    mutationFn: (id: string) =>
      api(`/integrations/operations/${id}/retry`, { method: 'POST', body: {} }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['integration-ops'] });
      void queryClient.invalidateQueries({ queryKey: ['integration-monitor'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  return (
    <div className="max-w-5xl">
      <h1 className="mb-4 text-2xl font-bold text-gray-900">{t('integrations.title')}</h1>
      {error && <ErrorState message={error} />}

      {!monitor ? (
        <Spinner />
      ) : monitor.integrations.length === 0 ? (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white">
          <EmptyState message={t('integrations.noneYet')} />
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {monitor.integrations.map((x) => (
            <div key={x.integrationKey} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold text-gray-800">{x.integrationKey}</span>
                <Badge tone={(x.counts.DEAD ?? 0) > 0 ? 'red' : 'green'}>
                  {(x.counts.DEAD ?? 0) > 0
                    ? t('integrations.unhealthy')
                    : t('integrations.healthy')}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {(['PENDING', 'SUCCEEDED', 'FAILED', 'DEAD'] as const).map((s) => (
                  <Badge key={s} tone={STATUS_TONES[s]}>
                    {t(`integrations.states.${s}`)}: {x.counts[s] ?? 0}
                  </Badge>
                ))}
              </div>
              {x.lastError && (
                <p className="mt-2 truncate text-xs text-red-600" title={x.lastError}>
                  {x.lastError}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mb-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">
            {t('common.status')}: {t('crm.all')}
          </option>
          {(['PENDING', 'SUCCEEDED', 'FAILED', 'DEAD'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`integrations.states.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white">
        {isLoading || !ops ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : ops.items.length === 0 ? (
          <EmptyState message={t('common.empty')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-start">{t('integrations.integration')}</th>
                  <th className="px-4 py-2 text-start">{t('integrations.operation')}</th>
                  <th className="px-4 py-2 text-start">{t('common.status')}</th>
                  <th className="px-4 py-2 text-start">{t('integrations.attempts')}</th>
                  <th className="px-4 py-2 text-start">{t('integrations.lastError')}</th>
                  <th className="px-4 py-2 text-start">{t('integrations.createdAt')}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ops.items.map((op) => (
                  <tr key={op.id}>
                    <td className="px-4 py-2">{op.integrationKey}</td>
                    <td className="px-4 py-2 font-mono text-xs">{op.operation}</td>
                    <td className="px-4 py-2">
                      <Badge tone={STATUS_TONES[op.status]}>
                        {t(`integrations.states.${op.status}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{op.attempts}</td>
                    <td
                      className="max-w-56 truncate px-4 py-2 text-xs text-gray-500"
                      title={op.lastError ?? ''}
                    >
                      {op.lastError ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {new Date(op.createdAt).toLocaleString(locale === 'ar' ? 'ar' : 'en')}
                    </td>
                    <td className="px-4 py-2 text-end">
                      {(op.status === 'FAILED' || op.status === 'DEAD') && (
                        <Button
                          variant="secondary"
                          disabled={retry.isPending}
                          onClick={() => retry.mutate(op.id)}
                        >
                          {t('integrations.retry')}
                        </Button>
                      )}
                    </td>
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
