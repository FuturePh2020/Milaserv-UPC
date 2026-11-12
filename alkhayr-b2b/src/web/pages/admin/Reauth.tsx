import { useState, type FormEvent } from 'react';
import type { ApiFailure } from '../../api/client.ts';
import { login } from '../../api/endpoints.ts';
import { Button } from '../../components/Button.tsx';
import { ErrorSummary, type SummaryItem } from '../../components/ErrorSummary.tsx';
import { Notice } from '../../components/Feedback.tsx';
import { Field, OtpInput, PasswordInput } from '../../components/Form.tsx';
import { Ltr, RequestRef } from '../../components/Text.tsx';
import { useIdentity } from '../../session/identity.tsx';

/**
 * DEDICATED administrator re-authentication (428 RECENT_AUTH_REQUIRED). It uses the real sign-in
 * contract (POST /auth/login with a fresh pre-login token, password + TOTP for THIS account) and
 * nothing else: it is not a generic confirmation dialog and never sees the pending action.
 * Afterwards identity and the CSRF token are refreshed in place; the caller re-fetches its record
 * and keeps its unsent draft. NOTHING is executed automatically after re-authentication.
 */
export function ReauthPanel({ onDone }: { onDone: () => void }) {
  const { state, refresh } = useIdentity();
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<SummaryItem[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [submits, setSubmits] = useState(0);
  if (state.status !== 'authenticated') return null;
  const username = state.me.user.username;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmits((n) => n + 1);
    const local: SummaryItem[] = [];
    if (!password) local.push({ fieldId: 'reauth-password', message: 'أدخل كلمة المرور.' });
    if (!/^\d{6}$/.test(totp)) local.push({ fieldId: 'reauth-totp', message: 'رمز التحقق 6 أرقام.' });
    setErrors(local);
    if (local.length) return;
    setBusy(true);
    const r = await login({ username, password, totp });
    setPassword('');
    setTotp('');
    if (!r.ok) {
      setBusy(false);
      setFailure(r);
      setErrors([{ message: r.message }]);
      return;
    }
    const ok = await refresh();
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <section className="c-card stack c-reauth" aria-labelledby="reauth-title">
      <h2 id="reauth-title" className="c-card__title">
        تأكيد الهوية مطلوب
      </h2>
      <Notice tone="warning">
        <p>
          مرّت أكثر من 15 دقيقة على آخر تحقق للحساب <Ltr>{username}</Ltr>. أدخل كلمة المرور ورمز التحقق. بعد التأكيد ستُعرض البيانات الحالية من جديد،
          ويبقى الإجراء الذي أعددته <strong>دون تنفيذ</strong> حتى تؤكده بنفسك.
        </p>
      </Notice>
      <ErrorSummary title="تعذّر تأكيد الهوية" items={errors} version={submits} />
      {failure ? <RequestRef requestId={failure.requestId} /> : null}
      <form className="stack" onSubmit={submit} noValidate>
        <Field id="reauth-password" label="كلمة المرور" required>
          {(p) => <PasswordInput {...p} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field id="reauth-totp" label="رمز التحقق" hint="رمز جديد من تطبيق المصادقة." required>
          {(p) => <OtpInput {...p} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))} />}
        </Field>
        <Button type="submit" busy={busy} busyLabel="جارٍ التحقق…" icon="lock">
          تأكيد الهوية
        </Button>
      </form>
    </section>
  );
}
