'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from './ui';

function switchLocale(next: 'ar' | 'en') {
  document.cookie = `milaserv.locale=${next};path=/;max-age=31536000;samesite=lax`;
  window.location.reload();
}

export function Topbar() {
  const { me, logout } = useAuth();
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 30_000,
  });

  const displayName = locale === 'ar' ? me?.nameAr : me?.nameEn;

  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
      <div className="text-sm text-gray-500">
        {me?.department ? (locale === 'ar' ? me.department.nameAr : me.department.nameEn) : ''}
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={() => switchLocale(locale === 'ar' ? 'en' : 'ar')}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          {locale === 'ar' ? 'English' : 'العربية'}
        </button>
        <Link
          href="/notifications"
          className="relative text-xl"
          aria-label={t('nav.notifications')}
        >
          🔔
          {unread && unread.count > 0 && (
            <span className="absolute -top-1 -end-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
              {unread.count > 99 ? '99+' : unread.count}
            </span>
          )}
        </Link>
        <span className="text-sm font-medium text-gray-800">{displayName}</span>
        <Button
          variant="ghost"
          onClick={async () => {
            await logout();
            router.replace('/login');
          }}
        >
          {t('auth.logout')}
        </Button>
      </div>
    </header>
  );
}
