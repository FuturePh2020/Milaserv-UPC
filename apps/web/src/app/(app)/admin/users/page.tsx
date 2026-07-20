'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickName } from '@/lib/names';
import type { DepartmentRow, Page, RoleRow, UserRow } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { Badge, Button, Dialog, ErrorState, Input, Select } from '@/components/ui';

interface CreateForm {
  email: string;
  temporaryPassword: string;
  nameAr: string;
  nameEn: string;
  phone: string;
  departmentId: string;
  roleIds: string[];
}

interface EditForm {
  id: string;
  nameAr: string;
  nameEn: string;
  phone: string;
  departmentId: string;
}

const EMPTY_CREATE: CreateForm = {
  email: '',
  temporaryPassword: '',
  nameAr: '',
  nameEn: '',
  phone: '',
  departmentId: '',
  roleIds: [],
};

export default function UsersPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { hasPermission, me } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [createForm, setCreateForm] = useState<CreateForm | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [rolesFor, setRolesFor] = useState<UserRow | null>(null);
  const [roleSelection, setRoleSelection] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users', page, search],
    queryFn: () =>
      api<Page<UserRow>>(
        `/users?page=${page}&pageSize=20${search ? `&q=${encodeURIComponent(search)}` : ''}`,
      ),
  });

  const { data: departments } = useQuery({
    queryKey: ['departments', 'all'],
    queryFn: () => api<Page<DepartmentRow>>('/departments?page=1&pageSize=100'),
    enabled: hasPermission('department.view'),
  });

  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api<RoleRow[]>('/roles'),
    enabled: hasPermission('role.view'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : t('common.error'));

  const create = useMutation({
    mutationFn: (f: CreateForm) =>
      api('/users', {
        method: 'POST',
        body: {
          email: f.email,
          temporaryPassword: f.temporaryPassword,
          nameAr: f.nameAr,
          nameEn: f.nameEn,
          phone: f.phone || undefined,
          departmentId: f.departmentId || undefined,
          roleIds: f.roleIds.length ? f.roleIds : undefined,
        },
      }),
    onSuccess: () => {
      setCreateForm(null);
      setError(null);
      void invalidate();
    },
    onError,
  });

  const edit = useMutation({
    mutationFn: (f: EditForm) =>
      api(`/users/${f.id}`, {
        method: 'PATCH',
        body: {
          nameAr: f.nameAr,
          nameEn: f.nameEn,
          phone: f.phone || undefined,
          departmentId: f.departmentId || undefined,
        },
      }),
    onSuccess: () => {
      setEditForm(null);
      setError(null);
      void invalidate();
    },
    onError,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'INACTIVE' }) =>
      api(`/users/${id}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: () => void invalidate(),
    onError,
  });

  const setRoles = useMutation({
    mutationFn: ({ id, roleIds }: { id: string; roleIds: string[] }) =>
      api(`/users/${id}/roles`, { method: 'PUT', body: { roleIds } }),
    onSuccess: () => {
      setRolesFor(null);
      setError(null);
      void invalidate();
    },
    onError,
  });

  const canCreate = hasPermission('user.create');
  const canEdit = hasPermission('user.edit');
  const canDeactivate = hasPermission('user.deactivate');
  const canAssignRoles = hasPermission('user.assign_roles');

  const columns = useMemo<ColumnDef<UserRow, unknown>[]>(
    () => [
      { header: t('users.email'), accessorKey: 'email' },
      { header: t('users.name'), cell: ({ row }) => pickName(locale, row.original) },
      {
        header: t('users.department'),
        cell: ({ row }) =>
          row.original.department
            ? pickName(locale, row.original.department)
            : t('users.noDepartment'),
      },
      {
        header: t('users.rolesCol'),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.roles.map((r) => (
              <Badge key={r.role.id} tone="blue">
                {pickName(locale, r.role)}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        header: t('common.status'),
        cell: ({ row }) => (
          <Badge tone={row.original.status === 'ACTIVE' ? 'green' : 'red'}>
            {row.original.status === 'ACTIVE' ? t('common.active') : t('common.inactive')}
          </Badge>
        ),
      },
      {
        header: t('users.lastSignIn'),
        cell: ({ row }) =>
          row.original.lastSignInAt
            ? new Date(row.original.lastSignInAt).toLocaleString(locale === 'ar' ? 'ar' : 'en')
            : '—',
      },
      {
        id: 'actions',
        header: t('common.actions'),
        cell: ({ row }) => {
          const u = row.original;
          return (
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setEditForm({
                      id: u.id,
                      nameAr: u.nameAr,
                      nameEn: u.nameEn,
                      phone: u.phone ?? '',
                      departmentId: u.department?.id ?? '',
                    })
                  }
                >
                  {t('common.edit')}
                </Button>
              )}
              {canAssignRoles && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRolesFor(u);
                    setRoleSelection(u.roles.map((r) => r.role.id));
                  }}
                >
                  {t('users.assignRoles')}
                </Button>
              )}
              {canDeactivate && u.id !== me?.id && (
                <Button
                  variant={u.status === 'ACTIVE' ? 'danger' : 'primary'}
                  onClick={() =>
                    setStatus.mutate({
                      id: u.id,
                      status: u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                    })
                  }
                >
                  {u.status === 'ACTIVE' ? t('users.deactivate') : t('users.activate')}
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [t, locale, canEdit, canAssignRoles, canDeactivate, me, setStatus],
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('users.title')}</h1>
        <div className="flex items-center gap-3">
          <Input
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {canCreate && (
            <Button onClick={() => setCreateForm(EMPTY_CREATE)}>{t('users.create')}</Button>
          )}
        </div>
      </div>
      {error && <ErrorState message={error} />}
      <DataTable
        columns={columns}
        data={data?.items}
        isLoading={isLoading}
        total={data?.total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
      />

      {/* Create user */}
      <Dialog
        open={createForm !== null}
        onClose={() => setCreateForm(null)}
        title={t('users.create')}
      >
        {createForm && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(createForm);
            }}
          >
            <Input
              label={t('users.email')}
              type="email"
              required
              value={createForm.email}
              onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
            />
            <div>
              <Input
                label={t('users.tempPassword')}
                type="text"
                required
                minLength={10}
                value={createForm.temporaryPassword}
                onChange={(e) =>
                  setCreateForm({ ...createForm, temporaryPassword: e.target.value })
                }
              />
              <p className="mt-1 text-xs text-gray-500">{t('users.tempPasswordHint')}</p>
            </div>
            <Input
              label={t('common.nameAr')}
              required
              dir="rtl"
              value={createForm.nameAr}
              onChange={(e) => setCreateForm({ ...createForm, nameAr: e.target.value })}
            />
            <Input
              label={t('common.nameEn')}
              required
              dir="ltr"
              value={createForm.nameEn}
              onChange={(e) => setCreateForm({ ...createForm, nameEn: e.target.value })}
            />
            <Input
              label={t('users.phone')}
              value={createForm.phone}
              onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
            />
            <Select
              label={t('users.department')}
              value={createForm.departmentId}
              onChange={(e) => setCreateForm({ ...createForm, departmentId: e.target.value })}
            >
              <option value="">{t('users.noDepartment')}</option>
              {departments?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {pickName(locale, d)}
                </option>
              ))}
            </Select>
            {canAssignRoles && roles && (
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-gray-700">
                  {t('users.rolesCol')}
                </legend>
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-gray-200 p-2">
                  {roles.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={createForm.roleIds.includes(r.id)}
                        onChange={(e) =>
                          setCreateForm({
                            ...createForm,
                            roleIds: e.target.checked
                              ? [...createForm.roleIds, r.id]
                              : createForm.roleIds.filter((id) => id !== r.id),
                          })
                        }
                      />
                      {pickName(locale, r)}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCreateForm(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Edit user */}
      <Dialog open={editForm !== null} onClose={() => setEditForm(null)} title={t('common.edit')}>
        {editForm && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              edit.mutate(editForm);
            }}
          >
            <Input
              label={t('common.nameAr')}
              required
              dir="rtl"
              value={editForm.nameAr}
              onChange={(e) => setEditForm({ ...editForm, nameAr: e.target.value })}
            />
            <Input
              label={t('common.nameEn')}
              required
              dir="ltr"
              value={editForm.nameEn}
              onChange={(e) => setEditForm({ ...editForm, nameEn: e.target.value })}
            />
            <Input
              label={t('users.phone')}
              value={editForm.phone}
              onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
            />
            <Select
              label={t('users.department')}
              value={editForm.departmentId}
              onChange={(e) => setEditForm({ ...editForm, departmentId: e.target.value })}
            >
              <option value="">{t('users.noDepartment')}</option>
              {departments?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {pickName(locale, d)}
                </option>
              ))}
            </Select>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditForm(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={edit.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Assign roles */}
      <Dialog
        open={rolesFor !== null}
        onClose={() => setRolesFor(null)}
        title={t('users.assignRoles')}
      >
        {rolesFor && roles && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setRoles.mutate({ id: rolesFor.id, roleIds: roleSelection });
            }}
          >
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border border-gray-200 p-2">
              {roles.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={roleSelection.includes(r.id)}
                    onChange={(e) =>
                      setRoleSelection(
                        e.target.checked
                          ? [...roleSelection, r.id]
                          : roleSelection.filter((id) => id !== r.id),
                      )
                    }
                  />
                  {pickName(locale, r)}
                  {r.isSystem && <Badge tone="gray">{t('roles.system')}</Badge>}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRolesFor(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={setRoles.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
