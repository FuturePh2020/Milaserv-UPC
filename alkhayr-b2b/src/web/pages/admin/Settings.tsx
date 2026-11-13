import { useEffect, useState, type FormEvent } from 'react';
import type { ApiFailure, SessionCsrfToken } from '../../api/client.ts';
import { getSettings, updateSettings, type BusinessSettings, type SettingsPatch } from '../../api/admin.ts';
import { bpsInputText, moneyInputText, parseMoneyInput, parsePercentToBps, parseWhole } from '../../admin/logic.ts';
import { Button } from '../../components/Button.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { ErrorSummary, type SummaryItem } from '../../components/ErrorSummary.tsx';
import { ErrorState, Notice, SkeletonLines } from '../../components/Feedback.tsx';
import { Field, TextArea, TextInput } from '../../components/Form.tsx';
import { Ltr, Money, RequestRef } from '../../components/Text.tsx';
import { useToast } from '../../components/Toast.tsx';
import { formatDateTime, formatInteger } from '../../format.ts';
import { useStickyLoad } from '../../hooks/useLoad.ts';
import { useIdentity } from '../../session/identity.tsx';
import { ReauthPanel } from './Reauth.tsx';

/**
 * Business settings (stage 14). Financial values apply to FUTURE quotes and orders only; existing
 * orders keep their snapshot. The tax rate is the operator's business choice — the system does not
 * say it is legally correct. Unsaved values survive conflicts and re-authentication.
 */

interface Values {
  companyName: string;
  companyPhone: string;
  companyEmail: string;
  companyAddress: string;
  shipping: string;
  shippingTaxable: boolean;
  taxPercent: string;
  minimum: string;
  threshold: string;
}
const toValues = (s: BusinessSettings): Values => ({
  companyName: s.company.name ?? '',
  companyPhone: s.company.phone ?? '',
  companyEmail: s.company.email ?? '',
  companyAddress: s.company.address ?? '',
  shipping: moneyInputText(s.shippingCents),
  shippingTaxable: s.shippingTaxable,
  taxPercent: bpsInputText(s.taxBps),
  minimum: moneyInputText(s.minimumOrderCents),
  threshold: String(s.lowStockThresholdCartons),
});
const IDS = { companyName: 'st-name', companyPhone: 'st-phone', companyEmail: 'st-email', companyAddress: 'st-address', shipping: 'st-shipping', taxPercent: 'st-tax', minimum: 'st-minimum', threshold: 'st-threshold' } as const;

type Change = { field: keyof SettingsPatch; label: string; from: string; to: string; financial: boolean };

function diff(base: BusinessSettings, v: Values): { patch: SettingsPatch; changes: Change[]; errors: SummaryItem[] } {
  const errors: SummaryItem[] = [];
  const patch: SettingsPatch = {};
  const changes: Change[] = [];
  const text = (field: 'companyName' | 'companyPhone' | 'companyEmail' | 'companyAddress', current: string | null, label: string) => {
    const next = v[field].trim() === '' ? null : v[field].trim();
    if (next !== current) {
      patch[field] = next;
      changes.push({ field, label, from: current ?? '—', to: next ?? '(فارغ)', financial: false });
    }
  };
  text('companyName', base.company.name, 'اسم الشركة');
  text('companyPhone', base.company.phone, 'هاتف الشركة');
  text('companyEmail', base.company.email, 'البريد الإلكتروني');
  text('companyAddress', base.company.address, 'عنوان الشركة');
  const money = (raw: string, id: string, label: string) => {
    const r = parseMoneyInput(raw, 100_000_000_000, true);
    if (!r.ok) errors.push({ fieldId: id, message: `${label}: ${r.message}` });
    return r.ok ? r.value : null;
  };
  const shipping = money(v.shipping, IDS.shipping, 'رسوم الشحن');
  if (shipping !== null && shipping > 10_000_000) errors.push({ fieldId: IDS.shipping, message: 'رسوم الشحن حتى 100000 ج.م.' });
  else if (shipping !== null && shipping !== base.shippingCents) {
    patch.shippingCents = shipping;
    changes.push({ field: 'shippingCents', label: 'رسوم الشحن للطلب', from: moneyInputText(base.shippingCents), to: moneyInputText(shipping), financial: true });
  }
  if (v.shippingTaxable !== base.shippingTaxable) {
    patch.shippingTaxable = v.shippingTaxable;
    changes.push({ field: 'shippingTaxable', label: 'الشحن خاضع للضريبة', from: base.shippingTaxable ? 'نعم' : 'لا', to: v.shippingTaxable ? 'نعم' : 'لا', financial: true });
  }
  const tax = parsePercentToBps(v.taxPercent);
  if (!tax.ok) errors.push({ fieldId: IDS.taxPercent, message: `نسبة الضريبة: ${tax.message}` });
  else if (tax.value !== base.taxBps) {
    patch.taxBps = tax.value;
    changes.push({ field: 'taxBps', label: 'نسبة الضريبة', from: `${bpsInputText(base.taxBps)}%`, to: `${bpsInputText(tax.value)}%`, financial: true });
  }
  const minimum = money(v.minimum, IDS.minimum, 'الحد الأدنى للطلب');
  if (minimum !== null && minimum > 1_000_000_000) errors.push({ fieldId: IDS.minimum, message: 'الحد الأدنى حتى 10000000 ج.م.' });
  else if (minimum !== null && minimum !== base.minimumOrderCents) {
    patch.minimumOrderCents = minimum;
    changes.push({ field: 'minimumOrderCents', label: 'الحد الأدنى لإجمالي البضاعة', from: moneyInputText(base.minimumOrderCents), to: moneyInputText(minimum), financial: true });
  }
  const threshold = parseWhole(v.threshold, 0, 100_000, 'حد الكمية المنخفضة');
  if (!threshold.ok) errors.push({ fieldId: IDS.threshold, message: threshold.message });
  else if (threshold.value !== base.lowStockThresholdCartons) {
    patch.lowStockThresholdCartons = threshold.value;
    changes.push({ field: 'lowStockThresholdCartons', label: 'حد الكمية المنخفضة (كرتونة)', from: String(base.lowStockThresholdCartons), to: String(threshold.value), financial: true });
  }
  return { patch, changes, errors };
}

function SettingsForm({ initial, csrf, reload }: { initial: BusinessSettings; csrf: SessionCsrfToken; reload: () => void }) {
  const { handleAuthFailure } = useIdentity();
  const toast = useToast();
  const [base, setBase] = useState(initial);
  const [values, setValues] = useState<Values>(toValues(initial));
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [submits, setSubmits] = useState(0);
  const [pending, setPending] = useState<{ patch: SettingsPatch; changes: Change[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [conflict, setConflict] = useState<BusinessSettings | null>(null);
  const [reauth, setReauth] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const set = <K extends keyof Values>(k: K, v: Values[K]) => setValues((x) => ({ ...x, [k]: v }));
  // A re-read (after re-authentication or "show current values") becomes the new base; typed values stay.
  useEffect(() => {
    if (initial.version !== base.version) setBase(initial);
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const review = (e: FormEvent) => {
    e.preventDefault();
    setSubmits((n) => n + 1);
    setFailure(null);
    const d = diff(base, values);
    setSummary(d.errors);
    if (d.errors.length) return;
    if (d.changes.length === 0) return setSummary([{ message: 'لم تغيّر أي قيمة.' }]);
    if (d.changes.some((c) => c.financial)) setPending(d); // financial changes need explicit confirmation
    else void send(d.patch);
  };

  const send = async (patch: SettingsPatch) => {
    setBusy(true);
    setUnknown(false);
    const r = await updateSettings(csrf, base.version, patch);
    setBusy(false);
    setPending(null);
    if (r.ok) {
      setBase(r.data);
      setValues(toValues(r.data));
      toast('حُفظت الإعدادات. تسري على عروض الأسعار والطلبات الجديدة فقط.', 'success');
      return;
    }
    if (r.kind === 'reauth_required') return setReauth(true);
    if (r.kind === 'network' || r.kind === 'server' || r.kind === 'unavailable' || r.kind === 'invalid_response') {
      setUnknown(true); // not idempotent: never resent automatically; the current values decide
      setFailure(r);
      return;
    }
    if (handleAuthFailure(r)) return;
    const current = r.current?.settings as BusinessSettings | undefined;
    if (r.code === 'VERSION_CONFLICT' && current) return setConflict(current);
    setFailure(r);
    setSummary(r.fields.length ? r.fields.map((f) => ({ message: f.message })) : [{ message: r.message }]);
  };

  return (
    <form className="stack" onSubmit={review} noValidate>
      {reauth ? (
        <ReauthPanel
          onDone={() => {
            setReauth(false);
            reload(); // values stay as an unsent draft; saving needs a new explicit confirmation
          }}
        />
      ) : null}
      {unknown ? (
        <Notice tone="warning" title="لم يتأكد حفظ الإعدادات">
          <p>لم يصل رد مؤكد، ولا يُعاد الإرسال تلقائيًا. اعرض القيم الحالية لترى ما حُفظ؛ تعديلاتك ما زالت في النموذج.</p>
          <Button size="small" variant="secondary" icon="refresh" onClick={reload}>
            عرض القيم الحالية
          </Button>
          {failure ? <RequestRef requestId={failure.requestId} /> : null}
        </Notice>
      ) : null}
      {conflict ? (
        <Notice tone="warning" title="لم تُحفظ: عُدّلت الإعدادات من مكان آخر">
          <p>
            القيم الحالية: الشحن <Money cents={conflict.shippingCents} /> ({conflict.shippingTaxable ? 'خاضع للضريبة' : 'غير خاضع للضريبة'})، الضريبة {bpsInputText(conflict.taxBps)}%، الحد الأدنى{' '}
            <Money cents={conflict.minimumOrderCents} />، حد الكمية المنخفضة {formatInteger(conflict.lowStockThresholdCartons)} (الإصدار {conflict.version}). ما أدخلته ما زال في النموذج.
          </p>
          <div className="cluster">
            <Button size="small" onClick={() => { setBase(conflict); setConflict(null); }}>إعادة تطبيق تعديلاتي على النسخة الحالية</Button>
            <Button size="small" variant="secondary" onClick={() => { setBase(conflict); setValues(toValues(conflict)); setConflict(null); }}>تجاهل تعديلاتي</Button>
          </div>
        </Notice>
      ) : null}
      <ErrorSummary title="راجع الإعدادات" items={summary} version={submits} />
      {failure && !unknown ? <RequestRef requestId={failure.requestId} /> : null}

      <fieldset className="c-card stack">
        <legend className="c-card__title">بيانات الشركة</legend>
        <p className="muted">تظهر في رأس ملخصات الطلبات المطبوعة كبيانات «حالية». الحقول الفارغة لا تُعرض. لا تُضاف بيانات تسجيل أو أرقام ضريبية.</p>
        <Field id={IDS.companyName} label="اسم الشركة (اختياري)">{(p) => <TextInput {...p} value={values.companyName} onChange={(e) => set('companyName', e.target.value)} />}</Field>
        <Field id={IDS.companyPhone} label="هاتف الشركة (اختياري)" hint="أرقام فقط، ويُسمح بـ + في البداية.">{(p) => <TextInput {...p} ltr inputMode="tel" value={values.companyPhone} onChange={(e) => set('companyPhone', e.target.value)} />}</Field>
        <Field id={IDS.companyEmail} label="البريد الإلكتروني (اختياري)">{(p) => <TextInput {...p} ltr type="email" value={values.companyEmail} onChange={(e) => set('companyEmail', e.target.value)} />}</Field>
        <Field id={IDS.companyAddress} label="عنوان الشركة (اختياري)">{(p) => <TextArea {...p} rows={2} value={values.companyAddress} onChange={(e) => set('companyAddress', e.target.value)} />}</Field>
      </fieldset>

      <fieldset className="c-card stack">
        <legend className="c-card__title">الشحن والضريبة والحد الأدنى</legend>
        <Notice tone="info">
          <p>
            تسري على عروض الأسعار والطلبات <strong>الجديدة فقط</strong>؛ كل طلب موجود يحتفظ بقيمه. التاجر الذي راجع إجمالي طلب قبل تغيير الشحن أو الضريبة يُطلب منه مراجعته من جديد.
            نسبة الضريبة اختيار تشغيلي تحدده الشركة، والنظام لا يؤكد صحتها القانونية.
          </p>
        </Notice>
        <Field id={IDS.shipping} label="رسوم الشحن لكل طلب (ج.م)" hint="مثل 50 أو 50.00. صفر = بدون رسوم. رقمان عشريان على الأكثر.">{(p) => <TextInput {...p} ltr inputMode="decimal" value={values.shipping} onChange={(e) => set('shipping', e.target.value)} />}</Field>
        <label className="cluster">
          <input type="checkbox" checked={values.shippingTaxable} onChange={(e) => set('shippingTaxable', e.target.checked)} /> الشحن خاضع للضريبة
        </label>
        <Field id={IDS.taxPercent} label="نسبة الضريبة (%)" hint="مثل 14 أو 14.5 (حتى رقمين عشريين). صفر = بدون ضريبة.">{(p) => <TextInput {...p} ltr inputMode="decimal" value={values.taxPercent} onChange={(e) => set('taxPercent', e.target.value)} />}</Field>
        <Field id={IDS.minimum} label="الحد الأدنى لإجمالي البضاعة (ج.م)" hint="قبل الشحن والضريبة. صفر = بدون حد أدنى.">{(p) => <TextInput {...p} ltr inputMode="decimal" value={values.minimum} onChange={(e) => set('minimum', e.target.value)} />}</Field>
      </fieldset>

      <fieldset className="c-card stack">
        <legend className="c-card__title">المخزون</legend>
        <Field id={IDS.threshold} label="حد الكمية المنخفضة (كرتونة)" hint="المتاح = 0: غير متوفر؛ من 1 حتى هذا الحد: كمية محدودة؛ أكثر منه: متوفر. يتغير ما يراه التجار فورًا.">
          {(p) => <TextInput {...p} ltr inputMode="numeric" value={values.threshold} onChange={(e) => set('threshold', e.target.value)} />}
        </Field>
      </fieldset>
      <p className="muted">
        الإصدار {base.version} · آخر تعديل {formatDateTime(base.updatedAt)}
        {base.updatedBy ? <> بواسطة <Ltr>{base.updatedBy}</Ltr></> : null}
      </p>
      <Button type="submit" busy={busy} busyLabel="جارٍ الحفظ…" disabled={conflict !== null}>
        حفظ الإعدادات…
      </Button>
      <ConfirmDialog open={pending !== null} title="تأكيد تغيير الإعدادات المالية" confirmLabel="حفظ التغييرات" busy={busy} onCancel={() => setPending(null)} onConfirm={() => pending && void send(pending.patch)}>
        {pending ? (
          <>
            <ul className="c-change-list">
              {pending.changes.map((c) => (
                <li key={c.field}>
                  {c.label}: <Ltr>{c.from}</Ltr> ← <strong><Ltr>{c.to}</Ltr></strong>
                </li>
              ))}
            </ul>
            <p>تسري على عروض الأسعار والطلبات الجديدة فقط. الطلبات الموجودة لا تتغير.</p>
          </>
        ) : null}
      </ConfirmDialog>
    </form>
  );
}

export function SettingsPage({ csrf }: { csrf: SessionCsrfToken }) {
  const [gen, setGen] = useState(0);
  const data = useStickyLoad('settings', gen, (signal) => getSettings(signal));
  return (
    <section className="stack" aria-labelledby="st-title">
      <div className="c-page-header">
        <div>
          <h1 id="st-title">الإعدادات</h1>
          <p className="c-page-header__desc">بيانات الشركة، الشحن والضريبة والحد الأدنى للطلب، وحد الكمية المنخفضة. كل تغيير يتطلب تسجيل دخول حديثًا ويُسجل في السجل.</p>
        </div>
      </div>
      {data.initialLoading ? <SkeletonLines lines={8} label="جارٍ تحميل الإعدادات…" /> : null}
      {data.failure ? <ErrorState failure={data.failure} onRetry={data.reload} /> : null}
      {data.refreshing ? <p className="muted" role="status">جارٍ تحديث القيم…</p> : null}
      {data.data ? <SettingsForm initial={data.data} csrf={csrf} reload={() => setGen((g) => g + 1)} /> : null}
    </section>
  );
}
