'use client';

import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickName } from '@/lib/names';
import type { CourseDetail, TraineeProgressRow } from '@/lib/kb-types';
import { Badge, Button, ErrorState, Spinner } from '@/components/ui';
import { useState } from 'react';

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations();
  const locale = useLocale();
  const { hasPermission, me } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: course, isLoading } = useQuery({
    queryKey: ['kb-course', id],
    queryFn: () => api<CourseDetail>(`/kb/courses/${id}`),
  });

  const canSeeTrainees =
    hasPermission('kb.manage') || hasPermission('kb.assign') || course?.courseAdmin?.id === me?.id;

  const { data: trainees } = useQuery({
    queryKey: ['kb-course-progress', id],
    queryFn: () => api<TraineeProgressRow[]>(`/kb/courses/${id}/progress`),
    enabled: Boolean(course) && canSeeTrainees,
  });

  const progress = useMutation({
    mutationFn: ({ lessonId, completed }: { lessonId: string; completed: boolean }) =>
      api(`/kb/lessons/${lessonId}/progress`, { method: 'POST', body: { completed } }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['kb-course', id] });
      void queryClient.invalidateQueries({ queryKey: ['kb-course-progress', id] });
      void queryClient.invalidateQueries({ queryKey: ['kb-courses'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  if (isLoading || !course) return <Spinner />;

  return (
    <div className="max-w-4xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">
          {pickName(locale, { nameAr: course.titleAr, nameEn: course.titleEn })}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <Badge
            tone={
              course.myProgress.status === 'COMPLETED'
                ? 'green'
                : course.myProgress.status === 'IN_PROGRESS'
                  ? 'amber'
                  : 'gray'
            }
          >
            {t(`kb.progressStates.${course.myProgress.status}`)} · {course.myProgress.progressPct}%
          </Badge>
          <span>
            {t('kb.courseAdmin')}: {course.courseAdmin ? pickName(locale, course.courseAdmin) : '—'}
          </span>
          {course.dueAt && (
            <span>
              {t('kb.dueAt')}:{' '}
              {new Date(course.dueAt).toLocaleDateString(locale === 'ar' ? 'ar' : 'en')}
            </span>
          )}
        </div>
        {(locale === 'ar' ? course.descriptionAr : course.descriptionEn) && (
          <p className="mt-2 text-gray-600">
            {locale === 'ar' ? course.descriptionAr : course.descriptionEn}
          </p>
        )}
      </div>
      {error && <ErrorState message={error} />}

      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3 font-semibold text-gray-800">
          {t('kb.lessons')}
        </div>
        <ul className="divide-y divide-gray-100">
          {course.lessons.map((l) => {
            const done = Boolean(l.myProgress?.completedAt);
            return (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {done ? '✓' : l.order}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-gray-800">
                      {pickName(locale, { nameAr: l.titleAr, nameEn: l.titleEn })}
                    </div>
                    <div className="flex gap-3 text-xs text-gray-400">
                      {(l.videoUrl ?? l.content?.videoUrl) && (
                        <a
                          href={l.videoUrl ?? l.content?.videoUrl ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-700 underline"
                        >
                          🎬 {t('kb.kinds.VIDEO')}
                        </a>
                      )}
                      {l.myProgress && l.myProgress.watchTimeSeconds > 0 && (
                        <span>
                          {t('kb.watchTime')}: {Math.round(l.myProgress.watchTimeSeconds / 60)}m
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  variant={done ? 'secondary' : 'primary'}
                  disabled={progress.isPending || done}
                  onClick={() => progress.mutate({ lessonId: l.id, completed: true })}
                >
                  {done ? t('kb.completedL') : t('kb.markComplete')}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      {canSeeTrainees && trainees && (
        <section className="mt-6 rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3 font-semibold text-gray-800">
            {t('kb.trainees')}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 text-start">{t('users.name')}</th>
                <th className="px-4 py-2 text-start">{t('kb.progress')}</th>
                <th className="px-4 py-2 text-start">{t('kb.lastActivity')}</th>
                <th className="px-4 py-2 text-start">{t('kb.lastSignIn')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {trainees.map((r) => (
                <tr key={r.user.id}>
                  <td className="px-4 py-2">{pickName(locale, r.user)}</td>
                  <td className="px-4 py-2">
                    <Badge
                      tone={
                        r.status === 'COMPLETED'
                          ? 'green'
                          : r.status === 'IN_PROGRESS'
                            ? 'amber'
                            : 'gray'
                      }
                    >
                      {t(`kb.progressStates.${r.status}`)} · {r.progressPct}%
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {r.lastActivityAt
                      ? new Date(r.lastActivityAt).toLocaleString(locale === 'ar' ? 'ar' : 'en')
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {r.user.lastSignInAt
                      ? new Date(r.user.lastSignInAt).toLocaleString(locale === 'ar' ? 'ar' : 'en')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
