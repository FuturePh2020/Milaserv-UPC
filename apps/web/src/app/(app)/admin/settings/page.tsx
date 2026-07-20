'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { SettingRow } from '@/lib/types';
import { Badge, Button, ErrorState, Input, Spinner } from '@/components/ui';

function ValueEditor({
  setting,
  disabled,
  onSave,
}: {
  setting: SettingRow;
  disabled: boolean;
  onSave: (value: unknown) => void;
}) {
  const t = useTranslations();
  const [draft, setDraft] = useState<string>(() =>
    setting.valueType === 'JSON' ? JSON.stringify(setting.value) : String(setting.value),
  );
  const [jsonError, setJsonError] = useState(false);

  if (setting.valueType === 'BOOLEAN') {
    return (
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          disabled={disabled}
          checked={setting.value === true}
          onChange={(e) => onSave(e.target.checked)}
        />
        <span className="text-sm text-gray-600">
          {setting.value === true ? t('common.yes') : t('common.no')}
        </span>
      </label>
    );
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (setting.valueType === 'NUMBER') return onSave(Number(draft));
        if (setting.valueType === 'JSON') {
          try {
            onSave(JSON.parse(draft));
            setJsonError(false);
          } catch {
            setJsonError(true);
          }
          return;
        }
        onSave(draft);
      }}
    >
      <Input
        className="w-72 font-mono text-xs"
        disabled={disabled}
        value={draft}
        error={jsonError ? 'Invalid JSON' : undefined}
        onChange={(e) => setDraft(e.target.value)}
      />
      {!disabled && (
        <Button type="submit" variant="secondary">
          {t('common.save')}
        </Button>
      )}
    </form>
  );
}

export default function SettingsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<SettingRow[]>('/settings'),
  });

  const put = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      api(`/settings/${key}`, { method: 'PUT', body: { value } }),
    onSuccess: (_d, vars) => {
      setError(null);
      setSaved(vars.key);
      setTimeout(() => setSaved(null), 2000);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const canManage = hasPermission('setting.manage');

  const byCategory = useMemo(() => {
    const grouped = new Map<string, SettingRow[]>();
    for (const s of settings ?? []) {
      if (s.scopeLevel !== 'SYSTEM') continue; // overrides are managed per-scope later
      grouped.set(s.category, [...(grouped.get(s.category) ?? []), s]);
    }
    return grouped;
  }, [settings]);

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-2xl font-bold text-gray-900">{t('settings.title')}</h1>
      {error && <ErrorState message={error} />}
      {[...byCategory.entries()].map(([category, rows]) => (
        <div key={category} className="mb-6 rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            {category}
          </div>
          <div className="divide-y divide-gray-100">
            {rows.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-gray-800">
                    {locale === 'ar' ? s.labelAr : s.labelEn}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                    <code>{s.key}</code>
                    <Badge tone="gray">{s.valueType}</Badge>
                    {saved === s.key && <Badge tone="green">{t('settings.updated')}</Badge>}
                  </div>
                </div>
                <ValueEditor
                  setting={s}
                  disabled={!canManage}
                  onSave={(value) => put.mutate({ key: s.key, value })}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
