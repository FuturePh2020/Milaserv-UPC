'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickName } from '@/lib/names';
import type { DepartmentRow, Page, TeamRow, UserRow } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { Badge, Button, Dialog, ErrorState, Input, Select } from '@/components/ui';

interface FormState {
  id?: string;
  nameAr: string;
  nameEn: string;
  departmentId: string;
}

export default function TeamsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState | null>(null);
  const [membersFor, setMembersFor] = useState<string | null>(null);
  const [newMember, setNewMember] = useState({ userId: '', role: 'MEMBER' });
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['teams', page],
    queryFn: () => api<Page<TeamRow>>(`/teams?page=${page}&pageSize=20`),
  });

  const { data: teamDetail } = useQuery({
    queryKey: ['teams', 'detail', membersFor],
    queryFn: () => api<TeamRow>(`/teams/${membersFor}`),
    enabled: membersFor !== null,
  });

  const { data: departments } = useQuery({
    queryKey: ['departments', 'all'],
    queryFn: () => api<Page<DepartmentRow>>('/departments?page=1&pageSize=100'),
    enabled: hasPermission('department.view'),
  });

  const { data: users } = useQuery({
    queryKey: ['users', 'all'],
    queryFn: () => api<Page<UserRow>>('/users?page=1&pageSize=100'),
    enabled: hasPermission('user.view') && membersFor !== null,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['teams'] });
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : t('common.error'));

  const save = useMutation({
    mutationFn: (f: FormState) =>
      f.id
        ? api(`/teams/${f.id}`, {
            method: 'PATCH',
            body: { nameAr: f.nameAr, nameEn: f.nameEn, departmentId: f.departmentId },
          })
        : api('/teams', { method: 'POST', body: f }),
    onSuccess: () => {
      setForm(null);
      setError(null);
      invalidate();
    },
    onError,
  });

  const archive = useMutation({
    mutationFn: (id: string) => api(`/teams/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError,
  });

  const addMember = useMutation({
    mutationFn: ({ teamId, userId, role }: { teamId: string; userId: string; role: string }) =>
      api(`/teams/${teamId}/members`, { method: 'POST', body: { userId, role } }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError,
  });

  const removeMember = useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) =>
      api(`/teams/${teamId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError,
  });

  const canManage = hasPermission('team.manage');
  const canManageMembers = hasPermission('team.manage_members');

  const columns = useMemo<ColumnDef<TeamRow, unknown>[]>(
    () => [
      { header: t('users.name'), cell: ({ row }) => pickName(locale, row.original) },
      {
        header: t('teams.department'),
        cell: ({ row }) => pickName(locale, row.original.department),
      },
      { header: t('teams.membersCount'), cell: ({ row }) => row.original._count?.members ?? 0 },
      {
        header: t('common.status'),
        cell: ({ row }) => (
          <Badge tone={row.original.status === 'ACTIVE' ? 'green' : 'red'}>
            {row.original.status === 'ACTIVE' ? t('common.active') : t('common.inactive')}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            {canManageMembers && (
              <Button variant="secondary" onClick={() => setMembersFor(row.original.id)}>
                {t('teams.members')}
              </Button>
            )}
            {canManage && (
              <>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setForm({
                      id: row.original.id,
                      nameAr: row.original.nameAr,
                      nameEn: row.original.nameEn,
                      departmentId: row.original.department.id,
                    })
                  }
                >
                  {t('common.edit')}
                </Button>
                <Button
                  variant="danger"
                  onClick={() =>
                    window.confirm(t('common.confirmArchive')) && archive.mutate(row.original.id)
                  }
                >
                  {t('common.archive')}
                </Button>
              </>
            )}
          </div>
        ),
      },
    ],
    [t, locale, canManage, canManageMembers, archive],
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('teams.title')}</h1>
        {canManage && (
          <Button
            onClick={() =>
              setForm({ nameAr: '', nameEn: '', departmentId: departments?.items[0]?.id ?? '' })
            }
          >
            {t('teams.create')}
          </Button>
        )}
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

      {/* Create / edit team */}
      <Dialog
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? t('common.edit') : t('teams.create')}
      >
        {form && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
          >
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
            <Select
              label={t('teams.department')}
              required
              value={form.departmentId}
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
            >
              {departments?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {pickName(locale, d)}
                </option>
              ))}
            </Select>
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

      {/* Members */}
      <Dialog
        open={membersFor !== null}
        onClose={() => setMembersFor(null)}
        title={t('teams.members')}
        wide
      >
        {teamDetail && (
          <div className="flex flex-col gap-4">
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {(teamDetail.members ?? []).map((m) => (
                <li key={m.user.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <div className="font-medium">{pickName(locale, m.user)}</div>
                    <div className="text-gray-500">{m.user.email}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone="blue">
                      {m.role === 'LEADER'
                        ? t('teams.roleLeader')
                        : m.role === 'MANAGER'
                          ? t('teams.roleManager')
                          : t('teams.roleMember')}
                    </Badge>
                    <Button
                      variant="danger"
                      onClick={() =>
                        removeMember.mutate({ teamId: teamDetail.id, userId: m.user.id })
                      }
                    >
                      {t('teams.removeMember')}
                    </Button>
                  </div>
                </li>
              ))}
              {(teamDetail.members ?? []).length === 0 && (
                <li className="p-4 text-center text-sm text-gray-500">{t('common.empty')}</li>
              )}
            </ul>
            <form
              className="flex items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (newMember.userId) {
                  addMember.mutate({ teamId: teamDetail.id, ...newMember });
                }
              }}
            >
              <div className="flex-1">
                <Select
                  label={t('teams.addMember')}
                  value={newMember.userId}
                  onChange={(e) => setNewMember({ ...newMember, userId: e.target.value })}
                >
                  <option value="">—</option>
                  {users?.items
                    .filter((u) => !(teamDetail.members ?? []).some((m) => m.user.id === u.id))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {pickName(locale, u)} ({u.email})
                      </option>
                    ))}
                </Select>
              </div>
              <div className="w-40">
                <Select
                  label={t('teams.memberRole')}
                  value={newMember.role}
                  onChange={(e) => setNewMember({ ...newMember, role: e.target.value })}
                >
                  <option value="MEMBER">{t('teams.roleMember')}</option>
                  <option value="LEADER">{t('teams.roleLeader')}</option>
                  <option value="MANAGER">{t('teams.roleManager')}</option>
                </Select>
              </div>
              <Button type="submit" disabled={addMember.isPending || !newMember.userId}>
                {t('teams.addMember')}
              </Button>
            </form>
          </div>
        )}
      </Dialog>
    </div>
  );
}
