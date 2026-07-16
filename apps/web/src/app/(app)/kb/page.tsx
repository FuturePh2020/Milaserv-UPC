'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { pickName } from '@/lib/names';
import type { Page } from '@/lib/types';
import type { CourseRow, KbContentRow } from '@/lib/kb-types';
import { Badge, Button, EmptyState, Input, Select, Spinner } from '@/components/ui';

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
      <div
        className="h-full rounded-full bg-[#0b2545] transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function KbPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [tab, setTab] = useState<'library' | 'courses'>('library');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');

  const { data: contents, isLoading: loadingContents } = useQuery({
    queryKey: ['kb-contents', kind, q],
    queryFn: () =>
      api<Page<KbContentRow>>(
        `/kb/contents?page=1&pageSize=50${kind ? `&kind=${kind}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
    enabled: tab === 'library',
  });

  const { data: courses, isLoading: loadingCourses } = useQuery({
    queryKey: ['kb-courses'],
    queryFn: () => api<CourseRow[]>('/kb/courses'),
    enabled: tab === 'courses',
  });

  const kinds = ['SOP', 'ADDED_SOP', 'DAILY_NOTE', 'VIDEO', 'PDF', 'WORD', 'FLOW_CHART'];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('kb.title')}</h1>
        <div className="flex gap-1">
          {(['library', 'courses'] as const).map((x) => (
            <button
              key={x}
              onClick={() => setTab(x)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === x ? 'bg-[#0b2545] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              {t(x === 'library' ? 'kb.library' : 'kb.myCourses')}
            </button>
          ))}
        </div>
      </div>

      {tab === 'library' && (
        <>
          <div className="mb-4 flex gap-2">
            <Input
              placeholder={t('common.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">{t('kb.kind')} —</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(`kb.kinds.${k}`)}
                </option>
              ))}
            </Select>
          </div>
          {loadingContents ? (
            <Spinner />
          ) : !contents || contents.items.length === 0 ? (
            <EmptyState message={t('common.empty')} />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {contents.items.map((c) => (
                <div key={c.id} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge tone="blue">{t(`kb.kinds.${c.kind}`)}</Badge>
                    <span className="text-xs text-gray-400">v{c.version}</span>
                  </div>
                  <div className="font-semibold text-gray-900">
                    {pickName(locale, {
                      nameAr: c.titleAr,
                      nameEn: c.titleEn,
                    })}
                  </div>
                  {(locale === 'ar' ? c.summaryAr : c.summaryEn) && (
                    <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                      {locale === 'ar' ? c.summaryAr : c.summaryEn}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                    <span>
                      {t('kb.owner')}: {pickName(locale, c.owner)}
                    </span>
                    {c.videoUrl && (
                      <a
                        href={c.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 underline"
                      >
                        🎬
                      </a>
                    )}
                  </div>
                  {c.body && (
                    <details className="mt-2 text-sm text-gray-600">
                      <summary className="cursor-pointer text-blue-700">{t('kb.open')}</summary>
                      <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'courses' &&
        (loadingCourses ? (
          <Spinner />
        ) : !courses || courses.length === 0 ? (
          <EmptyState message={t('common.empty')} />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {courses.map((c) => (
              <Link
                key={c.id}
                href={`/kb/courses/${c.id}`}
                className="rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
              >
                <div className="mb-1 flex items-center justify-between">
                  <Badge
                    tone={
                      c.myProgress?.status === 'COMPLETED'
                        ? 'green'
                        : c.myProgress?.status === 'IN_PROGRESS'
                          ? 'amber'
                          : 'gray'
                    }
                  >
                    {t(`kb.progressStates.${c.myProgress?.status ?? 'NOT_STARTED'}`)}
                  </Badge>
                  {c.dueAt && (
                    <span className="text-xs text-gray-400">
                      {t('kb.dueAt')}:{' '}
                      {new Date(c.dueAt).toLocaleDateString(locale === 'ar' ? 'ar' : 'en')}
                    </span>
                  )}
                </div>
                <div className="font-semibold text-gray-900">
                  {pickName(locale, { nameAr: c.titleAr, nameEn: c.titleEn })}
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  {t('kb.lessonCount', { count: c.lessonCount ?? 0 })}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <ProgressBar pct={c.myProgress?.progressPct ?? 0} />
                  <span className="text-xs font-medium text-gray-600">
                    {c.myProgress?.progressPct ?? 0}%
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ))}
      <div className="mt-6">
        <Button variant="ghost" onClick={() => window.history.back()}>
          ←
        </Button>
      </div>
    </div>
  );
}
