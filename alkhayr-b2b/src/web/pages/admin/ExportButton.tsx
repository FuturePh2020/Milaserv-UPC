import { useState } from 'react';
import type { ApiFailure, ApiResult } from '../../api/client.ts';
import { offerDownload } from '../../download.ts';
import { Button } from '../../components/Button.tsx';
import { ErrorState, Notice } from '../../components/Feedback.tsx';
import { Ltr } from '../../components/Text.tsx';
import { useIdentity } from '../../session/identity.tsx';
import { ReauthPanel } from './Reauth.tsx';

/**
 * Requests a server-generated CSV and hands it to the browser's download mechanism. Exports need
 * recent authentication: on 428 the dedicated sign-in panel is shown and the export must be
 * requested AGAIN by the operator (never automatically). A refused (too large) export is explained;
 * nothing is truncated. The page does not claim the file was saved — only that it was offered.
 */
export function ExportButton({
  label,
  run,
  note,
  view = true,
}: {
  label: string;
  run: () => Promise<ApiResult<{ blob: Blob; filename: string; omittedNames: number }>>;
  note?: string;
  /** View exports are for reading, not for re-import. */
  view?: boolean;
}) {
  const { handleAuthFailure } = useIdentity();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [reauth, setReauth] = useState(false);
  const [offered, setOffered] = useState<{ filename: string; omitted: number } | null>(null);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setOffered(null);
    const r = await run();
    setBusy(false);
    if (r.ok) {
      offerDownload(r.data.blob, r.data.filename);
      setOffered({ filename: r.data.filename, omitted: r.data.omittedNames });
      return;
    }
    if (r.kind === 'reauth_required') return setReauth(true);
    if (!handleAuthFailure(r)) setFailure(r);
  };
  return (
    <div className="stack">
      <div>
        <Button variant="secondary" icon="download" busy={busy} busyLabel="جارٍ إنشاء الملف…" onClick={() => void go()}>
          {label}
        </Button>
      </div>
      {view ? <p className="muted c-export-note">ملف CSV للقراءة في برامج الجداول، وليس للاستيراد. النص الذي قد يُفسَّر كمعادلة يبدأ بعلامة ' في الملف فقط.{note ? ` ${note}` : ''}</p> : note ? <p className="muted c-export-note">{note}</p> : null}
      {reauth ? (
        <ReauthPanel
          onDone={() => {
            setReauth(false); // the export is NOT requested automatically; press the button again
          }}
        />
      ) : null}
      {offered ? (
        <Notice tone="success">
          <p>
            أُنشئ الملف <Ltr mono>{offered.filename}</Ltr> وسُلّم إلى المتصفح للتنزيل. تحقق من مجلد التنزيلات.
            {offered.omitted ? ` لم يُكتب الاسم الحالي لـ ${offered.omitted} منتج لأنه قد يُفسَّر كمعادلة (العمود اختياري للمراجعة فقط).` : ''}
          </p>
        </Notice>
      ) : null}
      {failure ? (
        failure.code === 'EXPORT_TOO_LARGE' ? (
          <Notice tone="warning" title="الملف أكبر من الحد المسموح">
            <p>{failure.message}</p>
          </Notice>
        ) : (
          <ErrorState failure={failure} />
        )
      ) : null}
    </div>
  );
}
