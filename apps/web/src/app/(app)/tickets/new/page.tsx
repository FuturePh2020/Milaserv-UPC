'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { pickName } from '@/lib/names';
import type { Page } from '@/lib/types';
import type { BranchRow, TicketCatalogs, TicketRow } from '@/lib/ticket-types';
import { Button, ErrorState, Input, Select } from '@/components/ui';

export default function NewTicketPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [typeKey, setTypeKey] = useState('INTERNAL');
  const [categoryKey, setCategoryKey] = useState('');
  const [urgencyKey, setUrgencyKey] = useState('MODERATE');
  const [branchId, setBranchId] = useState('');
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    subject: '',
    description: '',
    relatedOrderNo: '',
    sapMaterialNo: '',
    itemNameAr: '',
    itemNameEn: '',
  });

  const { data: catalogs } = useQuery({
    queryKey: ['ticket-config'],
    queryFn: () => api<TicketCatalogs>('/ticket-config'),
    staleTime: 300_000,
  });

  const { data: branches } = useQuery({
    queryKey: ['branches', 'all'],
    queryFn: () => api<Page<BranchRow>>('/branches?page=1&pageSize=100&status=ACTIVE'),
    enabled: typeKey === 'BRANCH',
  });

  const type = useMemo(() => catalogs?.types.find((x) => x.key === typeKey), [catalogs, typeKey]);
  const branch = useMemo(
    () => branches?.items.find((b) => b.id === branchId),
    [branches, branchId],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<TicketRow>('/tickets', {
        method: 'POST',
        body: {
          typeKey,
          categoryKey,
          urgencyKey,
          customerName: form.customerName,
          customerPhone: form.customerPhone,
          subject: form.subject,
          description: form.description,
          relatedOrderNo: form.relatedOrderNo || undefined,
          sapMaterialNo: form.sapMaterialNo || undefined,
          itemNameAr: form.itemNameAr || undefined,
          itemNameEn: form.itemNameEn || undefined,
          branchId: typeKey === 'BRANCH' ? branchId : undefined,
        },
      });
      router.replace(`/tickets/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold text-gray-900">{t('tickets.create')}</h1>
      {error && <ErrorState message={error} />}
      <form
        onSubmit={submit}
        className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-5"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Select
            label={t('tickets.type')}
            value={typeKey}
            onChange={(e) => {
              setTypeKey(e.target.value);
              setCategoryKey('');
              setBranchId('');
            }}
          >
            {catalogs?.types.map((x) => (
              <option key={x.key} value={x.key}>
                {pickName(locale, x)}
              </option>
            ))}
          </Select>
          <Select
            label={t('tickets.category')}
            required
            value={categoryKey}
            onChange={(e) => setCategoryKey(e.target.value)}
          >
            <option value="">—</option>
            {type?.categories.map((c) => (
              <option key={c.key} value={c.key}>
                {pickName(locale, c)}
              </option>
            ))}
          </Select>
          <Select
            label={t('tickets.urgency')}
            value={urgencyKey}
            onChange={(e) => setUrgencyKey(e.target.value)}
          >
            {catalogs?.urgencies.map((u) => (
              <option key={u.key} value={u.key}>
                {pickName(locale, u)}
              </option>
            ))}
          </Select>
        </div>

        {typeKey === 'BRANCH' && (
          <div className="rounded-md border border-blue-100 bg-blue-50 p-3">
            <Select
              label={t('tickets.branch')}
              required
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">—</option>
              {branches?.items.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {pickName(locale, b)}
                </option>
              ))}
            </Select>
            {branch && (
              <div className="mt-3 text-sm">
                <div className="font-medium text-gray-700">{t('tickets.supervisor')}</div>
                {branch.supervisorName ? (
                  <div className="mt-1 rounded-md bg-white p-2 text-gray-700">
                    {branch.supervisorName}
                    {branch.supervisorEmail && (
                      <span className="text-gray-400" dir="ltr">
                        {' '}
                        · {branch.supervisorEmail}
                      </span>
                    )}
                    {branch.supervisorPhone && (
                      <span className="text-gray-400" dir="ltr">
                        {' '}
                        · {branch.supervisorPhone}
                      </span>
                    )}
                    <div className="mt-1 text-xs text-gray-400">{t('tickets.supervisorHint')}</div>
                  </div>
                ) : (
                  <div className="mt-1 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                    {t('tickets.noSupervisor')}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={t('tickets.customerName')}
            required
            value={form.customerName}
            onChange={(e) => setForm({ ...form, customerName: e.target.value })}
          />
          <Input
            label={t('tickets.customerPhone')}
            required
            dir="ltr"
            value={form.customerPhone}
            onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
          />
        </div>
        <Input
          label={t('tickets.subject')}
          required
          value={form.subject}
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
        />
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t('tickets.description')}
          </span>
          <textarea
            required
            rows={4}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#0b2545]"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={t('tickets.relatedOrderNo')}
            value={form.relatedOrderNo}
            onChange={(e) => setForm({ ...form, relatedOrderNo: e.target.value })}
          />
          <Input
            label={t('tickets.sapMaterialNo')}
            value={form.sapMaterialNo}
            onChange={(e) => setForm({ ...form, sapMaterialNo: e.target.value })}
          />
          <Input
            label={t('tickets.itemNameAr')}
            dir="rtl"
            value={form.itemNameAr}
            onChange={(e) => setForm({ ...form, itemNameAr: e.target.value })}
          />
          <Input
            label={t('tickets.itemNameEn')}
            dir="ltr"
            value={form.itemNameEn}
            onChange={(e) => setForm({ ...form, itemNameEn: e.target.value })}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={busy || !categoryKey || (typeKey === 'BRANCH' && !branchId)}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
