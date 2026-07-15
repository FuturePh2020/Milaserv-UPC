'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DATA_SCOPES } from '@milaserv/contracts';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickName } from '@/lib/names';
import type { PermissionRow, RoleRow } from '@/lib/types';
import { Badge, Button, Dialog, ErrorState, Input, Select, Spinner } from '@/components/ui';

interface GrantState {
  permissionKey: string;
  dataScope: string;
}

interface FormState {
  id?: string;
  key: string;
  nameAr: string;
  nameEn: string;
  grants: GrantState[];
}

export default function RolesPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: roles, isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api<RoleRow[]>('/roles'),
  });
  const { data: catalog } = useQuery({
    queryKey: ['roles', 'catalog'],
    queryFn: () => api<PermissionRow[]>('/roles/catalog'),
  });

  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : t('common.error'));
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['roles'] });
  };

  const save = useMutation({
    mutationFn: (f: FormState) =>
      f.id
        ? api(`/roles/${f.id}`, {
            method: 'PATCH',
            body: { nameAr: f.nameAr, nameEn: f.nameEn, grants: f.grants },
          })
        : api('/roles', { method: 'POST', body: f }),
    onSuccess: () => {
      setForm(null);
      setError(null);
      invalidate();
    },
    onError,
  });

  const archive = useMutation({
    mutationFn: (id: string) => api(`/roles/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError,
  });

  const canManage = hasPermission('role.manage');

  const modules = useMemo(() => {
    const grouped = new Map<string, PermissionRow[]>();
    for (const p of catalog ?? []) {
      grouped.set(p.module, [...(grouped.get(p.module) ?? []), p]);
    }
    return grouped;
  }, [catalog]);

  function openEditor(role?: RoleRow) {
    setForm(
      role
        ? {
            id: role.id,
            key: role.key,
            nameAr: role.nameAr,
            nameEn: role.nameEn,
            grants: role.permissions.map((p) => ({
              permissionKey: p.permission.key,
              dataScope: p.dataScope,
            })),
          }
        : { key: '', nameAr: '', nameEn: '', grants: [] },
    );
  }

  function toggleGrant(form: FormState, key: string): FormState {
    const exists = form.grants.some((g) => g.permissionKey === key);
    return {
      ...form,
      grants: exists
        ? form.grants.filter((g) => g.permissionKey !== key)
        : [...form.grants, { permissionKey: key, dataScope: 'MY_RECORDS' }],
    };
  }

  if (isLoading) return <Spinner />;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('roles.title')}</h1>
        {canManage && <Button onClick={() => openEditor()}>{t('roles.create')}</Button>}
      </div>
      {error && <ErrorState message={error} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {roles?.map((role) => (
          <div key={role.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{pickName(locale, role)}</span>
                  <Badge tone={role.isSystem ? 'gray' : 'blue'}>
                    {role.isSystem ? t('roles.system') : t('roles.custom')}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-gray-400">{role.key}</div>
              </div>
              <div className="flex gap-2">
                {canManage && (
                  <Button variant="secondary" onClick={() => openEditor(role)}>
                    {t('roles.editGrants')}
                  </Button>
                )}
                {canManage && !role.isSystem && (
                  <Button
                    variant="danger"
                    onClick={() =>
                      window.confirm(t('common.confirmArchive')) && archive.mutate(role.id)
                    }
                  >
                    {t('common.archive')}
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {role.permissions.length === 0 && (
                <span className="text-sm text-gray-400">{t('common.empty')}</span>
              )}
              {role.permissions.map((p) => (
                <Badge key={p.permission.id} tone="gray">
                  {locale === 'ar' ? p.permission.labelAr : p.permission.labelEn} ·{' '}
                  {t(`roles.scope.${p.dataScope}`)}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? t('roles.editGrants') : t('roles.create')}
        wide
      >
        {form && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
          >
            {!form.id && (
              <Input
                label={t('roles.key')}
                required
                placeholder="CUSTOM_ROLE_KEY"
                value={form.key}
                onChange={(e) =>
                  setForm({ ...form, key: e.target.value.toUpperCase().replace(/\s+/g, '_') })
                }
              />
            )}
            <div className="grid grid-cols-2 gap-4">
              <Input
                label={t('common.nameAr')}
                required
                dir="rtl"
                value={form.nameAr}
                onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
              />
              <Input
                label={t('common.nameEn')}
                required
                dir="ltr"
                value={form.nameEn}
                onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
              />
            </div>

            {/* Permission matrix: action × data scope (§19.1) */}
            <div className="rounded-md border border-gray-200">
              {[...modules.entries()].map(([module, perms]) => (
                <div key={module} className="border-b border-gray-100 p-3 last:border-b-0">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {module}
                  </div>
                  <div className="flex flex-col gap-2">
                    {perms.map((p) => {
                      const grant = form.grants.find((g) => g.permissionKey === p.key);
                      return (
                        <div key={p.key} className="flex items-center justify-between gap-3">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={!!grant}
                              onChange={() => setForm(toggleGrant(form, p.key))}
                            />
                            {locale === 'ar' ? p.labelAr : p.labelEn}
                          </label>
                          {grant && (
                            <Select
                              className="w-44"
                              value={grant.dataScope}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  grants: form.grants.map((g) =>
                                    g.permissionKey === p.key
                                      ? { ...g, dataScope: e.target.value }
                                      : g,
                                  ),
                                })
                              }
                            >
                              {DATA_SCOPES.map((s) => (
                                <option key={s} value={s}>
                                  {t(`roles.scope.${s}`)}
                                </option>
                              ))}
                            </Select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
