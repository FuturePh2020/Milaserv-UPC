import { useEffect, useRef, useState } from 'react';
import { newRequestKey, SECURE_RANDOM_MESSAGE, SecureRandomUnavailableError, type ApiFailure, type SessionCsrfToken } from '../../api/client.ts';
import { commitImport, importTemplateUrl, isImportRowReport, prefilledTemplate, previewImport, type ImportCommitPayload, type ImportMode, type ImportPreview, type ImportResult, type ImportRowReport } from '../../api/admin.ts';
import { Badge } from '../../components/Badges.tsx';
import { Button } from '../../components/Button.tsx';
import { DataTable } from '../../components/DataTable.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { ErrorState, Notice } from '../../components/Feedback.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Ltr, Money, RequestRef } from '../../components/Text.tsx';
import { useToast } from '../../components/Toast.tsx';
import { formatDateTime, formatInteger } from '../../format.ts';
import { useOperation } from '../../hooks/useOperation.ts';
import { href } from '../../router.tsx';
import { useIdentity } from '../../session/identity.tsx';
import { ExportButton } from './ExportButton.tsx';
import { OperationNotice } from './OperationNotice.tsx';
import { Field, TextInput } from '../../components/Form.tsx';

/**
 * CSV import (stage 13): choose mode → select file → server validation → preview → explicit
 * confirmation → result. The browser never parses or edits the plan: it sends the exact file bytes
 * (base64) to the server for the preview and again, unchanged, for the confirmation. All file text
 * is rendered as text by React (no HTML, no formulas).
 */

const MAX_FILE_BYTES = 1024 * 1024;
const SLOT = 'import';

interface ModeInfo {
  title: string;
  summary: string;
  effect: string;
  columns: Array<[string, boolean, string]>;
}

const MODES: Record<ImportMode, ModeInfo> = {
  create_products: {
    title: 'إنشاء منتجات جديدة',
    summary: 'كل صف منتج جديد.',
    effect: 'تُنشأ المنتجات غير مفعّلة وبرصيد صفر. استلم الرصيد بعدها (استيراد «استلام مخزون» أو شاشة المخزون) ثم فعّل المنتجات.',
    columns: [
      ['name', true, 'اسم المنتج (2–160 حرفًا).'],
      ['brand', true, 'البراند (1–80 حرفًا).'],
      ['category', true, 'معرّف القسم كما هو، مثل chocolate أو candy (ليس الاسم العربي).'],
      ['cartonPriceEgp', true, 'سعر الكرتونة بالجنيه المصري، نقطة عشرية ورقمان على الأكثر، مثل 125.50 — بدون فواصل آلاف أو رمز عملة.'],
      ['packSize', true, 'عدد القطع في الكرتونة: عدد صحيح 1–10000.'],
      ['minimumCartons', true, 'أقل كمية للطلب بالكرتونة: عدد صحيح.'],
      ['barcode', false, 'اختياري. يُحفظ كما هو بالضبط (الأصفار في البداية وحالة الأحرف). خلية فارغة = بدون باركود.'],
      ['imageUrl', false, 'اختياري. رابط https فقط. خلية فارغة = بدون صورة.'],
    ],
  },
  update_products: {
    title: 'تعديل منتجات موجودة',
    summary: 'كل صف يعدّل منتجًا موجودًا محددًا بمعرّفه.',
    effect: 'خلية فارغة = بدون تغيير. لمسح الباركود أو رابط الصورة اكتب __CLEAR__. لا يغيّر الرصيد ولا التفعيل. تغيير عدد القطع ممنوع ما دام للمنتج رصيد أو حجوزات.',
    columns: [
      ['productId', true, 'معرّف المنتج كما يظهر في صفحة المنتج (لا يُستخدم الاسم أبدًا).'],
      ['expectedVersion', true, 'إصدار المنتج الحالي من صفحة المنتج. إن تغيّر المنتج بعدها يُرفض الملف كله.'],
      ['currentName', false, 'اختياري للمراجعة فقط: إن اختلف عن الاسم الحالي يظهر تنبيه.'],
      ['name / brand / category', false, 'القيم الجديدة؛ فارغ = بدون تغيير.'],
      ['cartonPriceEgp / packSize / minimumCartons', false, 'بنفس قواعد الإنشاء؛ فارغ = بدون تغيير.'],
      ['barcode / imageUrl', false, 'قيمة جديدة، أو فارغ = بدون تغيير، أو __CLEAR__ للمسح.'],
    ],
  },
  receive_stock: {
    title: 'استلام مخزون',
    summary: 'كل صف يضيف كمية مستلمة إلى رصيد منتج.',
    effect: 'تُسجل لكل صف حركة استلام في سجل المخزون باسمك مع السبب والمرجع. المحجوز لا يتغير.',
    columns: [
      ['productId', true, 'معرّف المنتج.'],
      ['expectedVersion', true, 'إصدار المنتج الحالي (يتغير مع كل حركة مخزون).'],
      ['quantity', true, 'الكمية المستلمة بالكرتونة: عدد صحيح موجب.'],
      ['reason', true, 'السبب (3–300 حرف)، يظهر في السجل.'],
      ['reference', false, 'اختياري: رقم فاتورة المورد (حتى 100 حرف).'],
      ['currentName', false, 'اختياري للمراجعة فقط.'],
    ],
  },
  set_stock_total: {
    title: 'ضبط الرصيد الفعلي (جرد)',
    summary: 'كل صف يستبدل الرصيد الإجمالي الفعلي لمنتج بقيمة الجرد.',
    effect: 'القيمة تستبدل الرصيد الإجمالي الحالي (ليست إضافة). لا يمكن أن تقل عن الكمية المحجوزة، ولا تُقبل قيمة مساوية للحالي. المحجوز لا يتغير أبدًا.',
    columns: [
      ['productId', true, 'معرّف المنتج.'],
      ['expectedVersion', true, 'إصدار المنتج الحالي.'],
      ['total', true, 'الرصيد الإجمالي الفعلي بعد الجرد بالكرتونة: عدد صحيح ≥ 0.'],
      ['reason', true, 'السبب (3–300 حرف).'],
      ['reference', false, 'اختياري: رقم محضر الجرد.'],
      ['currentName', false, 'اختياري للمراجعة فقط.'],
    ],
  },
};

const FIELD_AR: Record<string, string> = {
  name: 'الاسم',
  brand: 'البراند',
  category: 'القسم',
  barcode: 'الباركود',
  imageUrl: 'الصورة',
  cartonPriceCents: 'سعر الكرتونة',
  packSize: 'القطع/الكرتونة',
  minimumCartons: 'الحد الأدنى',
};

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const num = (v: unknown) => (typeof v === 'number' ? formatInteger(v) : '—');

function ValueText({ field, value }: { field: string; value: unknown }) {
  if (value === null || value === undefined) return <span className="muted">(فارغ)</span>;
  if (field === 'cartonPriceCents' && typeof value === 'number') return <Money cents={value} />;
  if (field === 'barcode' || field === 'imageUrl') return <Ltr mono>{String(value)}</Ltr>;
  return <>{String(value)}</>;
}

function ChangeCell({ mode, row }: { mode: ImportMode; row: ImportRowReport }) {
  const c = row.change;
  if (!c) return <span className="muted">—</span>;
  if (mode === 'create_products') {
    const p = c.product as { name: string; brand: string; category: { labelAr: string }; cartonPriceCents: number; packSize: number; minimumCartons: number; barcode: string | null };
    return (
      <>
        {p.brand} · {p.category.labelAr} · <Money cents={p.cartonPriceCents} /> · {formatInteger(p.packSize)} قطعة/كرتونة · حد أدنى {formatInteger(p.minimumCartons)}
        <br />
        الباركود: {p.barcode ? <Ltr mono>{p.barcode}</Ltr> : 'بدون'} · <Badge tone="neutral">غير مفعّل · رصيد 0</Badge>
      </>
    );
  }
  if (mode === 'update_products') {
    const changes = (c.changes as Array<{ field: string; from: unknown; to: unknown }>) ?? [];
    return (
      <ul className="c-change-list">
        {changes.map((x) => (
          <li key={x.field}>
            {FIELD_AR[x.field] ?? x.field}: <ValueText field={x.field} value={x.from} /> ← <ValueText field={x.field} value={x.to} />
          </li>
        ))}
      </ul>
    );
  }
  const delta = c.delta as number;
  return (
    <>
      الإجمالي {num(c.onHandBefore)} ← <strong>{num(c.onHandAfter)}</strong> (<Ltr>{delta > 0 ? `+${formatInteger(delta)}` : `−${formatInteger(-delta)}`}</Ltr>)
      <br />
      المحجوز {num(c.reserved)} (لا يتغير) · المتاح بعدها {num(c.availableAfter)}
    </>
  );
}

function RowsTable({ mode, rows, caption }: { mode: ImportMode; rows: ImportRowReport[]; caption: string }) {
  return (
    <DataTable
      caption={caption}
      captionHidden
      rows={rows}
      rowKey={(r) => String(r.recordNo)}
      columns={[
        { key: 'n', header: 'السجل', nowrap: true, rowHeader: true, cell: (r) => <>#{r.recordNo}<br /><span className="muted">سطر {r.line}</span></> },
        {
          key: 'p',
          header: 'المنتج',
          wide: true,
          cell: (r) => (
            <>
              {r.productName ?? <span className="muted">—</span>}
              {r.productId ? (
                <>
                  <br />
                  <Ltr mono className="muted">{r.productId}</Ltr>
                </>
              ) : null}
            </>
          ),
        },
        { key: 's', header: 'الحالة', nowrap: true, cell: (r) => (r.status === 'ok' ? <Badge tone="success" icon="check">صالح</Badge> : <Badge tone="danger" icon="x">خطأ</Badge>) },
        { key: 'c', header: 'التغيير المقترح', wide: true, cell: (r) => <ChangeCell mode={mode} row={r} /> },
        {
          key: 'e',
          header: 'الأخطاء والتنبيهات',
          wide: true,
          cell: (r) =>
            r.errors.length || r.warnings.length ? (
              <ul className="c-change-list">
                {r.errors.map((e, i) => (
                  <li key={`e${i}`} className="c-field__error">
                    {e.field ? <Ltr mono>{e.field}</Ltr> : null} {e.message}
                  </li>
                ))}
                {r.warnings.map((w, i) => (
                  <li key={`w${i}`} className="muted">
                    تنبيه: {w}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted">—</span>
            ),
        },
      ]}
    />
  );
}

/** Errors as a plain list (readable on phones, where the table scrolls sideways). */
function RowErrors({ rows }: { rows: ImportRowReport[] }) {
  const bad = rows.filter((r) => r.errors.length > 0);
  if (bad.length === 0) return null;
  const shown = bad.slice(0, 50);
  return (
    <Notice tone="danger" title={`أخطاء في ${formatInteger(bad.length)} سجل`}>
      <ul className="c-change-list">
        {shown.map((r) => (
          <li key={r.recordNo}>
            السجل #{r.recordNo} (سطر {r.line}): {r.errors.map((e) => e.message).join(' — ')}
          </li>
        ))}
      </ul>
      {bad.length > shown.length ? <p>و{formatInteger(bad.length - shown.length)} سجل آخر بها أخطاء (انظر الجدول).</p> : null}
    </Notice>
  );
}

function ResultView({ result }: { result: ImportResult }) {
  const r = result.import;
  const stock = r.mode === 'receive_stock' || r.mode === 'set_stock_total';
  return (
    <section className="c-card stack" aria-labelledby="imp-result">
      <h2 id="imp-result" className="c-card__title">
        <Icon name="check" /> {result.replayed ? 'الاستيراد مسجل من قبل — لم يتكرر' : 'تم الاستيراد'}
      </h2>
      <p>
        الحالة: <Badge tone="success">مُنفّذ (committed)</Badge> · النوع: {MODES[r.mode].title} · السجلات: {formatInteger(r.recordCount)} · {formatDateTime(r.createdAt)}
      </p>
      <p className="c-request-ref">
        رقم عملية الاستيراد: <Ltr mono>{r.id}</Ltr>
      </p>
      {r.mode === 'create_products' ? <Notice tone="info">المنتجات أُنشئت غير مفعّلة وبرصيد صفر. الخطوة التالية: استلام الرصيد ثم التفعيل.</Notice> : null}
      <DataTable
        caption="نتيجة الاستيراد"
        captionHidden
        rows={r.items}
        rowKey={(i) => String(i.recordNo)}
        columns={[
          { key: 'n', header: 'السجل', nowrap: true, rowHeader: true, cell: (i) => `#${i.recordNo}` },
          { key: 'p', header: 'المنتج', wide: true, cell: (i) => <a href={href(`/admin/products/${i.productId}`)}>{i.productName}</a> },
          { key: 'v', header: 'الإصدار بعدها', numeric: true, cell: (i) => formatInteger(i.productVersionAfter) },
          { key: 'l', header: stock ? 'حركة المخزون' : 'المخزون', nowrap: true, cell: (i) => <a href={href(`/admin/inventory/${i.productId}`)}>{i.ledgerId ? `حركة #${i.ledgerId}` : 'سجل الحركات'}</a> },
        ]}
      />
    </section>
  );
}

export function ImportPage({ csrf }: { csrf: SessionCsrfToken }) {
  const { handleAuthFailure } = useIdentity();
  const toast = useToast();
  const op = useOperation<ImportCommitPayload, ImportResult>(SLOT, { label: 'استيراد CSV', href: '/admin/imports' }, (p) => commitImport(csrf, p));
  const [mode, setMode] = useState<ImportMode>('create_products');
  const [file, setFile] = useState<{ name: string; bytes: number; b64: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewFailure, setPreviewFailure] = useState<ApiFailure | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [randomError, setRandomError] = useState(false);
  const [reconfirm, setReconfirm] = useState(false);
  const [templateQ, setTemplateQ] = useState('');
  /** Re-validation requested after re-authentication; runs once the page has the NEW session/CSRF token. */
  const [revalidate, setRevalidate] = useState<{ mode: ImportMode; file: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = op.unresolved;

  // An operation kept by the coordinator (e.g. after navigating away) defines what this page shows.
  const kept = op.state.status === 'unknown' || op.state.status === 'sending' || op.state.status === 'reauth' ? op.state.payload : null;
  const activeMode = kept?.mode ?? mode;

  const runPreview = async (m: ImportMode, b64: string) => {
    setPreviewBusy(true);
    setPreviewFailure(null);
    setPreview(null);
    const r = await previewImport(csrf, m, b64);
    setPreviewBusy(false);
    if (r.ok) setPreview(r.data);
    else if (!handleAuthFailure(r)) setPreviewFailure(r);
  };

  useEffect(() => {
    if (!revalidate) return;
    setRevalidate(null);
    void runPreview(revalidate.mode, revalidate.file);
  }, [revalidate, csrf]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = op.state.status === 'done' && !op.state.handled ? op.state.result.import.id : null;
  useEffect(() => {
    if (done === null || op.state.status !== 'done') return;
    op.markHandled();
    toast(op.state.result.replayed ? 'هذا الاستيراد مسجل من قبل؛ لم يتكرر.' : 'تم الاستيراد.', 'success');
    setPreview(null);
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const rejected = op.state.status === 'rejected' ? op.state.failure : null;
  const rejectedRows = rejected && Array.isArray(rejected.current?.rows) ? (rejected.current.rows as unknown[]).filter(isImportRowReport) : [];
  const rejectedFileErrors = rejected && Array.isArray(rejected.current?.fileErrors) ? (rejected.current.fileErrors as Array<{ message: string }>) : [];

  const startOver = () => {
    if (locked) return;
    if (op.state.status !== 'idle') op.reset();
    setReconfirm(false);
  };

  const onFile = async (f: File | undefined) => {
    startOver();
    setPreview(null);
    setPreviewFailure(null);
    setFileError(null);
    setFile(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) return setFileError('اختر ملف CSV فقط (امتداد ‎.csv). ملفات Excel (xlsx) غير مدعومة: احفظها بصيغة «CSV UTF-8» أولًا.');
    if (f.size === 0) return setFileError('الملف فارغ.');
    if (f.size > MAX_FILE_BYTES) return setFileError('حجم الملف أكبر من 1 ميجابايت.');
    const bytes = new Uint8Array(await f.arrayBuffer());
    setFile({ name: f.name, bytes: bytes.length, b64: toBase64(bytes) });
  };

  const confirm = () => {
    setConfirming(false);
    if (!file || !preview?.previewToken) return;
    let operationKey: string;
    try {
      operationKey = newRequestKey(); // one key per confirmed import intention; a retry reuses it
    } catch (err) {
      if (err instanceof SecureRandomUnavailableError) return setRandomError(true);
      throw err;
    }
    setReconfirm(false);
    op.run({ mode: preview.mode, file: file.b64, operationKey, previewToken: preview.previewToken }, `${MODES[preview.mode].title}: ${file.name} (${formatInteger(preview.summary.records)} سجل)`);
  };

  const info = MODES[activeMode];
  return (
    <section className="stack" aria-labelledby="imp-title">
      <div className="c-page-header">
        <div>
          <h1 id="imp-title">استيراد CSV</h1>
          <p className="c-page-header__desc">ملف CSV ‏(UTF-8) حتى 1 ميجابايت و1000 صف. كل الملف يُنفّذ أو لا شيء. المعاينة لا تكتب شيئًا ولا تحجز البيانات.</p>
        </div>
        <a className="c-button c-button--secondary" href={href('/admin/imports/history')}>
          عمليات الاستيراد المنفّذة
        </a>
      </div>

      {randomError ? <Notice tone="danger">{SECURE_RANDOM_MESSAGE}</Notice> : null}
      <OperationNotice
        state={op.state}
        label={op.label}
        onRetry={op.retry}
        onDiscard={() => {
          op.reset();
          setPreview(null);
        }}
        onReauthenticated={() => {
          // Identity refreshed. Re-validate the SAME file; a NEW confirmation (new key) is required.
          const p = op.state.status === 'reauth' ? op.state.payload : null;
          op.reset();
          setReconfirm(true);
          if (p) {
            setMode(p.mode);
            // The page may have been left and re-opened meanwhile: keep the exact same bytes.
            if (!file) setFile({ name: 'الملف السابق', bytes: Math.floor((p.file.length * 3) / 4), b64: p.file });
            setRevalidate({ mode: p.mode, file: p.file });
          }
        }}
        historyHint="قائمة المنتجات وسجل حركات المخزون"
      />
      {reconfirm && op.state.status === 'idle' ? <Notice tone="info">تم تأكيد هويتك. لم يُنفّذ أي استيراد: راجع المعاينة المحدّثة ثم أكّد من جديد.</Notice> : null}
      {op.state.status === 'done' ? <ResultView result={op.state.result} /> : null}

      <fieldset className="c-card stack" disabled={locked}>
        <legend className="c-card__title">1. نوع الاستيراد</legend>
        <div className="c-mode-grid" role="radiogroup" aria-label="نوع الاستيراد">
          {(Object.keys(MODES) as ImportMode[]).map((m) => (
            <label key={m} className={`c-mode${activeMode === m ? ' c-mode--selected' : ''}`}>
              <input
                type="radio"
                name="import-mode"
                value={m}
                checked={activeMode === m}
                onChange={() => {
                  startOver();
                  setMode(m);
                  setPreview(null);
                  setPreviewFailure(null);
                }}
              />
              <span>
                <strong>{MODES[m].title}</strong>
                <br />
                <span className="muted">{MODES[m].summary}</span>
              </span>
            </label>
          ))}
        </div>
        <Notice tone={activeMode === 'set_stock_total' ? 'warning' : 'info'}>
          <p>{info.effect}</p>
        </Notice>
        <details className="c-filter-more" open>
          <summary>الأعمدة والقالب</summary>
          <div className="stack">
            <p>
              <a className="c-button c-button--secondary" href={importTemplateUrl(activeMode)} download>
                <Icon name="download" /> تنزيل قالب «{info.title}» (CSV UTF-8)
              </a>
            </p>
            {activeMode !== 'create_products' ? (
              <div className="c-card stack">
                <h3 className="c-card__title">قالب معبّأ بالمنتجات الحالية</h3>
                <p className="muted">
                  يحتوي على معرّف كل منتج وإصداره الحالي والاسم الحالي للمراجعة. أعمدة {activeMode === 'update_products' ? 'التعديل' : activeMode === 'receive_stock' ? 'الكمية والسبب' : 'الإجمالي الفعلي والسبب'}{' '}
                  <strong>فارغة</strong> عمدًا؛ املأ ما تحتاجه واحذف باقي الصفوف (الصف بلا قيم يُرفض). القالب يصبح قديمًا بعد أي تعديل أو حركة مخزون على المنتج. هذا ملف
                  للاستيراد: لا تُضاف فيه علامة ' للحماية، والاسم الذي قد يُفسَّر كمعادلة يُترك فارغًا. برامج الجداول قد تحذف الأصفار في بداية الأرقام عند الحفظ.
                </p>
                <Field label="تصفية بالاسم أو الماركة أو الباركود (اختياري)">
                  {(p) => <TextInput {...p} value={templateQ} onChange={(e) => setTemplateQ(e.target.value)} />}
                </Field>
                <ExportButton
                  view={false}
                  label="تنزيل القالب المعبّأ"
                  run={() => prefilledTemplate(csrf, activeMode as 'update_products' | 'receive_stock' | 'set_stock_total', templateQ.trim() ? { q: templateQ.trim() } : {})}
                />
              </div>
            ) : null}
            <DataTable
              caption={`أعمدة ${info.title}`}
              rows={info.columns}
              rowKey={(c) => c[0]}
              columns={[
                { key: 'c', header: 'العمود', nowrap: true, rowHeader: true, cell: (c) => <Ltr mono>{c[0]}</Ltr> },
                { key: 'r', header: 'مطلوب', nowrap: true, cell: (c) => (c[1] ? 'نعم' : 'اختياري') },
                { key: 'd', header: 'المعنى والصيغة', wide: true, cell: (c) => c[2] },
              ]}
            />
            <ul className="c-change-list muted">
              <li>صف العناوين أولًا بنفس الأسماء تمامًا (حالة الأحرف مهمة)؛ لا أعمدة إضافية. ترتيب الأعمدة حر.</li>
              <li>الأرقام بالأرقام 0-9 فقط، بدون فواصل آلاف أو مسافات أو صيغة أُسّية. الكميات أعداد صحيحة بالكرتونة.</li>
              <li>برامج الجداول (مثل Excel) قد تحذف الأصفار في بداية الباركود عند فتح الملف أو حفظه؛ ما حُذف لا يمكن لهذا النظام استرجاعه. اجعل عمود الباركود «نصًا» قبل الكتابة وراجع المعاينة.</li>
              <li>احفظ الملف بصيغة «CSV UTF-8». الخلايا التي تحتوي على فاصلة أو علامة اقتباس توضع بين علامتي اقتباس.</li>
              <li>معرّف المنتج وإصداره يظهران في صفحة المنتج وصفحة المخزون.</li>
            </ul>
          </div>
        </details>
      </fieldset>

      <div className="c-card stack">
        <h2 className="c-card__title">2. الملف</h2>
        <div className="c-field">
          <label className="c-field__label" htmlFor="imp-file">
            ملف CSV
          </label>
          <input ref={inputRef} id="imp-file" className="c-input" type="file" accept=".csv,text/csv" disabled={locked} onChange={(e) => void onFile(e.target.files?.[0])} aria-describedby="imp-file-hint" />
          <span id="imp-file-hint" className="c-field__hint">
            حتى 1 ميجابايت و1000 صف. يُرسل الملف كما هو إلى الخادم للتحقق؛ لا يُحفظ.
          </span>
          {fileError ? (
            <span className="c-field__error" role="alert">
              <Icon name="alert" />
              {fileError}
            </span>
          ) : null}
        </div>
        {kept ? <p className="muted">الملف مرتبط بالعملية المعلّقة أعلاه ولا يمكن تغييره حتى تُحسم.</p> : null}
        <Button icon="search" disabled={!file || locked} busy={previewBusy} busyLabel="جارٍ التحقق…" onClick={() => file && void runPreview(activeMode, file.b64)}>
          معاينة والتحقق
        </Button>
        {previewFailure ? <ErrorState failure={previewFailure} onRetry={() => file && void runPreview(activeMode, file.b64)} /> : null}
      </div>

      {rejected && (rejectedRows.length || rejectedFileErrors.length) ? (
        <section className="c-card stack" aria-labelledby="imp-rejected">
          <h2 id="imp-rejected" className="c-card__title">لم يُستورد أي سجل — الأخطاء عند التأكيد</h2>
          {rejectedFileErrors.map((e, i) => (
            <p key={i} className="c-field__error">
              {e.message}
            </p>
          ))}
          <RowErrors rows={rejectedRows} />
          {rejectedRows.length ? <RowsTable mode={activeMode} rows={rejectedRows} caption="السجلات المرفوضة" /> : null}
          <p>صحّح الملف أو حدّث الإصدارات ثم أعد المعاينة. لم يُطبّق أي سجل من الملف.</p>
          <RequestRef requestId={rejected.requestId} />
        </section>
      ) : null}
      {rejected && (rejected.code === 'IMPORT_PREVIEW_EXPIRED' || rejected.code === 'IMPORT_PREVIEW_INVALID') && file ? (
        <Button variant="secondary" icon="refresh" onClick={() => void runPreview(activeMode, file.b64)}>
          إعادة المعاينة
        </Button>
      ) : null}

      {preview ? (
        <section className="c-card stack" aria-labelledby="imp-preview">
          <h2 id="imp-preview" className="c-card__title">
            3. المعاينة — {MODES[preview.mode].title}
          </h2>
          <p role="status">
            الملف: {file?.name ?? '—'} · {formatInteger(preview.file.bytes)} بايت · السجلات {formatInteger(preview.summary.records)} · صالحة {formatInteger(preview.summary.valid)} · بها أخطاء{' '}
            {formatInteger(preview.summary.invalid)}
          </p>
          {preview.fileErrors.length ? (
            <Notice tone="danger" title="أخطاء في الملف كله">
              <ul className="c-change-list">
                {preview.fileErrors.map((e, i) => (
                  <li key={i}>{e.message}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <RowErrors rows={preview.rows} />
          {preview.rows.length ? <RowsTable mode={preview.mode} rows={preview.rows} caption="معاينة السجلات" /> : null}
          {preview.previewToken ? (
            <>
              <Notice tone="info">
                <p>
                  المعاينة ليست حجزًا: إن تغيّرت المنتجات أو الأرصدة قبل التأكيد يُرفض الملف كله ولا يُطبّق أي سجل. صالحة حتى {preview.expiresAt ? formatDateTime(preview.expiresAt) : '—'}.
                </p>
              </Notice>
              <Button icon="upload" disabled={locked} onClick={() => setConfirming(true)}>
                تأكيد الاستيراد…
              </Button>
            </>
          ) : (
            <Notice tone="warning">
              <p>لا يمكن التأكيد: صحّح كل الأخطاء في الملف ثم اختره من جديد وأعد المعاينة. لا يُستورد جزء من الملف.</p>
            </Notice>
          )}
        </section>
      ) : null}

      <ConfirmDialog open={confirming && preview !== null} title="تأكيد الاستيراد" confirmLabel="تنفيذ الاستيراد" onCancel={() => setConfirming(false)} onConfirm={confirm}>
        {preview ? (
          <>
            <p>
              {MODES[preview.mode].title}: {formatInteger(preview.summary.records)} سجل من «{file?.name}». تُنفّذ كل السجلات معًا أو لا يُنفّذ أي منها.
            </p>
            <p>{MODES[preview.mode].effect}</p>
            <p className="muted">يُعاد التحقق من كل سجل على البيانات الحالية لحظة التنفيذ.</p>
          </>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
