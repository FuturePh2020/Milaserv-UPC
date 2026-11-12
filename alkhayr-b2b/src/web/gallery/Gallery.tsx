import { useState } from 'react';
import { AllocationBadge, AvailabilityBadge, CategoryBadge, DemoBadge, MerchantStatusBadge, OrderStatusBadge } from '../components/Badges.tsx';
import { Button, ButtonLink, IconButton } from '../components/Button.tsx';
import { DataTable, LoadMore } from '../components/DataTable.tsx';
import { ConfirmDialog, Dialog } from '../components/Dialog.tsx';
import { ConflictNotice, EmptyState, ErrorState, Notice, SkeletonLines, Spinner } from '../components/Feedback.tsx';
import { FilterBar, SearchInput } from '../components/Filters.tsx';
import { Field, FormErrors, OtpInput, PasswordInput, Select, TextArea, TextInput } from '../components/Form.tsx';
import { OrderTimeline } from '../components/OrderTimeline.tsx';
import { ProductCard } from '../components/Product.tsx';
import { QuantityStepper } from '../components/QuantityStepper.tsx';
import { OrderTotals } from '../components/Summary.tsx';
import { Ltr, Money } from '../components/Text.tsx';
import { useToast } from '../components/Toast.tsx';
import { formatDateTime, formatLines } from '../format.ts';
import { ORDER_STATE_LABEL } from '../labels.ts';
import { AdminLayout, AuthLayout, MerchantLayout } from '../layouts/Shells.tsx';
import { ForbiddenView, IdentityLoadingScreen, NetworkFailureView, PendingApprovalView, ReauthRequiredView, SessionExpiredView, SignedOutView, UpcomingScreen } from '../layouts/States.tsx';
import { ACCOUNT, ADMIN_ROWS, CONFLICT, FAILURES, FIXTURE_MARKER, LARGE_AMOUNTS, ORDER, PRODUCTS } from './fixtures.ts';

/**
 * DEVELOPMENT-ONLY component gallery (#/__gallery). Everything here is presentational:
 * synthetic fixtures, no API calls, no sessions, no persistence. Buttons that would perform a
 * business action in the real app only change local preview state and say so.
 */
export const GALLERY_PATH = '/__gallery';

const LAYOUTS = ['auth-signed-out', 'loading', 'expired', 'network', 'merchant', 'pending', 'admin', 'reauth', 'forbidden'] as const;
type LayoutName = (typeof LAYOUTS)[number];
const LAYOUT_LABEL: Record<LayoutName, string> = {
  'auth-signed-out': 'غير مسجّل',
  loading: 'تحميل الهوية',
  expired: 'انتهاء الجلسة',
  network: 'تعذّر الاتصال',
  merchant: 'تاجر معتمد',
  pending: 'تاجر قيد المراجعة',
  admin: 'مدير',
  reauth: 'إعادة التحقق الإداري',
  forbidden: 'غير مسموح',
};

const noop = () => undefined;

function Banner() {
  return (
    <p className="g-banner" role="note">
      معرض المكونات — بيانات مصطنعة للمعاينة فقط (بيئة التطوير) · <span className="ltr">{FIXTURE_MARKER}</span> · <a href={`#${GALLERY_PATH}`}>الفهرس</a>
    </p>
  );
}

function LayoutPreview({ name }: { name: LayoutName }) {
  const content = (
    <>
      <UpcomingScreen title="محتوى تجريبي" stage={11} description="مساحة المحتوى داخل الإطار (معاينة)." />
      <div className="c-product-grid">
        {PRODUCTS.slice(0, 3).map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </>
  );
  switch (name) {
    case 'auth-signed-out':
      return (
        <AuthLayout>
          <SignedOutView />
        </AuthLayout>
      );
    case 'loading':
      return <IdentityLoadingScreen />;
    case 'expired':
      return (
        <AuthLayout>
          <SessionExpiredView onContinue={noop} />
        </AuthLayout>
      );
    case 'network':
      return (
        <AuthLayout>
          <NetworkFailureView failure={FAILURES[0]!} onRetry={noop} />
        </AuthLayout>
      );
    case 'merchant':
      return (
        <MerchantLayout kind="merchant" account={ACCOUNT} path="/catalog" onLogout={noop}>
          {content}
        </MerchantLayout>
      );
    case 'pending':
      return (
        <MerchantLayout kind="pending" account={ACCOUNT} path="/account" onLogout={noop}>
          <PendingApprovalView businessName={ACCOUNT.businessName} />
        </MerchantLayout>
      );
    case 'admin':
      return (
        <AdminLayout account={ACCOUNT} path="/admin/orders" onLogout={noop}>
          <AdminTablePreview />
        </AdminLayout>
      );
    case 'reauth':
      return (
        <AdminLayout account={ACCOUNT} path="/admin/orders" onLogout={noop} banner={<p className="l-banner l-banner--warning">مضت أكثر من 15 دقيقة على آخر تحقق؛ ستحتاج لتسجيل الدخول من جديد قبل أي إجراء إداري.</p>}>
          <ReauthRequiredView onSignInAgain={noop} requestId="00000000-0000-4000-8000-0000000000ff" />
        </AdminLayout>
      );
    case 'forbidden':
      return (
        <MerchantLayout kind="merchant" account={ACCOUNT} path="/admin" onLogout={noop}>
          <ForbiddenView home="#/catalog" />
        </MerchantLayout>
      );
  }
}

function AdminTablePreview() {
  const [busy, setBusy] = useState(false);
  return (
    <section>
      <div className="c-page-header">
        <h1>الطلبات (معاينة)</h1>
      </div>
      <DataTable
        caption="الطلبات — بيانات تجريبية"
        rows={ADMIN_ROWS}
        rowKey={(r) => r.id}
        columns={[
          { key: 'n', header: 'رقم الطلب', rowHeader: true, nowrap: true, cell: (r) => <Ltr mono>{r.displayNumber}</Ltr> },
          { key: 'b', header: 'التاجر', wide: true, cell: (r) => r.buyerBusinessName },
          { key: 's', header: 'الحالة', cell: (r) => <OrderStatusBadge state={r.state} /> },
          { key: 'l', header: 'الأصناف', nowrap: true, cell: (r) => formatLines(r.lineCount) },
          { key: 't', header: 'الإجمالي', numeric: true, cell: (r) => <Money cents={r.totalCents} /> },
          { key: 'd', header: 'التاريخ', nowrap: true, cell: (r) => formatDateTime(r.createdAt) },
        ]}
      />
      <LoadMore shown={ADMIN_ROWS.length} hasMore busy={busy} onLoadMore={() => setBusy((b) => !b)} />
    </section>
  );
}

function Swatch({ name, value, note }: { name: string; value: string; note: string }) {
  const paint = (el: HTMLSpanElement | null) => {
    if (el) el.style.background = value; // CSSOM, allowed by the CSP
  };
  return (
    <div className="g-swatch">
      <span className="g-swatch__chip" ref={paint} />
      <strong>{name}</strong>
      <span className="ltr mono">{value}</span>
      <span className="muted">{note}</span>
    </div>
  );
}

function Components() {
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [qty, setQty] = useState<{ value: number | null; text: string }>({ value: 5, text: '5' });
  const [search, setSearch] = useState('');
  return (
    <div className="g-page">
      <h1>معرض مكونات بوابة الخير</h1>
      <Notice tone="info" title="للتطوير فقط">
        <p>جميع البيانات هنا مصطنعة. لا يتصل المعرض بالخادم، ولا ينشئ جلسة، ولا يحفظ أي بيانات، ولا يظهر في نسخة الإنتاج.</p>
      </Notice>

      <section className="g-section" aria-labelledby="g-layouts">
        <h2 id="g-layouts">الإطارات وحالات الهوية</h2>
        <nav className="g-nav" aria-label="معاينة الإطارات">
          {LAYOUTS.map((l) => (
            <ButtonLink key={l} href={`#${GALLERY_PATH}/layout/${l}`}>
              {LAYOUT_LABEL[l]}
            </ButtonLink>
          ))}
        </nav>
      </section>

      <section className="g-section" aria-labelledby="g-tokens">
        <h2 id="g-tokens">الألوان (مع نسب التباين المحسوبة)</h2>
        <div className="g-row">
          <Swatch name="الخلفية" value="#faf7f2" note="لون النص عليها 12.7:1" />
          <Swatch name="الأحمر الأساسي" value="#a72e35" note="أبيض عليه 6.8:1" />
          <Swatch name="الأحمر الداكن" value="#8a242a" note="أبيض عليه 8.9:1" />
          <Swatch name="النص" value="#352c2b" note="على الأبيض 13.6:1" />
          <Swatch name="نص ثانوي" value="#6b5d58" note="على الخلفية 5.9:1" />
          <Swatch name="أزرق الشعار" value="#1f5fae" note="حلقة التركيز فقط" />
        </div>
        <div className="g-row">
          <CategoryBadge id="chocolate" label="شيكولاتة" />
          <CategoryBadge id="candy" label="كاندي" />
          <CategoryBadge id="wafers_biscuits" label="ويفر وبسكويت" />
          <CategoryBadge id="snacks_nuts" label="سناكس ومكسرات" />
        </div>
      </section>

      <section className="g-section" aria-labelledby="g-buttons">
        <h2 id="g-buttons">الأزرار</h2>
        <div className="g-row">
          <Button icon="cart">زر أساسي</Button>
          <Button variant="secondary">زر ثانوي</Button>
          <Button variant="ghost">زر نصي</Button>
          <Button variant="danger">زر حذف/إلغاء</Button>
          <Button busy busyLabel="جارٍ الإرسال…">
            إرسال
          </Button>
          <Button disabled>غير متاح</Button>
          <Button size="small">زر صغير</Button>
          <IconButton icon="refresh" label="تحديث" />
          <IconButton icon="chevron" label="التالي" directional />
        </div>
      </section>

      <section className="g-section" aria-labelledby="g-forms">
        <h2 id="g-forms">حقول الإدخال</h2>
        <div className="g-grid">
          <Field label="اسم النشاط" hint="كما يظهر على الفواتير." required>
            {(p) => <TextInput {...p} defaultValue="متجر تجريبي" />}
          </Field>
          <Field label="رقم الهاتف" error="رقم الهاتف غير صحيح.">
            {(p) => <TextInput {...p} ltr inputMode="tel" defaultValue="0100" />}
          </Field>
          <Field label="كلمة المرور">{(p) => <PasswordInput {...p} autoComplete="current-password" />}</Field>
          <Field label="رمز التحقق (6 أرقام)" hint="من تطبيق المصادقة على هاتفك.">
            {(p) => <OtpInput {...p} />}
          </Field>
          <Field label="المحافظة">
            {(p) => (
              <Select {...p} defaultValue="cairo">
                <option value="cairo">القاهرة</option>
                <option value="giza">الجيزة</option>
              </Select>
            )}
          </Field>
          <Field label="ملاحظة" hint="حتى 500 حرف.">
            {(p) => <TextArea {...p} maxLength={500} />}
          </Field>
        </div>
        <FormErrors fields={[{ path: 'phone', message: 'رقم الهاتف غير صحيح.' }, { path: 'address', message: 'العنوان مطلوب.' }]} />
      </section>

      <section className="g-section" aria-labelledby="g-filters">
        <h2 id="g-filters">البحث والتصفية</h2>
        <FilterBar label="تصفية المنتجات" onSubmit={() => toast('معاينة: لا يتم البحث في المعرض.')} actions={<Button type="submit" variant="secondary" icon="search">بحث</Button>}>
          <div className="c-filter-bar__search">
            <SearchInput label="بحث بالاسم أو الباركود" value={search} onChange={setSearch} placeholder="مثال: شيكولاتة" />
          </div>
          <div className="c-filter-bar__filter">
            <Field label="القسم">
              {(p) => (
                <Select {...p}>
                  <option>كل الأقسام</option>
                  <option>شيكولاتة</option>
                </Select>
              )}
            </Field>
          </div>
        </FilterBar>
      </section>

      <section className="g-section" aria-labelledby="g-badges">
        <h2 id="g-badges">الحالات</h2>
        <div className="g-row">
          {(['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'] as const).map((s) => (
            <OrderStatusBadge key={s} state={s} />
          ))}
        </div>
        <div className="g-row">
          <AvailabilityBadge status="normal" />
          <AvailabilityBadge status="low_stock" />
          <AvailabilityBadge status="out_of_stock" />
          <MerchantStatusBadge status="pending" />
          <MerchantStatusBadge status="approved" />
          <MerchantStatusBadge status="suspended" />
          <AllocationBadge status={null} />
          <AllocationBadge status="reserved" />
          <AllocationBadge status="released" />
          <AllocationBadge status="consumed" />
          <DemoBadge />
        </div>
      </section>

      <section className="g-section" aria-labelledby="g-feedback">
        <h2 id="g-feedback">التحميل والحالات الفارغة والأخطاء</h2>
        <div className="g-grid">
          <div className="c-card">
            <Spinner />
          </div>
          <div className="c-card">
            <SkeletonLines lines={4} />
          </div>
          <div className="c-card">
            <EmptyState title="لا توجد طلبات بعد" message="ستظهر طلباتك هنا بعد إرسالها." />
          </div>
          {FAILURES.map((f) => (
            <div className="c-card" key={f.kind}>
              <ErrorState failure={f} onRetry={() => toast('معاينة: لا تتم إعادة المحاولة في المعرض.')} />
            </div>
          ))}
        </div>
        <ConflictNotice failure={CONFLICT} onReview={() => toast('معاينة: لا توجد بيانات حالية في المعرض.')} />
        <Notice tone="warning" title="منتج غير متاح">
          <p>بعض المنتجات في السلة لم تعد متاحة للطلب. راجع السلة ثم أعد المحاولة.</p>
        </Notice>
      </section>

      <section className="g-section" aria-labelledby="g-products">
        <h2 id="g-products">بطاقات المنتجات (المتاح: حالة فقط، بدون أرقام مخزون)</h2>
        <div className="c-product-grid">
          {PRODUCTS.map((p) => (
            <ProductCard key={p.id} product={p} action={<QuantityStepper value={qty.value} text={qty.text} onChange={setQty} min={p.minimumCartons} disabled={p.availability.status === 'out_of_stock'} />} />
          ))}
        </div>
      </section>

      <section className="g-section" aria-labelledby="g-orders">
        <h2 id="g-orders">مراحل الطلب والإجماليات</h2>
        <div className="g-grid">
          <div className="c-card">
            <h3>
              طلب <Ltr mono>{ORDER.displayNumber}</Ltr> — {ORDER_STATE_LABEL[ORDER.state]}
            </h3>
            <OrderTimeline state={ORDER.state} events={ORDER.events} />
          </div>
          <div className="c-card">
            <h3>طلب ملغي (عرض الإدارة: المنفّذ والسبب)</h3>
            <OrderTimeline
              state="cancelled"
              events={[
                { fromState: null, toState: 'pending', at: ORDER.createdAt },
                { fromState: 'pending', toState: 'confirmed', at: ORDER.createdAt + 3_600_000, actor: 'admin.preview' },
                { fromState: 'confirmed', toState: 'cancelled', at: ORDER.createdAt + 7_200_000, actor: 'admin.preview', reason: 'سبب تجريبي للإلغاء' },
              ]}
            />
          </div>
          <div className="c-card">
            <h3>إجمالي الطلب (من بيانات الطلب المحفوظة)</h3>
            <OrderTotals amounts={ORDER.amounts} />
          </div>
          <div className="c-card">
            <h3>أكبر قيمة مسموحة</h3>
            <OrderTotals amounts={LARGE_AMOUNTS} />
          </div>
        </div>
      </section>

      <section className="g-section" aria-labelledby="g-table">
        <h2 id="g-table">الجداول والتنقل بين الصفحات</h2>
        <AdminTablePreview />
      </section>

      <section className="g-section" aria-labelledby="g-dialogs">
        <h2 id="g-dialogs">النوافذ والتنبيهات</h2>
        <div className="g-row">
          <Button variant="secondary" onClick={() => setDialog(true)}>
            فتح نافذة
          </Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            تأكيد إجراء
          </Button>
          <Button variant="secondary" onClick={() => toast('معاينة: تنبيه معلوماتي.')}>
            تنبيه
          </Button>
          <Button variant="secondary" onClick={() => toast('معاينة: تنبيه خطأ (يبقى حتى إغلاقه).', 'danger')}>
            تنبيه خطأ
          </Button>
        </div>
        <Dialog open={dialog} onClose={() => setDialog(false)} title="نافذة تجريبية" footer={<Button onClick={() => setDialog(false)}>إغلاق</Button>}>
          <p>اضغط Escape أو زر الإغلاق؛ يعود التركيز إلى الزر الذي فتح النافذة.</p>
          <Field label="حقل داخل النافذة">{(p) => <TextInput {...p} data-autofocus />}</Field>
        </Dialog>
        <ConfirmDialog
          open={confirm}
          title="إلغاء الطلب؟"
          confirmLabel="إلغاء الطلب"
          tone="danger"
          busy={confirmBusy}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            // Preview only: shows the busy state, then closes WITHOUT claiming any success.
            setConfirmBusy(true);
            window.setTimeout(() => {
              setConfirmBusy(false);
              setConfirm(false);
              toast('معاينة فقط: لم يُنفَّذ أي إجراء.');
            }, 1200);
          }}
        >
          <p>هذه معاينة لنافذة التأكيد. أثناء التنفيذ يتعطل الزر ويتعذر الإغلاق حتى يصل الرد.</p>
        </ConfirmDialog>
      </section>
    </div>
  );
}

export function Gallery({ path }: { path: string }) {
  const layout = path.startsWith(`${GALLERY_PATH}/layout/`) ? (path.slice(`${GALLERY_PATH}/layout/`.length) as LayoutName) : null;
  return (
    <>
      <Banner />
      {layout && (LAYOUTS as readonly string[]).includes(layout) ? <LayoutPreview name={layout} /> : <Components />}
    </>
  );
}
