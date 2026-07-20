'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { pickName } from '@/lib/names';
import { Badge, Button, EmptyState, ErrorState, Input, Spinner } from '@/components/ui';

interface NearestResult {
  at: { lat: number; lng: number };
  /** §21 Maps connector: 'maps' (driving) or 'straight_line' fallback. */
  distanceSource: 'maps' | 'straight_line';
  results: {
    id: string;
    code: string;
    nameAr: string;
    nameEn: string;
    city: string | null;
    district: string | null;
    addressAr: string | null;
    addressEn: string | null;
    phone: string | null;
    mapUrl: string | null;
    branchType: { key: string; nameAr: string; nameEn: string } | null;
    distanceKm: number;
    open: boolean;
    deliveryEtaMinutes: number | null;
    deliveryUnavailableReason: string | null;
  }[];
}

/** §16.3 Locator & Delivery Estimator. */
export default function LocatorPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<NearestResult | null>(null);

  const search = useMutation({
    mutationFn: (coords: { lat: string; lng: string }) =>
      api<NearestResult>(`/branches/nearest?lat=${coords.lat}&lng=${coords.lng}`),
    onSuccess: (res) => {
      setError(null);
      setData(res);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError(t('locator.noGeolocation'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude.toFixed(6);
        const lo = pos.coords.longitude.toFixed(6);
        setLat(la);
        setLng(lo);
        search.mutate({ lat: la, lng: lo });
      },
      () => setError(t('locator.locationDenied')),
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-2xl font-bold text-gray-900">{t('locator.title')}</h1>
      {error && <ErrorState message={error} />}

      <form
        className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (lat && lng) search.mutate({ lat, lng });
        }}
      >
        <Input
          label={t('locator.lat')}
          dir="ltr"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          className="w-40"
          required
        />
        <Input
          label={t('locator.lng')}
          dir="ltr"
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          className="w-40"
          required
        />
        <Button type="submit" disabled={search.isPending}>
          {t('locator.find')}
        </Button>
        <Button type="button" variant="secondary" onClick={useMyLocation}>
          📍 {t('locator.useMyLocation')}
        </Button>
      </form>

      {search.isPending && <Spinner />}
      {data && data.results.length === 0 && <EmptyState message={t('locator.noBranches')} />}
      {data && data.results.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs text-gray-500">
            <Badge tone={data.distanceSource === 'maps' ? 'green' : 'gray'}>
              {t(`locator.source.${data.distanceSource}`)}
            </Badge>
          </div>
          {data.results.map((b, i) => (
            <div key={b.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0b2545] text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="font-semibold text-gray-900">{pickName(locale, b)}</span>
                  <span className="font-mono text-xs text-gray-400">{b.code}</span>
                  {b.branchType && <Badge tone="blue">{pickName(locale, b.branchType)}</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="gray">
                    {b.distanceKm} {t('locator.km')}
                  </Badge>
                  <Badge tone={b.open ? 'green' : 'red'}>
                    {b.open ? t('locator.open') : t('locator.closed')}
                  </Badge>
                </div>
              </div>
              <div className="mt-2 text-sm text-gray-500">
                {(locale === 'ar' ? b.addressAr : b.addressEn) ??
                  [b.district, b.city].filter(Boolean).join('، ')}
                {b.phone && (
                  <span className="ms-2 text-gray-400" dir="ltr">
                    ☎ {b.phone}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-3">
                {b.deliveryEtaMinutes !== null ? (
                  <Badge tone="green">
                    🛵 {t('locator.eta', { minutes: b.deliveryEtaMinutes })}
                  </Badge>
                ) : (
                  <Badge tone="amber">
                    {t(`locator.reasons.${b.deliveryUnavailableReason ?? 'NOT_COVERED'}`)}
                  </Badge>
                )}
                {b.mapUrl && (
                  <a
                    href={b.mapUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-blue-700 underline"
                  >
                    {t('locator.openMap')}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
