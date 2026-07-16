'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { pickName } from '@/lib/names';
import type { Page, TeamRow } from '@/lib/types';
import type { CourseRow, KbContentRow } from '@/lib/kb-types';
import { Badge, Button, Dialog, ErrorState, Input, Select, Spinner } from '@/components/ui';

const KINDS = ['SOP', 'ADDED_SOP', 'DAILY_NOTE', 'VIDEO', 'PDF', 'WORD', 'FLOW_CHART'];

export default function KbAdminPage() {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'contents' | 'courses'>('contents');
  const [error, setError] = useState<string | null>(null);
  const [contentForm, setContentForm] = useState<{
    kind: string;
    titleAr: string;
    titleEn: string;
    body: string;
    videoUrl: string;
  } | null>(null);
  const [courseForm, setCourseForm] = useState<{ titleAr: string; titleEn: string } | null>(null);
  const [lessonFor, setLessonFor] = useState<string | null>(null);
  const [lessonForm, setLessonForm] = useState({ titleAr: '', titleEn: '', videoUrl: '' });
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [assignTeams, setAssignTeams] = useState<string[]>([]);

  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : t('common.error'));
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['kb-admin-contents'] });
    void queryClient.invalidateQueries({ queryKey: ['kb-admin-courses'] });
  };

  const { data: contents, isLoading: loadingContents } = useQuery({
    queryKey: ['kb-admin-contents'],
    queryFn: () => api<Page<KbContentRow>>('/kb/contents?page=1&pageSize=100'),
    enabled: tab === 'contents',
  });
  const { data: courses, isLoading: loadingCourses } = useQuery({
    queryKey: ['kb-admin-courses'],
    queryFn: () => api<CourseRow[]>('/kb/courses'),
    enabled: tab === 'courses',
  });
  const { data: teams } = useQuery({
    queryKey: ['teams', 'assignable'],
    queryFn: () => api<Page<TeamRow>>('/teams?page=1&pageSize=100'),
    enabled: assignFor !== null,
  });

  const call = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: string; body?: unknown }) =>
      api(path, { method, body }),
    onSuccess: () => {
      setError(null);
      setContentForm(null);
      setCourseForm(null);
      setLessonFor(null);
      setAssignFor(null);
      invalidate();
    },
    onError,
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('kb.manage')}</h1>
        <div className="flex gap-1">
          {(['contents', 'courses'] as const).map((x) => (
            <button
              key={x}
              onClick={() => setTab(x)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === x ? 'bg-[#0b2545] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              {t(x === 'contents' ? 'kb.library' : 'kb.myCourses')}
            </button>
          ))}
        </div>
      </div>
      {error && <ErrorState message={error} />}

      {tab === 'contents' && (
        <>
          <div className="mb-3 flex justify-end">
            <Button
              onClick={() =>
                setContentForm({ kind: 'SOP', titleAr: '', titleEn: '', body: '', videoUrl: '' })
              }
            >
              {t('kb.newContent')}
            </Button>
          </div>
          {loadingContents ? (
            <Spinner />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-start">{t('kb.kind')}</th>
                    <th className="px-4 py-2 text-start">{t('users.name')}</th>
                    <th className="px-4 py-2 text-start">{t('kb.version')}</th>
                    <th className="px-4 py-2 text-start">{t('kb.statusL')}</th>
                    <th className="px-4 py-2 text-start">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {contents?.items.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2">
                        <Badge tone="blue">{t(`kb.kinds.${c.kind}`)}</Badge>
                      </td>
                      <td className="px-4 py-2">
                        {pickName(locale, { nameAr: c.titleAr, nameEn: c.titleEn })}
                      </td>
                      <td className="px-4 py-2">v{c.version}</td>
                      <td className="px-4 py-2">
                        <Badge
                          tone={
                            c.status === 'PUBLISHED'
                              ? 'green'
                              : c.status === 'DRAFT'
                                ? 'amber'
                                : 'gray'
                          }
                        >
                          {t(`kb.statuses.${c.status}`)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-2">
                          {c.status === 'DRAFT' && (
                            <Button
                              variant="secondary"
                              onClick={() =>
                                call.mutate({
                                  path: `/kb/contents/${c.id}/publish`,
                                  method: 'POST',
                                })
                              }
                            >
                              {t('kb.publish')}
                            </Button>
                          )}
                          {c.status === 'PUBLISHED' && (
                            <Button
                              variant="secondary"
                              onClick={() =>
                                call.mutate({
                                  path: `/kb/contents/${c.id}/new-version`,
                                  method: 'POST',
                                })
                              }
                            >
                              {t('kb.newVersion')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'courses' && (
        <>
          <div className="mb-3 flex justify-end">
            <Button onClick={() => setCourseForm({ titleAr: '', titleEn: '' })}>
              {t('kb.newCourse')}
            </Button>
          </div>
          {loadingCourses ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {courses?.map((c) => (
                <div key={c.id} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-gray-900">
                      {pickName(locale, { nameAr: c.titleAr, nameEn: c.titleEn })}
                    </div>
                    <Badge tone={c.status === 'PUBLISHED' ? 'green' : 'amber'}>
                      {t(`kb.statuses.${c.status}`)}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    {t('kb.lessonCount', { count: c.lessonCount ?? 0 })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setLessonFor(c.id)}>
                      {t('kb.addLesson')}
                    </Button>
                    {c.status !== 'PUBLISHED' && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          call.mutate({ path: `/kb/courses/${c.id}/publish`, method: 'POST' })
                        }
                      >
                        {t('kb.publish')}
                      </Button>
                    )}
                    <Button
                      onClick={() => {
                        setAssignFor(c.id);
                        setAssignTeams([]);
                      }}
                    >
                      {t('kb.assign')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* New content */}
      <Dialog
        open={contentForm !== null}
        onClose={() => setContentForm(null)}
        title={t('kb.newContent')}
      >
        {contentForm && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              call.mutate({
                path: '/kb/contents',
                method: 'POST',
                body: {
                  kind: contentForm.kind,
                  titleAr: contentForm.titleAr,
                  titleEn: contentForm.titleEn,
                  body: contentForm.body || undefined,
                  videoUrl: contentForm.videoUrl || undefined,
                },
              });
            }}
          >
            <Select
              label={t('kb.kind')}
              value={contentForm.kind}
              onChange={(e) => setContentForm({ ...contentForm, kind: e.target.value })}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kb.kinds.${k}`)}
                </option>
              ))}
            </Select>
            <Input
              label={t('kb.titleArL')}
              required
              dir="rtl"
              value={contentForm.titleAr}
              onChange={(e) => setContentForm({ ...contentForm, titleAr: e.target.value })}
            />
            <Input
              label={t('kb.titleEnL')}
              required
              dir="ltr"
              value={contentForm.titleEn}
              onChange={(e) => setContentForm({ ...contentForm, titleEn: e.target.value })}
            />
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">{t('kb.body')}</span>
              <textarea
                rows={4}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={contentForm.body}
                onChange={(e) => setContentForm({ ...contentForm, body: e.target.value })}
              />
            </label>
            <Input
              label={t('kb.videoUrl')}
              dir="ltr"
              value={contentForm.videoUrl}
              onChange={(e) => setContentForm({ ...contentForm, videoUrl: e.target.value })}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setContentForm(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={call.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* New course */}
      <Dialog
        open={courseForm !== null}
        onClose={() => setCourseForm(null)}
        title={t('kb.newCourse')}
      >
        {courseForm && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              call.mutate({ path: '/kb/courses', method: 'POST', body: courseForm });
            }}
          >
            <Input
              label={t('kb.titleArL')}
              required
              dir="rtl"
              value={courseForm.titleAr}
              onChange={(e) => setCourseForm({ ...courseForm, titleAr: e.target.value })}
            />
            <Input
              label={t('kb.titleEnL')}
              required
              dir="ltr"
              value={courseForm.titleEn}
              onChange={(e) => setCourseForm({ ...courseForm, titleEn: e.target.value })}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCourseForm(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={call.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Add lesson */}
      <Dialog
        open={lessonFor !== null}
        onClose={() => setLessonFor(null)}
        title={t('kb.addLesson')}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            call.mutate({
              path: `/kb/courses/${lessonFor}/lessons`,
              method: 'POST',
              body: {
                titleAr: lessonForm.titleAr,
                titleEn: lessonForm.titleEn,
                videoUrl: lessonForm.videoUrl || undefined,
              },
            });
            setLessonForm({ titleAr: '', titleEn: '', videoUrl: '' });
          }}
        >
          <Input
            label={t('kb.titleArL')}
            required
            dir="rtl"
            value={lessonForm.titleAr}
            onChange={(e) => setLessonForm({ ...lessonForm, titleAr: e.target.value })}
          />
          <Input
            label={t('kb.titleEnL')}
            required
            dir="ltr"
            value={lessonForm.titleEn}
            onChange={(e) => setLessonForm({ ...lessonForm, titleEn: e.target.value })}
          />
          <Input
            label={t('kb.videoUrl')}
            dir="ltr"
            value={lessonForm.videoUrl}
            onChange={(e) => setLessonForm({ ...lessonForm, videoUrl: e.target.value })}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setLessonFor(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={call.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Assign course */}
      <Dialog
        open={assignFor !== null}
        onClose={() => setAssignFor(null)}
        title={t('kb.assignTeams')}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (assignTeams.length) {
              call.mutate({
                path: `/kb/courses/${assignFor}/assign`,
                method: 'POST',
                body: { teamIds: assignTeams },
              });
            }
          }}
        >
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border border-gray-200 p-2">
            {teams?.items.map((team) => (
              <label key={team.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={assignTeams.includes(team.id)}
                  onChange={(e) =>
                    setAssignTeams(
                      e.target.checked
                        ? [...assignTeams, team.id]
                        : assignTeams.filter((x) => x !== team.id),
                    )
                  }
                />
                {pickName(locale, team)}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAssignFor(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!assignTeams.length || call.isPending}>
              {t('kb.assign')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
