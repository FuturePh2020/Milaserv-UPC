import { useState } from 'react';
import type { SessionCsrfToken } from '../../api/client.ts';
import { exportFile, getInventoryReport, getMovementsReport, getOrdersReport, getProductsReport } from '../../api/admin.ts';
import { ORDER_STATES, type OrderState } from '../../api/contracts.ts';
import { AvailabilityBadge } from '../../components/Badges.tsx';
import { Button } from '../../components/Button.tsx';
import { DataTable } from '../../components/DataTable.tsx';
import { EmptyState, ErrorState, Notice, SkeletonLines } from '../../components/Feedback.tsx';
import { Field, Select, TextInput } from '../../components/Form.tsx';
import { Ltr } from '../../components/Text.tsx';
import { formatInteger } from '../../format.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { ORDER_STATE_LABEL, STOCK_STATUS_LABEL } from '../../labels.ts';
import { href, navigate } from '../../router.tsx';
import { ExportButton } from './ExportButton.tsx';

/**
 * Operational reports (stage 14). Definitions are shown with every table. Amounts are ORDER VALUES
 * from immutable order snapshots, never collected revenue, paid sales, profit or receivables.
 * Money arrives as decimal strings of integer piastres and is formatted with BigInt (exact).
 */

type Tab = 'orders' | 'products' | 'inventory' | 'movements';
const TABS: Array<[Tab, string]> = [
  ['orders', 'الطلبات حسب الحالة'],
  ['products', 'المنتجات المطلوبة'],
  ['inventory', 'المخزون الحالي'],
  ['movements', 'حركات المخزون'],
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Exact money from a piastre string ("1234567" -> "12,345.67 ج.م"). */
export function MoneyText({ cents }: { cents: string }) {
  const v = BigInt(cents);
  const neg = v < 0n;
  const a = neg ? -v : v;
  return (
    <span className="num">
      <bdi dir="ltr" className="ltr">
        {neg ? '−' : ''}
        {(a / 100n).toLocaleString('en-US')}.{String(a % 100n).padStart(2, '0')}
      </bdi>{' '}
      ج.م
    </span>
  );
}
const bigInt = (s: string) => {
  const v = BigInt(s);
  return v < 0n ? `−${(-v).toLocaleString('en-US')}` : v > 0n ? `+${v.toLocaleString('en-US')}` : '0';
};

const MOVEMENT: Record<string, [string, string]> = {
  opening: ['رصيد افتتاحي', 'رصيد أولي مسجل عند بدء التشغيل.'],
  receipt: ['استلام', 'زيادة الرصيد الإجمالي ببضاعة مستلمة (يدويًا أو بالاستيراد).'],
  'correction:correction_delta': ['تسوية بفرق', 'تعديل الرصيد الإجمالي بفرق موجب أو سالب مع سبب.'],
  'correction:set_total': ['جرد (ضبط الإجمالي)', 'استبدال الرصيد الإجمالي بقيمة الجرد؛ الفرق هو ما يظهر هنا.'],
  correction: ['تسوية', 'تسوية مسجلة بدون نوع فرعي.'],
  reserve: ['حجز لطلب مؤكد', 'تأكيد طلب يزيد المحجوز ولا يغيّر الإجمالي.'],
  release: ['إلغاء حجز', 'إلغاء طلب مؤكد يعيد المحجوز إلى المتاح.'],
  ship: ['خصم بالشحن', 'شحن طلب يخصم من الإجمالي ومن المحجوز معًا.'],
  import: ['استيراد', 'نوع مسموح في قاعدة البيانات ولم يُستخدم حتى الآن (استيراد CSV يُسجل كاستلام أو جرد).'],
};

function Definitions({ children }: { children: React.ReactNode }) {
  return (
    <details className="c-filter-more c-definitions" open>
      <summary>تعريف التقرير</summary>
      <div className="stack">{children}</div>
    </details>
  );
}

function RangeFields({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (s: string) => void; setTo: (s: string) => void }) {
  return (
    <>
      <div className="c-filter-bar__filter">
        <Field label="من تاريخ">{(p) => <TextInput {...p} ltr type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
      </div>
      <div className="c-filter-bar__filter">
        <Field label="إلى تاريخ (شامل)">{(p) => <TextInput {...p} ltr type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
      </div>
    </>
  );
}

function OrdersTab({ query, csrf }: { query: URLSearchParams; csrf: SessionCsrfToken }) {
  const today = cairoToday();
  const from = DATE.test(query.get('from') ?? '') ? query.get('from')! : `${today.slice(0, 8)}01`;
  const to = DATE.test(query.get('to') ?? '') ? query.get('to')! : today;
  const merchantId = /^[0-9a-f-]{36}$/.test(query.get('merchantId') ?? '') ? query.get('merchantId')! : undefined;
  const demo = (['include', 'only'] as const).find((d) => d === query.get('demo'));
  const q = { from, to, merchantId, demo };
  const data = useLoad(`r-orders:${JSON.stringify(q)}`, (signal) => getOrdersReport(q, signal));
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const [d, setD] = useState<string>(demo ?? 'exclude');
  const [contact, setContact] = useState(false);
  const [state, setState] = useState<string>('');
  return (
    <div className="stack">
      <form className="c-filter-bar" onSubmit={(e) => { e.preventDefault(); navigate('/admin/reports', { tab: 'orders', from: f, to: t, merchantId, demo: d === 'exclude' ? undefined : d }); }}>
        <RangeFields from={f} to={t} setFrom={setF} setTo={setT} />
        <div className="c-filter-bar__filter">
          <Field label="الطلبات التجريبية">
            {(p) => (
              <Select {...p} value={d} onChange={(e) => setD(e.target.value)}>
                <option value="exclude">مستبعدة</option>
                <option value="include">مضمّنة</option>
                <option value="only">التجريبية فقط</option>
              </Select>
            )}
          </Field>
        </div>
        <Button type="submit" variant="secondary" icon="search">عرض</Button>
      </form>
      {merchantId ? <Notice tone="info"><p>تاجر واحد فقط (<Ltr mono>{merchantId}</Ltr>). <a href={href('/admin/reports', { tab: 'orders', from, to })}>كل التجار</a></p></Notice> : null}
      <Definitions>
        <p>
          <strong>التاريخ:</strong> وقت <em>إنشاء</em> الطلب بتوقيت القاهرة، من بداية يوم «من» حتى نهاية يوم «إلى» (شاملًا).
        </p>
        <p>
          <strong>الحالة:</strong> الحالة <em>الحالية</em> لكل طلب؛ كل طلب يُحسب في حالة واحدة فقط. الملغاة معروضة منفصلة ولا تدخل في سطر «كل الحالات عدا الملغاة».
        </p>
        <p>
          <strong>القيم:</strong> من لقطة كل طلب وقت إنشائه: إجمالي البضاعة، الشحن، الضريبة، والإجمالي (يشمل الشحن والضريبة). هذه <strong>قيمة طلبات</strong> وليست إيرادًا
          محصّلًا ولا مبيعات مدفوعة ولا ربحًا ولا مديونيات؛ النظام لا يعرف الدفع أو التحصيل.
        </p>
      </Definitions>
      {data.status === 'loading' ? <SkeletonLines lines={6} label="جارٍ حساب التقرير…" /> : null}
      {data.status === 'error' ? <ErrorState failure={data.failure} onRetry={data.reload} /> : null}
      {data.status === 'ok' ? (
        <DataTable
          caption={`الطلبات حسب الحالة من ${data.data.range.from} إلى ${data.data.range.to} (${data.data.range.timeZone})`}
          rows={[...data.data.states.map((s) => ({ key: s.state, label: ORDER_STATE_LABEL[s.state], ...s })), { key: 'all', label: 'كل الحالات عدا الملغاة (قيمة طلبات)', ...data.data.notCancelled }]}
          rowKey={(r) => r.key}
          columns={[
            { key: 's', header: 'الحالة الحالية', rowHeader: true, cell: (r) => (r.key === 'all' ? <strong>{r.label}</strong> : r.label) },
            { key: 'n', header: 'عدد الطلبات', numeric: true, cell: (r) => formatInteger(r.orders) },
            { key: 'g', header: 'إجمالي البضاعة', numeric: true, cell: (r) => <MoneyText cents={r.subtotalCents} /> },
            { key: 'h', header: 'الشحن', numeric: true, cell: (r) => <MoneyText cents={r.shippingCents} /> },
            { key: 't', header: 'الضريبة', numeric: true, cell: (r) => <MoneyText cents={r.taxCents} /> },
            { key: 'v', header: 'الإجمالي', numeric: true, cell: (r) => <MoneyText cents={r.totalCents} /> },
          ]}
        />
      ) : null}
      <div className="c-card stack">
        <h2 className="c-card__title">التصدير</h2>
        <ExportButton label="تصدير هذا التقرير (CSV)" run={() => exportFile(csrf, { type: 'report_orders', filters: { from, to, ...(merchantId ? { merchantId } : {}), ...(demo ? { demo } : {}) } })} />
        <Field label="حالة الطلبات في ملف الطلبات">
          {(p) => (
            <Select {...p} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">كل الحالات</option>
              {ORDER_STATES.map((s) => <option key={s} value={s}>{ORDER_STATE_LABEL[s]}</option>)}
            </Select>
          )}
        </Field>
        <label className="cluster">
          <input type="checkbox" checked={contact} onChange={(e) => setContact(e.target.checked)} /> تضمين بيانات الاتصال بالمشتري (اسم المسؤول، الهاتف، العنوان) — بيانات شخصية؛ اخترها فقط عند الحاجة
        </label>
        <ExportButton
          label="تصدير قائمة الطلبات للفترة (CSV)"
          note="بحد أقصى 10000 طلب؛ إن زادت يُرفض الطلب ولا يُقتطع جزء منه."
          run={() => exportFile(csrf, { type: 'orders', includeBuyerContact: contact, filters: { from, to, ...(state ? { state } : {}), ...(merchantId ? { merchantId } : {}), ...(demo ? { demo } : {}) } })}
        />
      </div>
    </div>
  );
}

function ProductsTab({ query, csrf }: { query: URLSearchParams; csrf: SessionCsrfToken }) {
  const today = cairoToday();
  const from = DATE.test(query.get('from') ?? '') ? query.get('from')! : `${today.slice(0, 8)}01`;
  const to = DATE.test(query.get('to') ?? '') ? query.get('to')! : today;
  const raw = (query.get('states') ?? '').split(',').filter((s): s is OrderState => (ORDER_STATES as readonly string[]).includes(s));
  const states = raw.length ? raw : ORDER_STATES.filter((s) => s !== 'cancelled');
  const q = { from, to, states: states.join(',') };
  const data = useLoad(`r-products:${JSON.stringify(q)}`, (signal) => getProductsReport(q, signal));
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const [sel, setSel] = useState<OrderState[]>(states);
  return (
    <div className="stack">
      <form className="c-filter-bar" onSubmit={(e) => { e.preventDefault(); if (sel.length) navigate('/admin/reports', { tab: 'products', from: f, to: t, states: sel.join(',') }); }}>
        <RangeFields from={f} to={t} setFrom={setF} setTo={setT} />
        <fieldset className="c-filter-bar__filter c-checks">
          <legend>حالات الطلبات المحسوبة</legend>
          {ORDER_STATES.map((s) => (
            <label key={s} className="cluster">
              <input type="checkbox" checked={sel.includes(s)} onChange={(e) => setSel(e.target.checked ? [...sel, s] : sel.filter((x) => x !== s))} /> {ORDER_STATE_LABEL[s]}
            </label>
          ))}
        </fieldset>
        <Button type="submit" variant="secondary" icon="search" disabled={sel.length === 0}>عرض</Button>
      </form>
      <Definitions>
        <p><strong>الكراتين:</strong> الكميات <em>المطلوبة</em> في أسطر الطلبات (وليست المشحونة) للحالات المختارة فقط. الافتراضي: كل الحالات عدا الملغاة.</p>
        <p><strong>القيمة:</strong> مجموع إجمالي الأسطر بأسعار وقت الطلب (بدون شحن أو ضريبة). <strong>التاريخ:</strong> وقت إنشاء الطلب بتوقيت القاهرة. الطلبات التجريبية مستبعدة.</p>
        <p>الاسم المعروض هو الاسم <em>الحالي</em> للمنتج؛ الطلبات نفسها تحتفظ بالاسم وقت الطلب.</p>
      </Definitions>
      {data.status === 'loading' ? <SkeletonLines lines={6} label="جارٍ حساب التقرير…" /> : null}
      {data.status === 'error' ? <ErrorState failure={data.failure} onRetry={data.reload} /> : null}
      {data.status === 'ok' && data.data.items.length === 0 ? <EmptyState title="لا توجد أسطر طلبات مطابقة" /> : null}
      {data.status === 'ok' && data.data.items.length ? (
        <>
          <DataTable
            caption="المنتجات المطلوبة"
            captionHidden
            rows={data.data.items}
            rowKey={(r) => r.productId}
            columns={[
              { key: 'n', header: 'المنتج (الاسم الحالي)', wide: true, rowHeader: true, cell: (r) => <><a href={href(`/admin/products/${r.productId}`)}>{r.name}</a><br /><span className="muted">{r.brand}</span></> },
              { key: 'o', header: 'عدد الطلبات', numeric: true, cell: (r) => formatInteger(r.orders) },
              { key: 'c', header: 'الكراتين المطلوبة', numeric: true, cell: (r) => BigInt(r.cartons).toLocaleString('en-US') },
              { key: 'v', header: 'قيمة الأسطر وقت الطلب', numeric: true, cell: (r) => <MoneyText cents={r.valueCents} /> },
            ]}
          />
          <p role="status">
            الإجمالي: {formatInteger(data.data.totals.products)} منتج · {BigInt(data.data.totals.cartons).toLocaleString('en-US')} كرتونة · <MoneyText cents={data.data.totals.valueCents} />
          </p>
        </>
      ) : null}
      <ExportButton label="تصدير هذا التقرير (CSV)" run={() => exportFile(csrf, { type: 'report_products', filters: q })} />
    </div>
  );
}

function InventoryTab({ query, csrf }: { query: URLSearchParams; csrf: SessionCsrfToken }) {
  const status = (['out_of_stock', 'low_stock', 'normal'] as const).find((s) => s === query.get('status'));
  const q = { ...(status ? { status } : {}) };
  const data = useLoad(`r-inv:${status ?? ''}`, (signal) => getInventoryReport(q, signal));
  return (
    <div className="stack">
      <div className="cluster">
        {(['', 'out_of_stock', 'low_stock', 'normal'] as const).map((s) => (
          <a key={s || 'all'} className={`c-chip${(status ?? '') === s ? ' c-chip--active' : ''}`} href={href('/admin/reports', { tab: 'inventory', status: s || undefined })} {...((status ?? '') === s ? { 'aria-current': 'true' as const } : {})}>
            {s ? STOCK_STATUS_LABEL[s] : 'الكل'}
          </a>
        ))}
      </div>
      <Definitions>
        <p>الحالة <em>الآن</em> (ليست لتاريخ سابق). <strong>الإجمالي</strong> = الكراتين الفعلية المسجلة في النظام؛ <strong>المحجوز</strong> = لطلبات مؤكدة أو قيد التجهيز؛ <strong>المتاح</strong> = الإجمالي − المحجوز.</p>
        <p>التصنيف حسب حد الكمية المنخفضة الحالي: المتاح 0 = غير متوفر؛ من 1 حتى الحد = كمية محدودة؛ أكثر = متوفر.</p>
      </Definitions>
      {data.status === 'loading' ? <SkeletonLines lines={6} label="جارٍ حساب التقرير…" /> : null}
      {data.status === 'error' ? <ErrorState failure={data.failure} onRetry={data.reload} /> : null}
      {data.status === 'ok' ? (
        <>
          <p role="status">
            حد الكمية المنخفضة: {formatInteger(data.data.threshold)} · المنتجات: {formatInteger(data.data.totals.products)} · الإجمالي {BigInt(data.data.totals.onHand).toLocaleString('en-US')} · المحجوز{' '}
            {BigInt(data.data.totals.reserved).toLocaleString('en-US')} · المتاح {BigInt(data.data.totals.available).toLocaleString('en-US')} كرتونة
          </p>
          {data.data.items.length === 0 ? <EmptyState title="لا توجد منتجات مطابقة" /> : (
            <DataTable
              caption="المخزون الحالي"
              captionHidden
              rows={data.data.items}
              rowKey={(r) => r.productId}
              columns={[
                { key: 'n', header: 'المنتج', wide: true, rowHeader: true, cell: (r) => <><a href={href(`/admin/inventory/${r.productId}`)}>{r.name}</a><br /><span className="muted">{r.brand}{r.active ? '' : ' · غير مفعّل'}</span></> },
                { key: 's', header: 'الحالة', nowrap: true, cell: (r) => <AvailabilityBadge status={r.status} /> },
                { key: 'h', header: 'الإجمالي', numeric: true, cell: (r) => formatInteger(r.onHand) },
                { key: 'r', header: 'المحجوز', numeric: true, cell: (r) => formatInteger(r.reserved) },
                { key: 'a', header: 'المتاح', numeric: true, cell: (r) => formatInteger(r.available) },
              ]}
            />
          )}
        </>
      ) : null}
      <ExportButton label="تصدير المخزون الحالي (CSV)" run={() => exportFile(csrf, { type: 'inventory', filters: q })} />
    </div>
  );
}

function MovementsTab({ query, csrf }: { query: URLSearchParams; csrf: SessionCsrfToken }) {
  const today = cairoToday();
  const from = DATE.test(query.get('from') ?? '') ? query.get('from')! : `${today.slice(0, 8)}01`;
  const to = DATE.test(query.get('to') ?? '') ? query.get('to')! : today;
  const q = { from, to };
  const data = useLoad(`r-mov:${from}:${to}`, (signal) => getMovementsReport(q, signal));
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  return (
    <div className="stack">
      <form className="c-filter-bar" onSubmit={(e) => { e.preventDefault(); navigate('/admin/reports', { tab: 'movements', from: f, to: t }); }}>
        <RangeFields from={f} to={t} setFrom={setF} setTo={setT} />
        <Button type="submit" variant="secondary" icon="search">عرض</Button>
      </form>
      <Definitions>
        <p><strong>التاريخ:</strong> وقت تسجيل الحركة في سجل المخزون بتوقيت القاهرة. الأرقام صافي التغيّر بالكرتونة لكل نوع.</p>
        <ul className="c-change-list">
          {Object.entries(MOVEMENT).map(([k, [label, desc]]) => <li key={k}><strong>{label}</strong>: {desc}</li>)}
        </ul>
      </Definitions>
      {data.status === 'loading' ? <SkeletonLines lines={6} label="جارٍ حساب التقرير…" /> : null}
      {data.status === 'error' ? <ErrorState failure={data.failure} onRetry={data.reload} /> : null}
      {data.status === 'ok' && data.data.items.length === 0 ? <EmptyState title="لا توجد حركات في هذه الفترة" /> : null}
      {data.status === 'ok' && data.data.items.length ? (
        <DataTable
          caption="حركات المخزون"
          captionHidden
          rows={data.data.items}
          rowKey={(r) => r.type}
          columns={[
            { key: 't', header: 'نوع الحركة', rowHeader: true, cell: (r) => MOVEMENT[r.type]?.[0] ?? r.type },
            { key: 'n', header: 'عدد الحركات', numeric: true, cell: (r) => formatInteger(r.movements) },
            { key: 'p', header: 'عدد المنتجات', numeric: true, cell: (r) => formatInteger(r.products) },
            { key: 'h', header: 'صافي تغيّر الإجمالي', numeric: true, cell: (r) => <Ltr>{bigInt(r.onHandDelta)}</Ltr> },
            { key: 'r', header: 'صافي تغيّر المحجوز', numeric: true, cell: (r) => <Ltr>{bigInt(r.reservedDelta)}</Ltr> },
          ]}
        />
      ) : null}
      <ExportButton label="تصدير هذا التقرير (CSV)" run={() => exportFile(csrf, { type: 'report_movements', filters: q })} />
    </div>
  );
}

export function ReportsPage({ query, csrf }: { query: URLSearchParams; csrf: SessionCsrfToken }) {
  const tab = (TABS.find(([t]) => t === query.get('tab'))?.[0] ?? 'orders') as Tab;
  return (
    <section className="stack" aria-labelledby="rep-title">
      <div className="c-page-header">
        <div>
          <h1 id="rep-title">التقارير</h1>
          <p className="c-page-header__desc">تقارير تشغيلية من بيانات النظام. التواريخ بتوقيت القاهرة. القيم قيمة طلبات وليست تحصيلًا أو أرباحًا.</p>
        </div>
      </div>
      <nav className="cluster c-tabs" aria-label="أنواع التقارير">
        {TABS.map(([t, label]) => (
          <a key={t} className={`c-chip${t === tab ? ' c-chip--active' : ''}`} href={href('/admin/reports', { tab: t })} {...(t === tab ? { 'aria-current': 'page' as const } : {})}>
            {label}
          </a>
        ))}
      </nav>
      {tab === 'orders' ? <OrdersTab key={query.toString()} query={query} csrf={csrf} /> : null}
      {tab === 'products' ? <ProductsTab key={query.toString()} query={query} csrf={csrf} /> : null}
      {tab === 'inventory' ? <InventoryTab key={query.toString()} query={query} csrf={csrf} /> : null}
      {tab === 'movements' ? <MovementsTab key={query.toString()} query={query} csrf={csrf} /> : null}
    </section>
  );
}
