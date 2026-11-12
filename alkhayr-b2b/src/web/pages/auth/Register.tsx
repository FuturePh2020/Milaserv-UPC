import { useState, type FormEvent, type ReactNode } from 'react';
import { register, type RegistrationInput } from '../../api/endpoints.ts';
import type { ApiFailure } from '../../api/client.ts';
import { Button, ButtonLink } from '../../components/Button.tsx';
import { ErrorSummary, type SummaryItem } from '../../components/ErrorSummary.tsx';
import { Notice } from '../../components/Feedback.tsx';
import { Field, PasswordInput, TextArea, TextInput } from '../../components/Form.tsx';
import { RequestRef } from '../../components/Text.tsx';
import { href } from '../../router.tsx';

/** Server field names -> form field ids (server validation messages are shown next to the fields). */
const FIELD_IDS: Record<string, string> = {
  username: 'reg-username',
  password: 'reg-password',
  businessName: 'reg-business',
  contactName: 'reg-contact',
  phone: 'reg-phone',
  governorate: 'reg-governorate',
  address: 'reg-address',
  email: 'reg-email',
};

type Values = Required<Omit<RegistrationInput, 'email'>> & { email: string; confirm: string };
const EMPTY: Values = { username: '', password: '', confirm: '', businessName: '', contactName: '', phone: '', governorate: '', address: '', email: '' };

/** Trader registration: creates a PENDING trader only (never an administrator); no automatic sign-in. */
export function RegisterPage() {
  const [values, setValues] = useState<Values>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [submits, setSubmits] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [received, setReceived] = useState<string | null>(null);
  const set = (k: keyof Values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmits((n) => n + 1);
    setFailure(null);
    // Usability checks only; the server validates and normalizes everything again.
    const errs: Record<string, string> = {};
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/.test(values.username.trim())) errs.username = 'اسم المستخدم من 3 إلى 32 حرفًا إنجليزيًا أو أرقامًا أو . _ - ويبدأ بحرف أو رقم.';
    if ([...values.password].length < 12) errs.password = 'كلمة المرور 12 حرفًا على الأقل.';
    if (values.confirm !== values.password) errs.confirm = 'تأكيد كلمة المرور لا يطابق كلمة المرور.';
    if (values.businessName.trim().length < 2) errs.businessName = 'اسم النشاط مطلوب.';
    if (values.contactName.trim().length < 2) errs.contactName = 'اسم المسؤول مطلوب.';
    if (values.phone.trim().length < 8) errs.phone = 'رقم الهاتف مطلوب (مثال: 01012345678).';
    if (values.governorate.trim().length < 2) errs.governorate = 'المحافظة مطلوبة.';
    if (values.address.trim().length < 5) errs.address = 'العنوان من 5 أحرف على الأقل.';
    setFieldErrors(errs);
    const ids: Record<string, string> = { ...FIELD_IDS, confirm: 'reg-confirm' };
    setSummary(Object.entries(errs).map(([k, message]) => (ids[k] ? { fieldId: ids[k], message } : { message })));
    if (Object.keys(errs).length) return;
    setBusy(true);
    const { confirm: _confirm, email, ...rest } = values;
    const r = await register({ ...rest, ...(email.trim() ? { email } : {}) });
    setBusy(false);
    // Passwords are not kept after the request, whatever the outcome.
    setValues((v) => ({ ...v, password: '', confirm: '' }));
    if (r.ok) {
      setReceived(r.data.message);
      setValues(EMPTY);
      return;
    }
    setFailure(r);
    const serverErrs: Record<string, string> = {};
    for (const f of r.fields) if (FIELD_IDS[f.path]) serverErrs[f.path] = f.message;
    setFieldErrors(serverErrs);
    setSummary(
      r.fields.length
        ? r.fields.map((f) => ({ ...(FIELD_IDS[f.path] ? { fieldId: FIELD_IDS[f.path] } : {}), message: f.message }))
        : [{ message: r.kind === 'network' ? 'تعذّر الاتصال بالخادم؛ لم يتأكد استلام طلب التسجيل. يمكنك المحاولة مرة أخرى.' : r.message }],
    );
  };

  if (received) {
    return (
      <section className="c-card stack" aria-labelledby="reg-done">
        <h1 id="reg-done" className="c-card__title" tabIndex={-1} ref={(el) => el?.focus()}>
          تم استلام طلب التسجيل
        </h1>
        {/* The server's message: identical for new and already-used usernames. */}
        <p>{received}</p>
        <p className="muted">لا يتم تسجيل الدخول تلقائيًا. بعد اعتماد الحساب من الإدارة يمكنك رؤية الأسعار والطلب.</p>
        <ButtonLink href={href('/login')} variant="primary">
          الذهاب إلى تسجيل الدخول
        </ButtonLink>
      </section>
    );
  }

  const field = (k: keyof Values, id: string, label: string, control: (p: object) => ReactNode, hint?: string, required = true) => (
    <Field id={id} label={label} {...(hint ? { hint } : {})} error={fieldErrors[k] ?? null} required={required}>
      {control}
    </Field>
  );

  return (
    <section className="c-card stack" aria-labelledby="reg-title">
      <h1 id="reg-title" className="c-card__title">
        تسجيل تاجر جديد
      </h1>
      <Notice tone="info">
        <p>يُراجع كل حساب جديد من إدارة الخير قبل اعتماده. لا تظهر الأسعار ولا يمكن الطلب حتى يتم الاعتماد، ولا تُرسل رسائل تأكيد بالبريد أو الهاتف.</p>
      </Notice>
      <ErrorSummary title="راجع البيانات التالية:" items={summary} version={submits} />
      {failure ? <RequestRef requestId={failure.requestId} /> : null}
      <form className="stack" onSubmit={submit} noValidate>
        {field('username', 'reg-username', 'اسم المستخدم', (p) => <TextInput {...p} ltr autoComplete="username" autoCapitalize="off" spellCheck={false} value={values.username} onChange={set('username')} />, 'أحرف إنجليزية صغيرة وأرقام، مثال: alnour.store')}
        {field('password', 'reg-password', 'كلمة المرور', (p) => <PasswordInput {...p} autoComplete="new-password" value={values.password} onChange={set('password')} />, '12 حرفًا على الأقل. يُفضّل استخدام عبارة طويلة أو مدير كلمات المرور.')}
        {field('confirm', 'reg-confirm', 'تأكيد كلمة المرور', (p) => <PasswordInput {...p} autoComplete="new-password" value={values.confirm} onChange={set('confirm')} />)}
        {field('businessName', 'reg-business', 'اسم النشاط التجاري', (p) => <TextInput {...p} autoComplete="organization" value={values.businessName} onChange={set('businessName')} />)}
        {field('contactName', 'reg-contact', 'اسم المسؤول', (p) => <TextInput {...p} autoComplete="name" value={values.contactName} onChange={set('contactName')} />)}
        {field('phone', 'reg-phone', 'رقم الهاتف', (p) => <TextInput {...p} ltr type="tel" inputMode="tel" autoComplete="tel" value={values.phone} onChange={set('phone')} />, 'مثال: 01012345678')}
        {field('governorate', 'reg-governorate', 'المحافظة', (p) => <TextInput {...p} autoComplete="address-level1" value={values.governorate} onChange={set('governorate')} />)}
        {field('address', 'reg-address', 'العنوان', (p) => <TextArea {...p} autoComplete="street-address" value={values.address} onChange={set('address')} />)}
        {field('email', 'reg-email', 'البريد الإلكتروني (اختياري)', (p) => <TextInput {...p} ltr type="email" autoComplete="email" value={values.email} onChange={set('email')} />, undefined, false)}
        <Button type="submit" block busy={busy} busyLabel="جارٍ الإرسال…">
          إرسال طلب التسجيل
        </Button>
      </form>
      <p>
        لديك حساب؟ <a href={href('/login')}>تسجيل الدخول</a>
      </p>
    </section>
  );
}
