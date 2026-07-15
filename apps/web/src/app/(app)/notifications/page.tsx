'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { NotificationRow, Page } from '@/lib/types';
import { Badge, Button, EmptyState, Spinner } from '@/components/ui';

export default function NotificationsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', page],
    queryFn: () => api<Page<NotificationRow>>(`/notifications?page=${page}&pageSize=20`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const markAllRead = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: invalidate,
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('notifications.title')}</h1>
        <Button variant="secondary" onClick={() => markAllRead.mutate()}>
          {t('notifications.markAllRead')}
        </Button>
      </div>

      {!data || data.items.length === 0 ? (
        <EmptyState message={t('notifications.empty')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((n) => (
            <li
              key={n.id}
              className={`rounded-lg border p-4 ${
                n.readAt ? 'border-gray-200 bg-white' : 'border-blue-200 bg-blue-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-gray-900">
                    {locale === 'ar' ? n.titleAr : n.titleEn}
                  </div>
                  {(locale === 'ar' ? n.bodyAr : n.bodyEn) && (
                    <div className="mt-1 text-sm text-gray-600">
                      {locale === 'ar' ? n.bodyAr : n.bodyEn}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-gray-400">
                    {new Date(n.createdAt).toLocaleString(locale === 'ar' ? 'ar' : 'en')}
                  </div>
                </div>
                {!n.readAt && (
                  <button
                    onClick={() => markRead.mutate(n.id)}
                    className="shrink-0"
                    aria-label="mark read"
                  >
                    <Badge tone="blue">{t('notifications.unread')}</Badge>
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > 20 && (
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('common.previous')}
          </Button>
          <Button
            variant="secondary"
            disabled={page * 20 >= data.total}
            onClick={() => setPage(page + 1)}
          >
            {t('common.next')}
          </Button>
        </div>
      )}
    </div>
  );
}
