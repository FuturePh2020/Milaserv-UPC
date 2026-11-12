import { useState, type FormEvent } from 'react';
import { login } from '../../api/endpoints.ts';
import type { ApiFailure } from '../../api/client.ts';
import { Button } from '../../components/Button.tsx';
import { ErrorSummary, type SummaryItem } from '../../components/ErrorSummary.tsx';
import { Notice } from '../../components/Feedback.tsx';
import { Field, OtpInput, PasswordInput, TextInput } from '../../components/Form.tsx';
import { RequestRef } from '../../components/Text.tsx';
import { href, navigate } from '../../router.tsx';
import { useIdentity } from '../../session/identity.tsx';

/** Fixed notices selected by the `reason` query value (never free text from the URL). */
const REASONS: Record<string, { tone: 'info' | 'warning' | 'success'; text: string }> = {
  expired: { tone: 'warning', text: 'انتهت جلستك. سجّل الدخول من جديد للمتابعة.' },
  reauth: { tone: 'warning', text: 'لأمان العمليات الإدارية، سجّل الدخول من جديد بكلمة المرور ورمز التحقق.' },
  'password-changed': { tone: 'success', text: 'تم تغيير كلمة المرور وإنهاء جميع الجلسات. سجّل الدخول بكلمة المرور الجديدة.' },
  'logged-out': { tone: 'info', text: 'تم تسجيل الخروج.' },
};

const OTP_FORMAT = /^\d{6}$/;

export function LoginPage({ reason, adminPreset }: { reason: string | null; adminPreset: boolean }) {
  const { state, reload } = useIdentity();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(adminPreset);
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<SummaryItem[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [submits, setSubmits] = useState(0);
  const notice = reason ? REASONS[reason] : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmits((n) => n + 1);
    const local: SummaryItem[] = [];
    if (username.length === 0) local.push({ fieldId: 'login-username', message: 'أدخل اسم المستخدم.' });
    if (password.length === 0) local.push({ fieldId: 'login-password', message: 'أدخل كلمة المرور.' });
    // Format only; the code stays a string so leading zeros are kept.
    if (isAdmin && !OTP_FORMAT.test(totp)) local.push({ fieldId: 'login-totp', message: 'رمز التحقق 6 أرقام من تطبيق المصادقة.' });
    setErrors(local);
    setFailure(null);
    if (local.length) return;
    setBusy(true);
    // Sent exactly as typed: the server normalizes the username; passwords are never altered.
    const r = await login({ username, password, ...(isAdmin ? { totp } : {}) });
    setBusy(false);
    setPassword('');
    setTotp('');
    if (r.ok) {
      // The previous identity's screens and data are discarded (App remounts per identity).
      reload();
      navigate('/', undefined, { replace: true });
      return;
    }
    setFailure(r);
    // The server's single generic message: no hint about which factor or account state failed.
    setErrors([{ message: r.message + (r.kind === 'rate_limited' && r.retryAfterSeconds ? ` يمكنك المحاولة بعد حوالي ${Math.ceil(r.retryAfterSeconds / 60)} دقيقة.` : '') }]);
  };

  return (
    <section className="c-card stack" aria-labelledby="login-title">
      <h1 id="login-title" className="c-card__title">
        تسجيل الدخول
      </h1>
      {notice ? <Notice tone={notice.tone}><p>{notice.text}</p></Notice> : null}
      {state.status === 'authenticated' ? (
        <Notice tone="info">
          <p>
            أنت مسجّل الدخول حاليًا باسم <bdi dir="ltr">{state.me.user.username}</bdi>. تسجيل الدخول من جديد ينهي الجلسة الحالية على هذا المتصفح.
          </p>
        </Notice>
      ) : null}
      <ErrorSummary title="تعذّر تسجيل الدخول" items={errors} version={submits} />
      {failure ? <RequestRef requestId={failure.requestId} /> : null}
      <form className="stack" onSubmit={submit} noValidate>
        <Field id="login-username" label="اسم المستخدم" required>
          {(p) => <TextInput {...p} name="username" autoComplete="username" autoCapitalize="off" spellCheck={false} ltr value={username} onChange={(e) => setUsername(e.target.value)} />}
        </Field>
        <Field id="login-password" label="كلمة المرور" required>
          {(p) => <PasswordInput {...p} name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <label className="cluster">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          <span>تسجيل دخول مدير النظام (يتطلب رمز التحقق)</span>
        </label>
        {isAdmin ? (
          <Field id="login-totp" label="رمز التحقق" hint="6 أرقام من تطبيق المصادقة على هاتفك." required>
            {(p) => <OtpInput {...p} name="totp" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))} />}
          </Field>
        ) : null}
        <Button type="submit" block busy={busy} busyLabel="جارٍ التحقق…">
          دخول
        </Button>
      </form>
      <p>
        ليس لديك حساب؟ <a href={href('/register')}>تسجيل تاجر جديد</a>
      </p>
      <p className="muted">
        نسيت كلمة المرور؟ لا تتوفر استعادتها من البوابة حاليًا؛ تواصل مع إدارة الخير. فقدان جهاز رمز التحقق للمديرين يُعالج من مشغّل النظام على الخادم.
      </p>
    </section>
  );
}
