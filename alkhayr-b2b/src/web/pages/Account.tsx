import { useEffect, useState, type FormEvent } from 'react';
import type { ApiFailure, SessionCsrfToken } from '../api/client.ts';
import { isOwnProfile, type MeResponse, type OwnProfile } from '../api/contracts.ts';
import { getProfile, patchProfile, type ProfilePatch } from '../api/endpoints.ts';
import { MerchantStatusBadge } from '../components/Badges.tsx';
import { Button, ButtonLink } from '../components/Button.tsx';
import { ErrorSummary, type SummaryItem } from '../components/ErrorSummary.tsx';
import { ErrorState, Notice, SkeletonLines } from '../components/Feedback.tsx';
import { Field, TextArea, TextInput } from '../components/Form.tsx';
import { useToast } from '../components/Toast.tsx';
import { Ltr, RequestRef } from '../components/Text.tsx';
import { formatDateTime } from '../format.ts';
import { useLoad } from '../hooks/useLoad.ts';
import { href } from '../router.tsx';
import { useIdentity } from '../session/identity.tsx';

type Form = { businessName: string; contactName: string; phone: string; governorate: string; address: string; email: string };
const FIELDS: Array<[keyof Form, string, string]> = [
  ['businessName', 'اسم النشاط', 'prof-business'],
  ['contactName', 'اسم المسؤول', 'prof-contact'],
  ['phone', 'الهاتف', 'prof-phone'],
  ['governorate', 'المحافظة', 'prof-governorate'],
  ['address', 'العنوان', 'prof-address'],
  ['email', 'البريد الإلكتروني (اختياري)', 'prof-email'],
];
const toForm = (p: OwnProfile): Form => ({ businessName: p.businessName, contactName: p.contactName, phone: p.phone, governorate: p.governorate, address: p.address, email: p.email ?? '' });

function changes(base: OwnProfile, form: Form): ProfilePatch {
  const out: ProfilePatch = {};
  for (const [k] of FIELDS) {
    const before = k === 'email' ? (base.email ?? '') : base[k];
    if (form[k] !== before) (out as Record<string, string | null>)[k] = k === 'email' && form.email.trim() === '' ? null : form[k];
  }
  return out;
}

function ProfileEditor({ profile, csrf, onSaved }: { profile: OwnProfile; csrf: SessionCsrfToken; onSaved: (p: OwnProfile) => void }) {
  const { handleAuthFailure } = useIdentity();
  const toast = useToast();
  const [base, setBase] = useState(profile);
  const [form, setForm] = useState<Form>(toForm(profile));
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ failure: ApiFailure; current: OwnProfile } | null>(null);
  const [errors, setErrors] = useState<SummaryItem[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submits, setSubmits] = useState(0);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const diff = changes(base, form);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSubmits((n) => n + 1);
    if (Object.keys(diff).length === 0) {
      setErrors([{ message: 'لم تغيّر أي حقل.' }]);
      return;
    }
    setBusy(true);
    setFailure(null);
    const r = await patchProfile(csrf, base.version, diff);
    setBusy(false);
    if (r.ok) {
      setErrors([]);
      setFieldErrors({});
      setConflict(null);
      onSaved(r.data);
      toast('تم حفظ بيانات الحساب.', 'success');
      return;
    }
    if (handleAuthFailure(r)) return;
    if (r.code === 'VERSION_CONFLICT' && isOwnProfile(r.current?.profile)) {
      // Keep the user's unsaved values; show the current record; nothing is overwritten.
      setConflict({ failure: r, current: r.current.profile });
      setErrors([]);
      return;
    }
    setFailure(r);
    const ids = Object.fromEntries(FIELDS.map(([k, , id]) => [k, id]));
    setFieldErrors(Object.fromEntries(r.fields.map((f) => [f.path, f.message])));
    setErrors(r.fields.length ? r.fields.map((f) => ({ ...(ids[f.path] ? { fieldId: ids[f.path] } : {}), message: f.message })) : [{ message: r.message }]);
  };

  return (
    <form className="c-card stack" onSubmit={save} noValidate aria-labelledby="prof-edit-title">
      <h2 id="prof-edit-title" className="c-card__title">
        تعديل البيانات
      </h2>
      {conflict ? (
        <Notice tone="warning" title="لم تُحفظ التعديلات: تغيّرت البيانات من مكان آخر">
          <p>ما أدخلته ما زال في النموذج. البيانات المسجلة حاليًا:</p>
          <dl className="c-summary">
            {FIELDS.map(([k, label]) => (
              <div key={k} className="c-summary__row">
                <dt>{label}</dt>
                <dd>{k === 'email' ? (conflict.current.email ?? '—') : conflict.current[k]}</dd>
              </div>
            ))}
          </dl>
          <div className="cluster">
            <Button
              size="small"
              onClick={() => {
                setBase(conflict.current); // re-apply MY values on top of the current version
                setConflict(null);
              }}
            >
              إعادة تطبيق تعديلاتي على البيانات الحالية
            </Button>
            <Button
              size="small"
              variant="secondary"
              onClick={() => {
                setBase(conflict.current);
                setForm(toForm(conflict.current));
                setConflict(null);
              }}
            >
              تجاهل تعديلاتي
            </Button>
          </div>
          <RequestRef requestId={conflict.failure.requestId} />
        </Notice>
      ) : null}
      <ErrorSummary title="تعذّر حفظ البيانات" items={errors} version={submits} />
      {failure ? <RequestRef requestId={failure.requestId} /> : null}
      {FIELDS.map(([k, label, id]) => (
        <Field key={k} id={id} label={label} error={fieldErrors[k] ?? null} required={k !== 'email'}>
          {(p) =>
            k === 'address' ? (
              <TextArea {...p} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
            ) : (
              <TextInput {...p} {...(k === 'phone' || k === 'email' ? { ltr: true } : {})} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
            )
          }
        </Field>
      ))}
      <p className="muted">تعديل البيانات لا يغيّر حالة الحساب ولا صلاحياته، ولا يغيّر بيانات الطلبات السابقة.</p>
      <Button type="submit" busy={busy} busyLabel="جارٍ الحفظ…" disabled={conflict !== null}>
        حفظ التعديلات
      </Button>
    </form>
  );
}

/** Own account: status, profile (GET/PATCH /merchant/profile), password change link, explicit status refresh. */
export function AccountPage({ me, csrf, now }: { me: MeResponse; csrf: SessionCsrfToken; now: number }) {
  const { reload } = useIdentity();
  const loaded = useLoad('profile', (signal) => getProfile(signal));
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const loadedData = loaded.status === 'ok' ? loaded.data : null;
  useEffect(() => {
    if (loadedData) setProfile(loadedData); // only when a NEW server response arrives (not after a local save)
  }, [loadedData]);
  const recent = me.session.recentAuthUntil;
  return (
    <section aria-labelledby="account-title" className="stack">
      <div className="c-page-header">
        <div>
          <h1 id="account-title">حسابي</h1>
          <p className="c-page-header__desc">
            اسم المستخدم: <Ltr>{me.user.username}</Ltr>
          </p>
        </div>
        <MerchantStatusBadge status={me.merchant.status} />
      </div>
      {me.merchant.status !== 'approved' ? (
        <Notice tone="warning" title="الحساب قيد المراجعة">
          <p>يمكنك تصحيح بياناتك وتغيير كلمة المرور. الأسعار والطلب يتاحان بعد الاعتماد.</p>
          <Button size="small" variant="secondary" icon="refresh" onClick={reload}>
            تحديث حالة الحساب
          </Button>
        </Notice>
      ) : null}
      {loaded.status === 'loading' && !profile ? <SkeletonLines lines={5} label="جارٍ تحميل البيانات…" /> : null}
      {loaded.status === 'error' ? <ErrorState failure={loaded.failure} onRetry={loaded.reload} /> : null}
      {profile ? <ProfileEditor key={profile.version} profile={profile} csrf={csrf} onSaved={setProfile} /> : null}
      <div className="c-card stack">
        <h2 className="c-card__title">الأمان</h2>
        <dl className="c-summary">
          <div className="c-summary__row">
            <dt>تنتهي الجلسة في موعد أقصاه</dt>
            <dd>{formatDateTime(me.session.absoluteExpiresAt)}</dd>
          </div>
          {recent !== null ? (
            <div className="c-summary__row">
              <dt>صلاحية الإجراءات الإدارية</dt>
              <dd>{recent > now ? `حتى ${formatDateTime(recent)}` : 'انتهت — يلزم تسجيل الدخول من جديد قبل أي إجراء'}</dd>
            </div>
          ) : null}
        </dl>
        <ButtonLink href={href('/account/password')} icon="lock">
          تغيير كلمة المرور
        </ButtonLink>
      </div>
    </section>
  );
}
