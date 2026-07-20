'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { DrugAlias } from '@/lib/dic-types';
import { Badge, Button, EmptyState, ErrorState, Spinner } from '@/components/ui';

/** dic.approve_alias approval queue (design doc §6/§17) — the alias
 *  itself is proposed in context of a drug (see DrugCardView). */
export function AliasTab() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['dic-aliases-pending'],
    queryFn: () => api<DrugAlias[]>('/dic/aliases/pending'),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      api(`/dic/aliases/${id}/decide`, {
        method: 'POST',
        body: { decision, note: note[id] || undefined },
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['dic-aliases-pending'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <EmptyState message={t('dic.alias.empty')} />;

  return (
    <div className="space-y-3">
      {error && <ErrorState message={error} />}
      {data.map((row) => (
        <div key={row.id} className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-medium text-gray-900">{row.alias}</span>{' '}
              <Badge tone="gray">{row.aliasType}</Badge>
              <Badge tone="blue">{row.language}</Badge>
            </div>
            {row.drug && (
              <span className="text-xs text-gray-500">
                {row.drug.nameEn} (<span dir="ltr">{row.drug.materialNo}</span>)
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-[#0b2545]"
              placeholder={t('dic.alias.note')}
              value={note[row.id] ?? ''}
              onChange={(e) => setNote({ ...note, [row.id]: e.target.value })}
            />
            <Button
              onClick={() => decide.mutate({ id: row.id, decision: 'approve' })}
              disabled={decide.isPending}
            >
              {t('dic.alias.approve')}
            </Button>
            <Button
              variant="danger"
              onClick={() => decide.mutate({ id: row.id, decision: 'reject' })}
              disabled={decide.isPending}
            >
              {t('dic.alias.reject')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
