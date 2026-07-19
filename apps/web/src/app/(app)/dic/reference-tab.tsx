'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type {
  ActiveIngredient,
  Country,
  DosageForm,
  Manufacturer,
  MeasurementUnit,
  TherapeuticClass,
} from '@/lib/dic-types';
import { Badge, Button, ErrorState, Input, Spinner } from '@/components/ui';

type EntityKind =
  | 'dosage-forms'
  | 'units'
  | 'countries'
  | 'manufacturers'
  | 'therapeutic-classes'
  | 'active-ingredients';

const ENTITY_KINDS: EntityKind[] = [
  'dosage-forms',
  'units',
  'countries',
  'manufacturers',
  'therapeutic-classes',
  'active-ingredients',
];

/** Structural catalogs are dic.admin to mutate; manufacturers/active
 *  ingredients are dic.edit to create but dic.admin to edit (matches
 *  dic-reference.controller.ts's permission split). */
const CREATE_PERMISSION: Record<EntityKind, string> = {
  'dosage-forms': 'dic.admin',
  units: 'dic.admin',
  countries: 'dic.admin',
  'therapeutic-classes': 'dic.admin',
  manufacturers: 'dic.edit',
  'active-ingredients': 'dic.edit',
};
const EDIT_PERMISSION: Record<EntityKind, string> = {
  'dosage-forms': 'dic.admin',
  units: 'dic.admin',
  countries: 'dic.admin',
  'therapeutic-classes': 'dic.admin',
  manufacturers: 'dic.admin',
  'active-ingredients': 'dic.admin',
};

type AnyRow =
  DosageForm | MeasurementUnit | Country | Manufacturer | TherapeuticClass | ActiveIngredient;

export function ReferenceTab() {
  const t = useTranslations();
  const { hasPermission } = useAuth();
  const [kind, setKind] = useState<EntityKind>('dosage-forms');
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['dic-reference', kind],
    queryFn: () => api<AnyRow[]>(`/dic/reference/${kind}`),
  });

  const toggleActive = useMutation({
    mutationFn: (row: AnyRow) =>
      api(`/dic/reference/${kind}/${row.id}`, {
        method: 'PATCH',
        body: { active: !row.active },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['dic-reference', kind] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {ENTITY_KINDS.map((k) => (
            <button
              key={k}
              onClick={() => {
                setKind(k);
                setShowCreate(false);
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                kind === k
                  ? 'bg-[#0b2545] text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t(`dic.reference.kind.${k}`)}
            </button>
          ))}
        </div>
        {hasPermission(CREATE_PERMISSION[kind]) && (
          <Button onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? t('common.cancel') : t('dic.reference.newBtn')}
          </Button>
        )}
      </div>

      {showCreate && <CreateForm kind={kind} onDone={() => setShowCreate(false)} />}

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorState message={error instanceof ApiError ? error.message : t('common.error')} />
      ) : !data || data.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">{t('dic.reference.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-start text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-start">{t('dic.reference.nameEn')}</th>
                <th className="px-3 py-2 text-start">{t('dic.reference.nameAr')}</th>
                <th className="px-3 py-2 text-start">{t('dic.reference.status')}</th>
                {hasPermission(EDIT_PERMISSION[kind]) && (
                  <th className="px-3 py-2 text-start">{t('dic.reference.actions')}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 text-gray-900">
                    {'scientificNameEn' in row ? row.scientificNameEn : row.nameEn}
                  </td>
                  <td className="px-3 py-2 text-gray-600" dir="rtl">
                    {'scientificNameEn' in row ? row.scientificNameAr : row.nameAr}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={row.active ? 'green' : 'gray'}>
                      {row.active ? t('dic.reference.active') : t('dic.reference.inactive')}
                    </Badge>
                  </td>
                  {hasPermission(EDIT_PERMISSION[kind]) && (
                    <td className="px-3 py-2">
                      <Button
                        variant="ghost"
                        onClick={() => toggleActive.mutate(row)}
                        disabled={toggleActive.isPending}
                      >
                        {row.active ? t('dic.reference.deactivate') : t('dic.reference.activate')}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateForm({ kind, onDone }: { kind: EntityKind; onDone: () => void }) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [code, setCode] = useState('');
  const [unitCategory, setUnitCategory] = useState('');
  const [error, setError] = useState<string | null>(null);

  const scientificMode = kind === 'active-ingredients';

  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = scientificMode
        ? { scientificNameEn: nameEn, scientificNameAr: nameAr || undefined }
        : { nameEn, nameAr: nameAr || undefined };
      if (kind === 'countries') body.isoCode = code;
      else if (['dosage-forms', 'units'].includes(kind)) body.code = code;
      if (kind === 'units') body.unitCategory = unitCategory;
      return api(`/dic/reference/${kind}`, { method: 'POST', body });
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['dic-reference', kind] });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  return (
    <form
      className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      {error && <ErrorState message={error} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {['dosage-forms', 'units', 'countries'].includes(kind) && (
          <Input
            label={t('dic.reference.code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        )}
        {kind === 'units' && (
          <Input
            label={t('dic.reference.unitCategory')}
            value={unitCategory}
            onChange={(e) => setUnitCategory(e.target.value)}
            required
          />
        )}
        <Input
          label={scientificMode ? t('dic.reference.scientificNameEn') : t('dic.reference.nameEn')}
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
          required
        />
        <Input
          label={scientificMode ? t('dic.reference.scientificNameAr') : t('dic.reference.nameAr')}
          value={nameAr}
          onChange={(e) => setNameAr(e.target.value)}
          dir="rtl"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {t('dic.reference.create')}
        </Button>
      </div>
    </form>
  );
}
