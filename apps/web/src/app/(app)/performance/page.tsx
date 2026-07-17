'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickName } from '@/lib/names';
import type { Page, UserRow, TeamRow } from '@/lib/types';
import type {
  DashboardResponse,
  MetricDef,
  PerfColor,
  PerfTrend,
  TargetPeriod,
  TargetRow,
} from '@/lib/performance-types';
import {
  Badge,
  Button,
  Dialog,
  Input,
  Select,
  Spinner,
  EmptyState,
  ErrorState,
} from '@/components/ui';

const COLOR_TONES: Record<PerfColor, 'green' | 'amber' | 'red' | 'gray'> = {
  GREEN: 'green',
  AMBER: 'amber',
  RED: 'red',
  GRAY: 'gray',
};

function TrendMark({ trend }: { trend: PerfTrend }) {
  if (!trend) return <span className="text-gray-300">—</span>;
  const glyph = trend === 'UP' ? '▲' : trend === 'DOWN' ? '▼' : '◆';
  const tone =
    trend === 'UP' ? 'text-green-600' : trend === 'DOWN' ? 'text-red-600' : 'text-gray-400';
  return <span className={tone}>{glyph}</span>;
}

function fmtValue(value: number | null, unit: string) {
  if (value === null) return '—';
  if (unit === 'percent') return `${value}%`;
  if (unit === 'seconds') {
    const m = Math.floor(value / 60);
    const s = Math.round(value % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return String(value);
}

export default function PerformancePage() {
  const t = useTranslations();
  const locale = useLocale();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<TargetPeriod>('DAILY');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [metricKey, setMetricKey] = useState('');
  const [showTargets, setShowTargets] = useState(false);

  const canManage = hasPermission('performance.manage');

  const { data: defs } = useQuery({
    queryKey: ['perf-defs'],
    queryFn: () => api<MetricDef[]>('/performance/metric-defs'),
  });

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['perf-dashboard', period, date, metricKey],
    queryFn: () =>
      api<DashboardResponse>(
        `/performance/dashboard?period=${period}&date=${date}${metricKey ? `&metricKey=${metricKey}` : ''}`,
      ),
  });

  return (
    <div className="max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('performance.title')}</h1>
        {canManage && (
          <Button variant="secondary" onClick={() => setShowTargets(true)}>
            {t('performance.manageTargets')}
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label={t('performance.period')}
          value={period}
          onChange={(e) => setPeriod(e.target.value as TargetPeriod)}
          className="w-40"
        >
          {(['DAILY', 'MONTHLY', 'YEARLY'] as const).map((p) => (
            <option key={p} value={p}>
              {t(`performance.periods.${p}`)}
            </option>
          ))}
        </Select>
        <Input
          label={t('performance.date')}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-44"
        />
        <Select
          label={t('performance.metric')}
          value={metricKey}
          onChange={(e) => setMetricKey(e.target.value)}
          className="w-64"
        >
          <option value="">{t('performance.allMetrics')}</option>
          {defs?.map((d) => (
            <option key={d.key} value={d.key}>
              {pickName(locale, d)}
            </option>
          ))}
        </Select>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white">
        {isLoading || !dashboard ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : dashboard.rows.length === 0 ? (
          <EmptyState message={t('performance.empty')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-start">{t('users.name')}</th>
                  <th className="px-4 py-2 text-start">{t('performance.metric')}</th>
                  <th className="px-4 py-2 text-start">{t('performance.actual')}</th>
                  <th className="px-4 py-2 text-start">{t('performance.target')}</th>
                  <th className="px-4 py-2 text-start">{t('performance.achievement')}</th>
                  <th className="px-4 py-2 text-start">{t('performance.trend')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {dashboard.rows.map((r) => (
                  <tr key={`${r.scopeType}-${r.scope.id}-${r.metric.key}`}>
                    <td className="px-4 py-2">
                      {pickName(locale, r.scope)}{' '}
                      {r.scopeType === 'TEAM' && (
                        <span className="text-xs text-gray-400">({t('nav.teams')})</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{pickName(locale, r.metric)}</td>
                    <td className="px-4 py-2 font-medium tabular-nums">
                      {fmtValue(r.actual, r.metric.unit)}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-gray-500">
                      {fmtValue(r.target, r.metric.unit)}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={COLOR_TONES[r.color]}>
                        {r.achievementPct === null ? '—' : `${r.achievementPct}%`}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <TrendMark trend={r.trend} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage && showTargets && defs && (
        <TargetsDialog
          defs={defs}
          onClose={() => setShowTargets(false)}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ['perf-dashboard'] })}
        />
      )}
    </div>
  );
}

function TargetsDialog({
  defs,
  onClose,
  onChanged,
}: {
  defs: MetricDef[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [scopeType, setScopeType] = useState<'USER' | 'TEAM'>('USER');
  const [scopeId, setScopeId] = useState('');
  const [metricKey, setMetricKey] = useState('inbound_calls');
  const [period, setPeriod] = useState<TargetPeriod>('DAILY');
  const [value, setValue] = useState('');

  const { data: targets } = useQuery({
    queryKey: ['perf-targets'],
    queryFn: () => api<TargetRow[]>('/performance/targets'),
  });
  const { data: users } = useQuery({
    queryKey: ['perf-users'],
    queryFn: () => api<Page<UserRow>>('/users?page=1&pageSize=100&status=ACTIVE'),
    enabled: scopeType === 'USER',
  });
  const { data: teams } = useQuery({
    queryKey: ['perf-teams'],
    queryFn: () => api<TeamRow[]>('/teams'),
    enabled: scopeType === 'TEAM',
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['perf-targets'] });
    onChanged();
  };

  const save = useMutation({
    mutationFn: () =>
      api('/performance/targets', {
        method: 'POST',
        body: { scopeType, scopeId, metricKey, period, targetValue: Number(value) },
      }),
    onSuccess: () => {
      setError(null);
      setValue('');
      refresh();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/performance/targets/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const entityName = (row: TargetRow) => {
    if (row.scopeType === 'USER') {
      const u = users?.items.find((x) => x.id === row.scopeId);
      return u ? pickName(locale, u) : row.scopeId.slice(0, 8);
    }
    const tm = teams?.find((x) => x.id === row.scopeId);
    return tm ? pickName(locale, tm) : row.scopeId.slice(0, 8);
  };

  return (
    <Dialog open onClose={onClose} title={t('performance.manageTargets')} wide>
      {error && <ErrorState message={error} />}
      <form
        className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (scopeId && value) save.mutate();
        }}
      >
        <Select
          label={t('performance.scopeType')}
          value={scopeType}
          onChange={(e) => {
            setScopeType(e.target.value as 'USER' | 'TEAM');
            setScopeId('');
          }}
        >
          <option value="USER">{t('performance.scopeUser')}</option>
          <option value="TEAM">{t('performance.scopeTeam')}</option>
        </Select>
        <Select
          label={scopeType === 'USER' ? t('users.name') : t('nav.teams')}
          value={scopeId}
          onChange={(e) => setScopeId(e.target.value)}
        >
          <option value="">—</option>
          {scopeType === 'USER'
            ? users?.items.map((u) => (
                <option key={u.id} value={u.id}>
                  {pickName(locale, u)}
                </option>
              ))
            : teams?.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {pickName(locale, tm)}
                </option>
              ))}
        </Select>
        <Select
          label={t('performance.metric')}
          value={metricKey}
          onChange={(e) => setMetricKey(e.target.value)}
        >
          {defs.map((d) => (
            <option key={d.key} value={d.key}>
              {pickName(locale, d)}
            </option>
          ))}
        </Select>
        <Select
          label={t('performance.period')}
          value={period}
          onChange={(e) => setPeriod(e.target.value as TargetPeriod)}
        >
          {(['DAILY', 'MONTHLY', 'YEARLY'] as const).map((p) => (
            <option key={p} value={p}>
              {t(`performance.periods.${p}`)}
            </option>
          ))}
        </Select>
        <div className="flex items-end gap-2">
          <Input
            label={t('performance.target')}
            type="number"
            min="0.01"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
          <Button type="submit" disabled={save.isPending || !scopeId || !value}>
            {t('common.save')}
          </Button>
        </div>
      </form>

      {!targets ? (
        <Spinner />
      ) : targets.length === 0 ? (
        <EmptyState message={t('performance.noTargets')} />
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2 text-start">{t('performance.scopeType')}</th>
              <th className="px-3 py-2 text-start">{t('users.name')}</th>
              <th className="px-3 py-2 text-start">{t('performance.metric')}</th>
              <th className="px-3 py-2 text-start">{t('performance.period')}</th>
              <th className="px-3 py-2 text-start">{t('performance.target')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {targets.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 text-gray-500">
                  {row.scopeType === 'USER'
                    ? t('performance.scopeUser')
                    : t('performance.scopeTeam')}
                </td>
                <td className="px-3 py-2">{entityName(row)}</td>
                <td className="px-3 py-2">{pickName(locale, row.metric)}</td>
                <td className="px-3 py-2 text-gray-500">
                  {t(`performance.periods.${row.period}`)}
                </td>
                <td className="px-3 py-2 tabular-nums">{Number(row.targetValue)}</td>
                <td className="px-3 py-2 text-end">
                  <Button
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(row.id)}
                  >
                    ✕
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
