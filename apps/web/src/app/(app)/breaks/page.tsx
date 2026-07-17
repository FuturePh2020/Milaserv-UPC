'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickName } from '@/lib/names';
import type { BreaksLive, BreaksMe, LiveState } from '@/lib/break-types';
import { Badge, Button, EmptyState, ErrorState, Spinner } from '@/components/ui';

const STATE_TONES: Record<LiveState, 'green' | 'blue' | 'amber' | 'gray'> = {
  AVAILABLE: 'green',
  ON_BREAK: 'blue',
  IDLE: 'amber',
  OFFLINE: 'gray',
};

function useNow(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

function fmtDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Activity heartbeat (spec §4 / C1): only the timestamp of the latest
 * mouse/keyboard input is kept and sent — no input content is ever captured.
 */
function useActivityHeartbeat(active: boolean, intervalSeconds: number, onBeat: () => void) {
  const lastActivity = useRef<number>(Date.now());
  useEffect(() => {
    if (!active) return;
    const mark = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener('mousemove', mark);
    window.addEventListener('keydown', mark);
    window.addEventListener('click', mark);
    const beat = () => {
      void api('/breaks/heartbeat', {
        method: 'POST',
        body: { lastActivityAt: new Date(lastActivity.current).toISOString() },
      })
        .then(onBeat)
        .catch(() => undefined);
    };
    const timer = setInterval(beat, Math.max(15, intervalSeconds) * 1000);
    return () => {
      window.removeEventListener('mousemove', mark);
      window.removeEventListener('keydown', mark);
      window.removeEventListener('click', mark);
      clearInterval(timer);
    };
  }, [active, intervalSeconds, onBeat]);
}

export default function BreaksPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: me, isLoading } = useQuery({
    queryKey: ['breaks-me'],
    queryFn: () => api<BreaksMe>('/breaks/me'),
    refetchInterval: 15000,
  });

  const canSeeTeam = hasPermission('break.viewTeam');
  const { data: live } = useQuery({
    queryKey: ['breaks-live'],
    queryFn: () => api<BreaksLive>('/breaks/live'),
    enabled: canSeeTeam,
    refetchInterval: 15000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['breaks-me'] });
    void queryClient.invalidateQueries({ queryKey: ['breaks-live'] });
  };

  const mutation = useMutation({
    mutationFn: (path: string) => api(path, { method: 'POST', body: {} }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const session = me?.session ?? null;
  const now = useNow(Boolean(session));
  useActivityHeartbeat(Boolean(session), me?.config.heartbeatIntervalSeconds ?? 60, refresh);

  if (isLoading || !me) return <Spinner />;

  // Live counters: rollups + the open period's elapsed time.
  const counters = { active: 0, idle: 0, break: 0 };
  if (session) {
    counters.active = session.activeSeconds;
    counters.idle = session.idleSeconds;
    counters.break = session.breakSeconds;
    if (session.currentPeriod) {
      const elapsed = (now - new Date(session.currentPeriod.startedAt).getTime()) / 1000;
      if (session.currentPeriod.type === 'WORK') counters.active += elapsed;
      if (session.currentPeriod.type === 'IDLE') counters.idle += elapsed;
      if (session.currentPeriod.type === 'BREAK') counters.break += elapsed;
    }
  }

  const allowance = me.breakAllowance;
  const overage = allowance.remainingMinutes < 0;
  const periodType = session?.currentPeriod?.type ?? null;

  return (
    <div className="max-w-5xl">
      <h1 className="mb-4 text-2xl font-bold text-gray-900">{t('breaks.title')}</h1>
      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      {/* ── My session (§11.1) ─────────────────────────────────────── */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-gray-800">{t('breaks.mySession')}</span>
            {session ? (
              <Badge
                tone={periodType === 'BREAK' ? 'blue' : periodType === 'IDLE' ? 'amber' : 'green'}
              >
                {periodType === 'BREAK'
                  ? t('breaks.states.ON_BREAK')
                  : periodType === 'IDLE'
                    ? t('breaks.states.IDLE')
                    : t('breaks.states.AVAILABLE')}
              </Badge>
            ) : (
              <Badge tone="gray">{t('breaks.states.OFFLINE')}</Badge>
            )}
          </div>
          <div className="flex gap-2">
            {!session && (
              <Button onClick={() => mutation.mutate('/breaks/session/start')}>
                {t('breaks.startSession')}
              </Button>
            )}
            {session && periodType !== 'BREAK' && (
              <Button variant="secondary" onClick={() => mutation.mutate('/breaks/break/start')}>
                {t('breaks.startBreak')}
              </Button>
            )}
            {session && periodType === 'BREAK' && (
              <Button onClick={() => mutation.mutate('/breaks/break/end')}>
                {t('breaks.endBreak')}
              </Button>
            )}
            {session && (
              <Button variant="danger" onClick={() => mutation.mutate('/breaks/session/end')}>
                {t('breaks.endSession')}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('breaks.activeTime')} value={fmtDuration(counters.active)} />
          <Stat label={t('breaks.idleTime')} value={fmtDuration(counters.idle)} />
          <Stat label={t('breaks.breakTime')} value={fmtDuration(counters.break)} />
          <div className="rounded-md bg-gray-50 p-3">
            <div className="text-xs text-gray-500">{t('breaks.remainingAllowance')}</div>
            <div className={`text-lg font-bold ${overage ? 'text-red-600' : 'text-gray-900'}`}>
              {allowance.remainingMinutes} {t('breaks.min')}
            </div>
            <div className="text-xs text-gray-400">
              {t('breaks.usedOf', {
                used: allowance.usedMinutes,
                total: allowance.allowanceMinutes,
              })}
            </div>
          </div>
        </div>
        {!session && <p className="mt-3 text-sm text-gray-500">{t('breaks.noSessionHint')}</p>}
      </section>

      {/* ── Live Team View (§11.3) ─────────────────────────────────── */}
      {canSeeTeam && (
        <section className="mt-6 rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="font-semibold text-gray-800">{t('breaks.liveView')}</span>
            {live && (
              <span className="text-xs text-gray-400">
                {t('breaks.asOf')}{' '}
                {new Date(live.asOf).toLocaleTimeString(locale === 'ar' ? 'ar' : 'en')}
              </span>
            )}
          </div>
          {!live ? (
            <div className="p-4">
              <Spinner />
            </div>
          ) : live.members.length === 0 ? (
            <div className="p-4">
              <EmptyState message={t('common.empty')} />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-start">{t('users.name')}</th>
                  <th className="px-4 py-2 text-start">{t('nav.teams')}</th>
                  <th className="px-4 py-2 text-start">{t('breaks.state')}</th>
                  <th className="px-4 py-2 text-start">{t('breaks.since')}</th>
                  <th className="px-4 py-2 text-start">{t('breaks.breakBalance')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {live.members.map((m) => (
                  <tr key={m.user.id}>
                    <td className="px-4 py-2">{pickName(locale, m.user)}</td>
                    <td className="px-4 py-2 text-gray-500">
                      {m.team ? pickName(locale, m.team) : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={STATE_TONES[m.state]}>{t(`breaks.states.${m.state}`)}</Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {m.since
                        ? new Date(m.since).toLocaleTimeString(locale === 'ar' ? 'ar' : 'en')
                        : '—'}
                    </td>
                    <td
                      className={`px-4 py-2 text-xs ${
                        m.breakAllowance.remainingMinutes < 0
                          ? 'font-semibold text-red-600'
                          : 'text-gray-500'
                      }`}
                    >
                      {m.breakAllowance.remainingMinutes} {t('breaks.min')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-gray-50 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-bold tabular-nums text-gray-900">{value}</div>
    </div>
  );
}
