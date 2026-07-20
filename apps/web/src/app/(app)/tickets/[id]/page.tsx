'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickName } from '@/lib/names';
import type { Page, UserRow } from '@/lib/types';
import type { TicketCatalogs, TicketDetail } from '@/lib/ticket-types';
import { Badge, Button, Dialog, ErrorState, Input, Select, Spinner } from '@/components/ui';

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations();
  const locale = useLocale();
  const { hasPermission, me } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'updates' | 'resolution' | 'timeline'>('updates');
  const [assignOpen, setAssignOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [update, setUpdate] = useState({ updateTypeKey: 'GENERAL_UPDATE', body: '' });
  const [resolution, setResolution] = useState({
    summary: '',
    rootCause: '',
    actionTaken: '',
    finalSolution: '',
    resolutionCategoryKey: '',
    customerInformed: true,
  });

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api<TicketDetail>(`/tickets/${id}`),
  });
  const { data: catalogs } = useQuery({
    queryKey: ['ticket-config'],
    queryFn: () => api<TicketCatalogs>('/ticket-config'),
    staleTime: 300_000,
  });
  const { data: users } = useQuery({
    queryKey: ['users', 'assignable'],
    queryFn: () => api<Page<UserRow>>('/users?page=1&pageSize=100&status=ACTIVE'),
    enabled: assignOpen && hasPermission('user.view'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    void queryClient.invalidateQueries({ queryKey: ['tickets'] });
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : t('common.error'));

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api(`/tickets/${id}${path}`, { method: 'POST', body }),
    onSuccess: () => {
      setError(null);
      setAssignOpen(false);
      setResolveOpen(false);
      invalidate();
    },
    onError,
  });

  const addUpdate = useMutation({
    mutationFn: () => api(`/tickets/${id}/updates`, { method: 'POST', body: update }),
    onSuccess: () => {
      setUpdate({ updateTypeKey: 'GENERAL_UPDATE', body: '' });
      setError(null);
      invalidate();
    },
    onError,
  });

  if (isLoading || !ticket) return <Spinner />;

  const statusKey = ticket.status.key;
  const isOpenKind = ticket.status.kind === 'OPEN';
  const canResolve = hasPermission('ticket.resolve') && isOpenKind && statusKey !== 'OPENED';
  const canClose = hasPermission('ticket.close') && statusKey === 'COMPLETED';
  const canReopen = hasPermission('ticket.reopen') && statusKey === 'CLOSED';
  const canEscalate = hasPermission('ticket.escalate') && isOpenKind && statusKey !== 'ESCALATED';
  const canTake =
    hasPermission('ticket.take_responsibility') && isOpenKind && ticket.responsible?.id !== me?.id;

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-sm text-gray-500" dir="ltr">
            <span>{ticket.internalNumber}</span>·<span>{ticket.customerComplaintNumber}</span>
          </div>
          <h1 className="mt-1 text-xl font-bold text-gray-900">{ticket.subject}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: ticket.status.color }}
            >
              {pickName(locale, ticket.status)}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: ticket.urgency.color }}
            >
              {pickName(locale, ticket.urgency)}
            </span>
            <Badge
              tone={
                ticket.slaState === 'BREACHED'
                  ? 'red'
                  : ticket.slaState === 'WARNING'
                    ? 'amber'
                    : 'gray'
              }
            >
              {t('tickets.sla')}: {t(`tickets.slaStates.${ticket.slaState}`)}
            </Badge>
            {ticket.reopenCount > 0 && (
              <Badge tone="amber">
                {t('tickets.reopenCount')}: {ticket.reopenCount}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canTake && (
            <Button variant="secondary" onClick={() => act.mutate({ path: '/take' })}>
              {t('tickets.take')}
            </Button>
          )}
          {hasPermission('ticket.assign') && isOpenKind && (
            <Button variant="secondary" onClick={() => setAssignOpen(true)}>
              {t('tickets.assign')}
            </Button>
          )}
          {canEscalate && (
            <Button
              variant="secondary"
              onClick={() => {
                const reason = window.prompt(t('tickets.reason'));
                if (reason) act.mutate({ path: '/escalate', body: { reason } });
              }}
            >
              {t('tickets.escalate')}
            </Button>
          )}
          {canResolve && (
            <Button onClick={() => setResolveOpen(true)}>{t('tickets.resolve')}</Button>
          )}
          {canClose && (
            <Button onClick={() => act.mutate({ path: '/close' })}>{t('tickets.close')}</Button>
          )}
          {canReopen && (
            <Button
              variant="danger"
              onClick={() => {
                const reason = window.prompt(t('tickets.reason'));
                if (reason) act.mutate({ path: '/reopen', body: { reason } });
              }}
            >
              {t('tickets.reopen')}
            </Button>
          )}
        </div>
      </div>
      {error && <ErrorState message={error} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left column: info */}
        <div className="flex flex-col gap-4">
          <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold text-gray-800">{t('tickets.info')}</h2>
            <dl className="flex flex-col gap-1 text-gray-600">
              <div>
                <dt className="inline font-medium">{t('tickets.customer')}: </dt>
                <dd className="inline">
                  {ticket.customerName} (<span dir="ltr">{ticket.customerPhone}</span>)
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">{t('tickets.category')}: </dt>
                <dd className="inline">
                  {pickName(locale, ticket.type)} · {pickName(locale, ticket.category)}
                </dd>
              </div>
              {ticket.relatedOrderNo && (
                <div>
                  <dt className="inline font-medium">{t('tickets.relatedOrderNo')}: </dt>
                  <dd className="inline" dir="ltr">
                    {ticket.relatedOrderNo}
                  </dd>
                </div>
              )}
              {ticket.sapMaterialNo && (
                <div>
                  <dt className="inline font-medium">{t('tickets.sapMaterialNo')}: </dt>
                  <dd className="inline" dir="ltr">
                    {ticket.sapMaterialNo}
                  </dd>
                </div>
              )}
            </dl>
            <p className="mt-2 whitespace-pre-wrap text-gray-700">{ticket.description}</p>
          </section>

          {ticket.branch && (
            <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
              <h2 className="mb-2 font-semibold text-gray-800">{t('tickets.branch')}</h2>
              <div className="text-gray-700">
                {ticket.branch.code} — {pickName(locale, ticket.branch)}
              </div>
              {ticket.branchSupervisorSnapshot && (
                <div className="mt-2 rounded-md bg-gray-50 p-2 text-xs text-gray-600">
                  <div className="font-medium text-gray-700">{t('tickets.supervisor')}</div>
                  {ticket.branchSupervisorSnapshot.name}
                  {ticket.branchSupervisorSnapshot.email && (
                    <span dir="ltr"> · {ticket.branchSupervisorSnapshot.email}</span>
                  )}
                </div>
              )}
            </section>
          )}

          <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold text-gray-800">{t('tickets.people')}</h2>
            <dl className="flex flex-col gap-1 text-gray-600">
              <div>
                <dt className="inline font-medium">{t('tickets.createdBy')}: </dt>
                <dd className="inline">{pickName(locale, ticket.createdBy)}</dd>
              </div>
              <div>
                <dt className="inline font-medium">{t('tickets.responsible')}: </dt>
                <dd className="inline">
                  {ticket.responsible ? pickName(locale, ticket.responsible) : '—'}
                </dd>
              </div>
            </dl>
            {ticket.ownerships.length > 0 && (
              <div className="mt-2">
                <div className="text-xs font-medium text-gray-500">
                  {t('tickets.ownershipHistory')}
                </div>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-gray-500">
                  {ticket.ownerships.map((o, i) => (
                    <li key={i}>
                      {pickName(locale, o.user)} —{' '}
                      {new Date(o.fromAt).toLocaleString(locale === 'ar' ? 'ar' : 'en')}
                      {o.toAt
                        ? ` → ${new Date(o.toAt).toLocaleString(locale === 'ar' ? 'ar' : 'en')}`
                        : ' (—)'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {ticket.teams.length > 0 && (
            <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
              <h2 className="mb-2 font-semibold text-gray-800">{t('tickets.directedTeams')}</h2>
              <div className="flex flex-wrap gap-1">
                {ticket.teams.map((x) => (
                  <Badge key={x.team.id} tone="blue">
                    {pickName(locale, x.team)}
                  </Badge>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right column: tabs */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex gap-1">
            {(['updates', 'resolution', 'timeline'] as const).map((x) => (
              <button
                key={x}
                onClick={() => setTab(x)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  tab === x ? 'bg-[#0b2545] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t(`tickets.${x}`)}
              </button>
            ))}
          </div>

          {tab === 'updates' && (
            <div className="flex flex-col gap-3">
              {hasPermission('ticket.update_add') && isOpenKind && (
                <form
                  className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addUpdate.mutate();
                  }}
                >
                  <div className="flex gap-2">
                    <Select
                      className="w-56"
                      value={update.updateTypeKey}
                      onChange={(e) => setUpdate({ ...update, updateTypeKey: e.target.value })}
                    >
                      {catalogs?.updateTypes.map((u) => (
                        <option key={u.key} value={u.key}>
                          {pickName(locale, u)}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" disabled={addUpdate.isPending || update.body.length < 2}>
                      {t('tickets.addUpdate')}
                    </Button>
                  </div>
                  <textarea
                    rows={2}
                    required
                    placeholder={t('tickets.updateBody')}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#0b2545]"
                    value={update.body}
                    onChange={(e) => setUpdate({ ...update, body: e.target.value })}
                  />
                </form>
              )}
              <ul className="flex flex-col gap-2">
                {ticket.updates.map((u) => (
                  <li key={u.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
                      <Badge tone="gray">{pickName(locale, u.updateType)}</Badge>
                      <span>{pickName(locale, u.author)}</span>
                      <span>
                        {new Date(u.createdAt).toLocaleString(locale === 'ar' ? 'ar' : 'en')}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-gray-700">{u.body}</p>
                  </li>
                ))}
                {ticket.updates.length === 0 && (
                  <li className="p-4 text-center text-sm text-gray-400">{t('common.empty')}</li>
                )}
              </ul>
            </div>
          )}

          {tab === 'resolution' &&
            (ticket.resolution ? (
              <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
                <div className="mb-2 flex items-center gap-2">
                  <Badge tone="green">
                    {pickName(locale, ticket.resolution.resolutionCategory)}
                  </Badge>
                  <span className="text-xs text-gray-400">
                    {new Date(ticket.resolution.resolvedAt).toLocaleString(
                      locale === 'ar' ? 'ar' : 'en',
                    )}
                  </span>
                </div>
                {(
                  [
                    ['summary', ticket.resolution.summary],
                    ['rootCause', ticket.resolution.rootCause],
                    ['actionTaken', ticket.resolution.actionTaken],
                    ['finalSolution', ticket.resolution.finalSolution],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="mb-2">
                    <div className="text-xs font-medium text-gray-500">{t(`tickets.${k}`)}</div>
                    <p className="text-gray-700">{v}</p>
                  </div>
                ))}
                <div className="text-xs text-gray-500">
                  {t('tickets.customerInformed')}:{' '}
                  {ticket.resolution.customerInformed ? t('common.yes') : t('common.no')}
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-gray-400">{t('common.empty')}</div>
            ))}

          {tab === 'timeline' && (
            <ul className="flex flex-col gap-1">
              {ticket.timeline.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-3 rounded-md bg-white px-3 py-2 text-xs"
                >
                  <span className="w-36 shrink-0 text-gray-400" dir="ltr">
                    {new Date(e.createdAt).toLocaleString('en')}
                  </span>
                  <code className="text-gray-700">{e.eventType}</code>
                  {e.payload && (
                    <span className="truncate text-gray-400">{JSON.stringify(e.payload)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Assign dialog */}
      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} title={t('tickets.assign')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (assignee) act.mutate({ path: '/assign', body: { userId: assignee } });
          }}
        >
          <Select
            label={t('tickets.assignTo')}
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">—</option>
            {users?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {pickName(locale, u)} ({u.email})
              </option>
            ))}
          </Select>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAssignOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!assignee || act.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Resolve dialog (§9.7 mandatory fields) */}
      <Dialog
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        title={t('tickets.resolve')}
        wide
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            act.mutate({ path: '/resolve', body: resolution });
          }}
        >
          <Input
            label={t('tickets.summary')}
            required
            value={resolution.summary}
            onChange={(e) => setResolution({ ...resolution, summary: e.target.value })}
          />
          <Input
            label={t('tickets.rootCause')}
            required
            value={resolution.rootCause}
            onChange={(e) => setResolution({ ...resolution, rootCause: e.target.value })}
          />
          <Input
            label={t('tickets.actionTaken')}
            required
            value={resolution.actionTaken}
            onChange={(e) => setResolution({ ...resolution, actionTaken: e.target.value })}
          />
          <Input
            label={t('tickets.finalSolution')}
            required
            value={resolution.finalSolution}
            onChange={(e) => setResolution({ ...resolution, finalSolution: e.target.value })}
          />
          <Select
            label={t('tickets.resolutionCategory')}
            required
            value={resolution.resolutionCategoryKey}
            onChange={(e) =>
              setResolution({ ...resolution, resolutionCategoryKey: e.target.value })
            }
          >
            <option value="">—</option>
            {catalogs?.resolutionCategories.map((c) => (
              <option key={c.key} value={c.key}>
                {pickName(locale, c)}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={resolution.customerInformed}
              onChange={(e) => setResolution({ ...resolution, customerInformed: e.target.checked })}
            />
            {t('tickets.customerInformed')}
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setResolveOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!resolution.resolutionCategoryKey || act.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
