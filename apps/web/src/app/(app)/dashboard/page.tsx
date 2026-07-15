'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth';

export default function DashboardPage() {
  const { me } = useAuth();
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const name = locale === 'ar' ? me?.nameAr : me?.nameEn;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
      <p className="mt-2 text-gray-600">{t('welcome', { name: name ?? '' })}</p>
      <p className="mt-1 text-sm text-gray-400">{t('hint')}</p>
    </div>
  );
}
