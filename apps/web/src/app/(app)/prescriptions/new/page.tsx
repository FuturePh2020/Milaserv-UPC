'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { Button, ErrorState, Input } from '@/components/ui';

/** CR-001 Sprint OCR-02 Extension — minimal creation step; the actual
 * drag-and-drop upload and preview/crop workspace live on the detail
 * page (`/prescriptions/[id]`) once a prescription exists, mirroring how
 * `/tickets/new` only collects the fields needed before handing off. */
export default function NewPrescriptionPage() {
  const t = useTranslations();
  const router = useRouter();
  const [note, setNote] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>('/prescriptions', {
        method: 'POST',
        body: { note: note || undefined, source: source || undefined },
      });
      router.replace(`/prescriptions/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-4 text-2xl font-bold text-gray-900">{t('ocr.intake.newTitle')}</h1>
      <p className="mb-4 text-sm text-gray-500">{t('ocr.intake.newHint')}</p>
      {error && <ErrorState message={error} />}
      <form
        onSubmit={submit}
        className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-5"
      >
        <Input
          label={t('ocr.intake.note')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Input
          label={t('ocr.intake.source')}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('ocr.intake.createBtn')}
          </Button>
        </div>
      </form>
    </div>
  );
}
