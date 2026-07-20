'use client';

/**
 * Phase 6 §4 — location hierarchy reference admin (Region → City →
 * District → LocationAlias) plus the Branch backfill trigger and data-
 * quality summary. Mirrors dic/reference-tab.tsx's list+inline-create
 * pattern — location.view to read, location.manage to mutate (a single
 * higher-trust permission, not split per-catalog like DIC's
 * dic.edit/dic.admin, since geography carries none of DIC's patient-
 * safety stakes).
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { City, District, LocationAlias, LocationDataQuality, Region } from '@/lib/fulfillment-types';
import { Badge, Button, ErrorState, Input, Select, Spinner } from '@/components/ui';

const TABS = ['regions', 'cities', 'districts', 'aliases', 'quality'] as const;
type Tab = (typeof TABS)[number];

export default function LocationsAdminPage() {
  const t = useTranslations();
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<Tab>('regions');
  const canView = hasPermission('location.view');
  const canManage = hasPermission('location.manage');

  if (!canView) return <ErrorState message={t('locationsAdmin.noPermission')} />;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-gray-900">{t('locationsAdmin.title')}</h1>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`border-b-2 px-4 py-2 text-sm font-medium ${
              tab === k ? 'border-[#0b2545] text-[#0b2545]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t(`locationsAdmin.tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'regions' && <RegionsTab canManage={canManage} />}
      {tab === 'cities' && <CitiesTab canManage={canManage} />}
      {tab === 'districts' && <DistrictsTab canManage={canManage} />}
      {tab === 'aliases' && <AliasesTab canManage={canManage} />}
      {tab === 'quality' && <QualityTab canManage={canManage} />}
    </div>
  );
}

function RegionsTab({ canManage }: { canManage: boolean }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['locations-regions'],
    queryFn: () => api<Region[]>('/locations/regions'),
  });

  const create = useMutation({
    mutationFn: () => api('/locations/regions', { method: 'POST', body: { code, nameEn, nameAr } }),
    onSuccess: () => {
      setError(null);
      setCode('');
      setNameEn('');
      setNameAr('');
      setShowCreate(false);
      void qc.invalidateQueries({ queryKey: ['locations-regions'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? t('common.cancel') : t('locationsAdmin.newRegion')}
          </Button>
        </div>
      )}
      {showCreate && (
        <form
          className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          {error && <ErrorState message={error} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label={t('locationsAdmin.code')} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} required />
            <Input label={t('locationsAdmin.nameEn')} value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
            <Input label={t('locationsAdmin.nameAr')} dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      )}
      {isLoading ? (
        <Spinner />
      ) : (
        <SimpleTable
          rows={data ?? []}
          columns={[
            { header: t('locationsAdmin.code'), render: (r) => <span dir="ltr">{r.code}</span> },
            { header: t('locationsAdmin.nameEn'), render: (r) => r.nameEn },
            { header: t('locationsAdmin.nameAr'), render: (r) => <span dir="rtl">{r.nameAr}</span> },
            {
              header: t('locationsAdmin.status'),
              render: (r) => <Badge tone={r.active ? 'green' : 'gray'}>{r.active ? t('dic.reference.active') : t('dic.reference.inactive')}</Badge>,
            },
          ]}
        />
      )}
    </div>
  );
}

function CitiesTab({ canManage }: { canManage: boolean }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState('');
  const [regionId, setRegionId] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: regions } = useQuery({ queryKey: ['locations-regions'], queryFn: () => api<Region[]>('/locations/regions') });
  const { data, isLoading } = useQuery({ queryKey: ['locations-cities'], queryFn: () => api<City[]>('/locations/cities') });
  const regionById = new Map((regions ?? []).map((r) => [r.id, r]));

  const create = useMutation({
    mutationFn: () =>
      api('/locations/cities', {
        method: 'POST',
        body: {
          code,
          regionId,
          nameEn,
          nameAr,
          latitude: latitude ? Number(latitude) : undefined,
          longitude: longitude ? Number(longitude) : undefined,
        },
      }),
    onSuccess: () => {
      setError(null);
      setCode('');
      setNameEn('');
      setNameAr('');
      setLatitude('');
      setLongitude('');
      setShowCreate(false);
      void qc.invalidateQueries({ queryKey: ['locations-cities'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? t('common.cancel') : t('locationsAdmin.newCity')}
          </Button>
        </div>
      )}
      {showCreate && (
        <form
          className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          {error && <ErrorState message={error} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label={t('locationsAdmin.code')} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} required />
            <Select label={t('locationsAdmin.region')} value={regionId} onChange={(e) => setRegionId(e.target.value)} required>
              <option value="">{t('common.select')}</option>
              {(regions ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nameEn}
                </option>
              ))}
            </Select>
            <Input label={t('locationsAdmin.nameEn')} value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
            <Input label={t('locationsAdmin.nameAr')} dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required />
            <Input label={t('locator.lat')} dir="ltr" value={latitude} onChange={(e) => setLatitude(e.target.value)} />
            <Input label={t('locator.lng')} dir="ltr" value={longitude} onChange={(e) => setLongitude(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      )}
      {isLoading ? (
        <Spinner />
      ) : (
        <SimpleTable
          rows={data ?? []}
          columns={[
            { header: t('locationsAdmin.code'), render: (r) => <span dir="ltr">{r.code}</span> },
            { header: t('locationsAdmin.region'), render: (r) => regionById.get(r.regionId)?.nameEn ?? '—' },
            { header: t('locationsAdmin.nameEn'), render: (r) => r.nameEn },
            { header: t('locationsAdmin.nameAr'), render: (r) => <span dir="rtl">{r.nameAr}</span> },
            {
              header: t('locationsAdmin.status'),
              render: (r) => <Badge tone={r.active ? 'green' : 'gray'}>{r.active ? t('dic.reference.active') : t('dic.reference.inactive')}</Badge>,
            },
          ]}
        />
      )}
    </div>
  );
}

function DistrictsTab({ canManage }: { canManage: boolean }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState('');
  const [cityId, setCityId] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: cities } = useQuery({ queryKey: ['locations-cities'], queryFn: () => api<City[]>('/locations/cities') });
  const { data, isLoading } = useQuery({ queryKey: ['locations-districts'], queryFn: () => api<District[]>('/locations/districts') });
  const cityById = new Map((cities ?? []).map((c) => [c.id, c]));

  const create = useMutation({
    mutationFn: () => api('/locations/districts', { method: 'POST', body: { code, cityId, nameEn, nameAr } }),
    onSuccess: () => {
      setError(null);
      setCode('');
      setNameEn('');
      setNameAr('');
      setShowCreate(false);
      void qc.invalidateQueries({ queryKey: ['locations-districts'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? t('common.cancel') : t('locationsAdmin.newDistrict')}
          </Button>
        </div>
      )}
      {showCreate && (
        <form
          className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          {error && <ErrorState message={error} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label={t('locationsAdmin.code')} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} required />
            <Select label={t('locationsAdmin.city')} value={cityId} onChange={(e) => setCityId(e.target.value)} required>
              <option value="">{t('common.select')}</option>
              {(cities ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameEn}
                </option>
              ))}
            </Select>
            <Input label={t('locationsAdmin.nameEn')} value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
            <Input label={t('locationsAdmin.nameAr')} dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      )}
      {isLoading ? (
        <Spinner />
      ) : (
        <SimpleTable
          rows={data ?? []}
          columns={[
            { header: t('locationsAdmin.code'), render: (r) => <span dir="ltr">{r.code}</span> },
            { header: t('locationsAdmin.city'), render: (r) => cityById.get(r.cityId)?.nameEn ?? '—' },
            { header: t('locationsAdmin.nameEn'), render: (r) => r.nameEn },
            { header: t('locationsAdmin.nameAr'), render: (r) => <span dir="rtl">{r.nameAr}</span> },
          ]}
        />
      )}
    </div>
  );
}

function AliasesTab({ canManage }: { canManage: boolean }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [entityType, setEntityType] = useState<'CITY' | 'DISTRICT'>('CITY');
  const [entityId, setEntityId] = useState('');
  const [alias, setAlias] = useState('');
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [error, setError] = useState<string | null>(null);

  const { data: cities } = useQuery({ queryKey: ['locations-cities'], queryFn: () => api<City[]>('/locations/cities') });
  const { data: districts } = useQuery({ queryKey: ['locations-districts'], queryFn: () => api<District[]>('/locations/districts') });
  const { data, isLoading } = useQuery({ queryKey: ['locations-aliases'], queryFn: () => api<LocationAlias[]>('/locations/aliases') });
  const entities = entityType === 'CITY' ? (cities ?? []) : (districts ?? []);
  const entityById = new Map([...(cities ?? []), ...(districts ?? [])].map((e) => [e.id, e]));

  const create = useMutation({
    mutationFn: () => api('/locations/aliases', { method: 'POST', body: { entityType, entityId, alias, language } }),
    onSuccess: () => {
      setError(null);
      setAlias('');
      setShowCreate(false);
      void qc.invalidateQueries({ queryKey: ['locations-aliases'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? t('common.cancel') : t('locationsAdmin.newAlias')}
          </Button>
        </div>
      )}
      {showCreate && (
        <form
          className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          {error && <ErrorState message={error} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Select
              label={t('locationsAdmin.entityType')}
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value as 'CITY' | 'DISTRICT');
                setEntityId('');
              }}
            >
              <option value="CITY">{t('locationsAdmin.tabs.cities')}</option>
              <option value="DISTRICT">{t('locationsAdmin.tabs.districts')}</option>
            </Select>
            <Select label={t('locationsAdmin.entity')} value={entityId} onChange={(e) => setEntityId(e.target.value)} required>
              <option value="">{t('common.select')}</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nameEn}
                </option>
              ))}
            </Select>
            <Input label={t('locationsAdmin.aliasText')} value={alias} onChange={(e) => setAlias(e.target.value)} required />
            <Select label={t('dic.alias.language')} value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'ar')}>
              <option value="en">EN</option>
              <option value="ar">AR</option>
            </Select>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      )}
      {isLoading ? (
        <Spinner />
      ) : (
        <SimpleTable
          rows={data ?? []}
          columns={[
            { header: t('locationsAdmin.entityType'), render: (r) => t(`locationsAdmin.tabs.${r.entityType === 'CITY' ? 'cities' : 'districts'}`) },
            { header: t('locationsAdmin.entity'), render: (r) => entityById.get(r.entityId)?.nameEn ?? '—' },
            { header: t('locationsAdmin.aliasText'), render: (r) => r.alias },
            { header: t('dic.alias.language'), render: (r) => r.language.toUpperCase() },
          ]}
        />
      )}
    </div>
  );
}

function QualityTab({ canManage }: { canManage: boolean }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['locations-data-quality'],
    queryFn: () => api<LocationDataQuality>('/locations/data-quality'),
  });

  const backfill = useMutation({
    mutationFn: () => api('/locations/backfill-branches', { method: 'POST' }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['locations-data-quality'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  if (isLoading) return <Spinner />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} />}
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => backfill.mutate()} disabled={backfill.isPending}>
            {backfill.isPending ? t('locationsAdmin.backfillRunning') : t('locationsAdmin.backfillBtn')}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400">{t('locationsAdmin.totalBranches')}</div>
          <div className="text-2xl font-bold text-gray-900" dir="ltr">
            {data.totalBranches}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400">{t('locationsAdmin.missingCoordinates')}</div>
          <div className="text-2xl font-bold text-gray-900" dir="ltr">
            {data.missingCoordinates}
          </div>
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('locationsAdmin.byMatchStatus')}</h3>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(data.byMatchStatus).map(([status, count]) => (
            <Badge key={status} tone={status === 'AUTO_MATCHED' || status === 'MANUALLY_CONFIRMED' ? 'green' : 'amber'}>
              {status}: {count}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

function SimpleTable<T extends { id: string }>({
  rows,
  columns,
}: {
  rows: T[];
  columns: { header: string; render: (row: T) => React.ReactNode }[];
}) {
  const t = useTranslations('common');
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-gray-400">{t('empty')}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-start text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            {columns.map((c) => (
              <th key={c.header} className="px-3 py-2 text-start">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((c) => (
                <td key={c.header} className="px-3 py-2 text-gray-900">
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
