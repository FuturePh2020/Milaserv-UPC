import { useState, type FormEvent } from 'react';
import type { ApiFailure, SessionCsrfToken } from '../../api/client.ts';
import { changePassword } from '../../api/endpoints.ts';
import { Button } from '../../components/Button.tsx';
import { ErrorSummary, type SummaryItem } from '../../components/ErrorSummary.tsx';
import { Notice } from '../../components/Feedback.tsx';
import { Field, OtpInput, PasswordInput } from '../../components/Form.tsx';
import { RequestRef } from '../../components/Text.tsx';
import { clearAllDrafts } from '../../cart/storage.ts';
import { navigate } from '../../router.tsx';
import { useIdentity } from '../../session/identity.tsx';

/**
 * POST /api/v1/auth/password. Success revokes EVERY session of the account (this one included),
 * so the user is returned to sign-in. Inputs are cleared after every attempt.
 */
export function PasswordChangePage({ csrf, isAdmin }: { csrf: SessionCsrfToken; isAdmin: boolean }) {
  const { signedOut, handleAuthFailure } = useIdentity();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<SummaryItem[]>([]);
  const [submits, setSubmits] = useState(0);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [unknown, setUnknown] = useState(false);
  const minChars = isAdmin ? 15 : 12;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmits((n) => n + 1);
    setFailure(null);
    setUnknown(false);
    const local: SummaryItem[] = [];
    if (current.length === 0) local.push({ fieldId: 'pw-current', message: 'أدخل كلمة المرور الحالية.' });
    if ([...next].length < minChars) local.push({ fieldId: 'pw-new', message: `كلمة المرور الجديدة ${minChars} حرفًا على الأقل.` });
    if (confirm !== next) local.push({ fieldId: 'pw-confirm', message: 'تأكيد كلمة المرور الجديدة لا يطابقها.' });
    if (isAdmin && !/^\d{6}$/.test(totp)) local.push({ fieldId: 'pw-totp', message: 'رمز التحقق 6 أرقام.' });
    setErrors(local);
    if (local.length) return;
    setBusy(true);
    const r = await changePassword(csrf, { currentPassword: current, newPassword: next, ...(isAdmin ? { totp } : {}) });
    setBusy(false);
    setCurrent('');
    setNext('');
    setConfirm('');
    setTotp('');
    if (r.ok) {
      clearAllDrafts();
      signedOut();
      navigate('/login', { reason: 'password-changed' }, { replace: true });
      return;
    }
    if (r.kind === 'network' || r.kind === 'server' || r.kind === 'unavailable' || r.kind === 'invalid_response') {
      // The change may or may not have been applied: say so instead of guessing.
      setUnknown(true);
      setFailure(r);
      return;
    }
    if (handleAuthFailure(r)) return;
    setFailure(r);
    setErrors(r.fields.length ? r.fields.map((f) => ({ message: f.message })) : [{ message: r.message }]);
  };

  return (
    <section className="stack" aria-labelledby="pw-title">
      <div className="c-page-header">
        <div>
          <h1 id="pw-title">تغيير كلمة المرور</h1>
          <p className="c-page-header__desc">بعد التغيير تنتهي جميع الجلسات المفتوحة لهذا الحساب على كل الأجهزة، ويلزم تسجيل الدخول من جديد.</p>
        </div>
      </div>
      {unknown ? (
        <Notice tone="warning" title="لم يتأكد تغيير كلمة المرور">
          <p>انقطع الاتصال أو حدث خطأ قبل وصول الرد، فقد تكون كلمة المرور تغيّرت أو لم تتغير. جرّب تسجيل الدخول بكلمة المرور الجديدة، وإن لم تنجح فاستخدم القديمة.</p>
          {failure ? <RequestRef requestId={failure.requestId} /> : null}
        </Notice>
      ) : null}
      <ErrorSummary title="تعذّر تغيير كلمة المرور" items={errors} version={submits} />
      {failure && !unknown ? <RequestRef requestId={failure.requestId} /> : null}
      <form className="c-card stack" onSubmit={submit} noValidate>
        <Field id="pw-current" label="كلمة المرور الحالية" required>
          {(p) => <PasswordInput {...p} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field id="pw-new" label="كلمة المرور الجديدة" hint={`${minChars} حرفًا على الأقل.`} required>
          {(p) => <PasswordInput {...p} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <Field id="pw-confirm" label="تأكيد كلمة المرور الجديدة" required>
          {(p) => <PasswordInput {...p} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        {isAdmin ? (
          <Field id="pw-totp" label="رمز التحقق" hint="رمز جديد من تطبيق المصادقة." required>
            {(p) => <OtpInput {...p} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))} />}
          </Field>
        ) : null}
        <Button type="submit" busy={busy} busyLabel="جارٍ التغيير…">
          تغيير كلمة المرور
        </Button>
      </form>
    </section>
  );
}
