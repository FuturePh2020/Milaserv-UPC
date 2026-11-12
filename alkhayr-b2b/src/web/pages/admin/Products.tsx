import { useState, type FormEvent, type ReactNode } from 'react';
import type { ApiFailure, SessionCsrfToken } from '../../api/client.ts';
import { createProduct, getAdminProduct, isAdminProduct, listAdminProducts, updateProduct, type AdminProduct, type AdminProductQuery, type ProductPatch } from '../../api/admin.ts';
import { getCatalogFilters } from '../../api/endpoints.ts';
import { barcodeValue, moneyInputText, parseImageUrl, parseMoneyInput, parseWhole } from '../../admin/logic.ts';
import { Badge, CategoryBadge } from '../../components/Badges.tsx';
import { Button, ButtonLink } from '../../components/Button.tsx';
import { DataTable, LoadMore } from '../../components/DataTable.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { ErrorSummary, type SummaryItem } from '../../components/ErrorSummary.tsx';
import { EmptyState, ErrorState, Notice, SkeletonLines, StateView } from '../../components/Feedback.tsx';
import { FilterBar, SearchInput } from '../../components/Filters.tsx';
import { Field, Select, TextInput } from '../../components/Form.tsx';
import { ProductImage } from '../../components/Product.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Ltr, Money, RequestRef } from '../../components/Text.tsx';
import { formatCartons, formatInteger, formatPackSize } from '../../format.ts';
import { useLoad, useStickyLoad } from '../../hooks/useLoad.ts';
import { usePaged } from '../../hooks/usePaged.ts';
import { href, navigate } from '../../router.tsx';
import { useIdentity } from '../../session/identity.tsx';
import { ReauthPanel } from './Reauth.tsx';

const SORTS = [
  ['newest', 'الأحدث'],
  ['oldest', 'الأقدم'],
  ['name', 'الاسم'],
  ['price_asc', 'السعر: من الأقل'],
  ['price_desc', 'السعر: من الأعلى'],
] as const;

export function ProductsPage({ query }: { query: URLSearchParams }) {
  const q: AdminProductQuery = {};
  const text = (query.get('q') ?? '').slice(0, 80);
  if (text.trim()) q.q = text;
  const cat = query.get('category') ?? '';
  if (/^[a-z][a-z0-9_]{1,39}$/.test(cat)) q.category = cat;
  const active = query.get('active');
  if (active === 'true' || active === 'false') q.active = active;
  const sort = query.get('sort');
  if (SORTS.some(([s]) => s === sort)) q.sort = sort as NonNullable<AdminProductQuery['sort']>;
  const key = JSON.stringify(q);
  const list = usePaged<AdminProduct>(key, (cursor, signal) => listAdminProducts({ ...q, ...(cursor ? { cursor } : {}) }, signal));
  const filters = useLoad('filters', (signal) => getCatalogFilters(signal));
  const [search, setSearch] = useState(q.q ?? '');
  const [category, setCategory] = useState(q.category ?? '');
  const [activeSel, setActive] = useState(q.active ?? '');
  const [sortSel, setSort] = useState(q.sort ?? 'newest');
  const apply = () => navigate('/admin/products', { q: search.trim() || undefined, category: category || undefined, active: activeSel || undefined, sort: sortSel === 'newest' ? undefined : sortSel });
  return (
    <section className="stack" aria-labelledby="products-title">
      <div className="c-page-header">
        <div>
          <h1 id="products-title">المنتجات</h1>
          <p className="c-page-header__desc">بيانات المنتجات وأسعارها وتفعيلها. الرصيد يُدار من شاشة المخزون. الحد الأقصى للكتالوج 5000 منتج.</p>
        </div>
        <ButtonLink href={href('/admin/products/new')} variant="primary" icon="plus">
          منتج جديد
        </ButtonLink>
      </div>
      <FilterBar label="بحث وتصفية المنتجات" onSubmit={apply} actions={<Button type="submit" variant="secondary" icon="search">تطبيق</Button>}>
        <div className="c-filter-bar__search">
          <SearchInput label="بحث بالاسم أو الماركة أو الباركود" value={search} onChange={setSearch} />
        </div>
        <details className="c-filter-more" open={Boolean(q.category || q.active || q.sort)}>
          <summary>تصفية وترتيب</summary>
          <div className="c-filter-more__body">
            <div className="c-filter-bar__filter">
              <Field label="القسم">
                {(p) => (
                  <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">كل الأقسام</option>
                    {filters.status === 'ok' ? filters.data.categories.map((c) => <option key={c.id} value={c.id}>{c.labelAr}</option>) : null}
                  </Select>
                )}
              </Field>
            </div>
            <div className="c-filter-bar__filter">
              <Field label="التفعيل">
                {(p) => (
                  <Select {...p} value={activeSel} onChange={(e) => setActive(e.target.value as typeof activeSel)}>
                    <option value="">الكل</option>
                    <option value="true">مفعّل</option>
                    <option value="false">غير مفعّل</option>
                  </Select>
                )}
              </Field>
            </div>
            <div className="c-filter-bar__filter">
              <Field label="الترتيب">
                {(p) => (
                  <Select {...p} value={sortSel} onChange={(e) => setSort(e.target.value as typeof sortSel)}>
                    {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                )}
              </Field>
            </div>
          </div>
        </details>
      </FilterBar>
      {list.status === 'loading' ? <SkeletonLines lines={6} label="جارٍ تحميل المنتجات…" /> : null}
      {list.status === 'error' && list.failure ? <ErrorState failure={list.failure} onRetry={list.reload} /> : null}
      {list.status === 'ok' && list.items.length === 0 ? <EmptyState title="لا توجد منتجات مطابقة" /> : null}
      {list.status === 'ok' && list.items.length > 0 ? (
        <>
          <DataTable
            caption="قائمة المنتجات"
            captionHidden
            rows={list.items}
            rowKey={(p) => p.id}
            columns={[
              { key: 'n', header: 'المنتج', wide: true, rowHeader: true, cell: (p) => <><a href={href(`/admin/products/${p.id}`)}>{p.name}</a><br /><span className="muted">{p.brand}</span></> },
              { key: 'c', header: 'القسم', nowrap: true, cell: (p) => <CategoryBadge id={p.category.id} label={p.category.labelAr} /> },
              { key: 'a', header: 'الحالة', nowrap: true, cell: (p) => (p.active ? <Badge tone="success" icon="check">مفعّل</Badge> : <Badge tone="neutral" icon="x">غير مفعّل</Badge>) },
              { key: 'p', header: 'سعر الكرتونة', numeric: true, cell: (p) => <Money cents={p.cartonPriceCents} /> },
              { key: 'k', header: 'التعبئة', nowrap: true, cell: (p) => formatPackSize(p.packSize) },
              { key: 's', header: 'المتاح / الإجمالي', numeric: true, cell: (p) => `${formatInteger(p.stock.available)} / ${formatInteger(p.stock.onHand)}` },
              { key: 'b', header: 'الباركود', nowrap: true, cell: (p) => (p.barcode ? <Ltr mono>{p.barcode}</Ltr> : '—') },
            ]}
          />
          <LoadMore shown={list.items.length} hasMore={list.nextCursor !== null} busy={list.loadingMore} onLoadMore={list.loadMore} />
          {list.moreFailure ? <ErrorState failure={list.moreFailure} onRetry={list.loadMore} /> : null}
        </>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ form

interface FormValues {
  name: string;
  brand: string;
  category: string;
  barcode: string;
  imageUrl: string;
  price: string;
  packSize: string;
  minimumCartons: string;
}
const toValues = (p: AdminProduct): FormValues => ({
  name: p.name,
  brand: p.brand,
  category: p.category.id,
  barcode: p.barcode ?? '',
  imageUrl: p.imageUrl ?? '',
  price: moneyInputText(p.cartonPriceCents),
  packSize: String(p.packSize),
  minimumCartons: String(p.minimumCartons),
});
const EMPTY: FormValues = { name: '', brand: '', category: '', barcode: '', imageUrl: '', price: '', packSize: '', minimumCartons: '1' };
const IDS: Record<keyof FormValues, string> = { name: 'pf-name', brand: 'pf-brand', category: 'pf-category', barcode: 'pf-barcode', imageUrl: 'pf-image', price: 'pf-price', packSize: 'pf-pack', minimumCartons: 'pf-min' };
const SERVER_FIELD: Record<string, keyof FormValues> = { name: 'name', brand: 'brand', category: 'category', barcode: 'barcode', imageUrl: 'imageUrl', cartonPriceCents: 'price', packSize: 'packSize', minimumCartons: 'minimumCartons' };

type Validated = { name: string; brand: string; category: string; barcode: string | null; imageUrl: string | null; cartonPriceCents: number; packSize: number; minimumCartons: number };

function validate(v: FormValues): { data: Validated | null; errors: Partial<Record<keyof FormValues, string>> } {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (v.name.trim().length < 2) errors.name = 'اسم المنتج من 2 إلى 160 حرفًا.';
  if (v.brand.trim().length < 1) errors.brand = 'الماركة مطلوبة.';
  if (!v.category) errors.category = 'اختر القسم.';
  if (v.barcode !== '' && !/^[0-9A-Za-z-]{1,32}$/.test(v.barcode)) errors.barcode = 'الباركود من 1 إلى 32 حرفًا (أرقام أو حروف لاتينية أو -)، أو اتركه فارغًا.';
  const image = parseImageUrl(v.imageUrl);
  if (!image.ok) errors.imageUrl = image.message;
  const price = parseMoneyInput(v.price);
  if (!price.ok) errors.price = price.message;
  const pack = parseWhole(v.packSize, 1, 10_000, 'عدد القطع في الكرتونة');
  if (!pack.ok) errors.packSize = pack.message;
  const min = parseWhole(v.minimumCartons, 1, 100_000, 'أقل كمية بالكرتونة');
  if (!min.ok) errors.minimumCartons = min.message;
  if (Object.keys(errors).length || !image.ok || !price.ok || !pack.ok || !min.ok) return { data: null, errors };
  return { data: { name: v.name, brand: v.brand, category: v.category, barcode: barcodeValue(v.barcode), imageUrl: image.value, cartonPriceCents: price.value, packSize: pack.value, minimumCartons: min.value }, errors };
}

function ProductFields({ values, set, errors, categories, packLocked }: { values: FormValues; set: (k: keyof FormValues, v: string) => void; errors: Partial<Record<keyof FormValues, string>>; categories: Array<{ id: string; labelAr: string }>; packLocked: boolean }) {
  const f = (k: keyof FormValues, label: string, control: (p: object) => ReactNode, hint?: string) => (
    <Field id={IDS[k]} label={label} error={errors[k] ?? null} {...(hint ? { hint } : {})} required={k !== 'barcode' && k !== 'imageUrl'}>
      {control}
    </Field>
  );
  return (
    <>
      {f('name', 'اسم المنتج', (p) => <TextInput {...p} value={values.name} onChange={(e) => set('name', e.target.value)} />)}
      {f('brand', 'الماركة', (p) => <TextInput {...p} value={values.brand} onChange={(e) => set('brand', e.target.value)} />)}
      {f('category', 'القسم', (p) => (
        <Select {...p} value={values.category} onChange={(e) => set('category', e.target.value)}>
          <option value="">اختر القسم</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.labelAr}</option>)}
        </Select>
      ))}
      {f('price', 'سعر الكرتونة (جنيه)', (p) => <TextInput {...p} ltr inputMode="decimal" value={values.price} onChange={(e) => set('price', e.target.value)} />, 'بالجنيه حتى قرشين عشريين، مثل 125.50 — لا يتم التقريب.')}
      {f('packSize', 'عدد القطع في الكرتونة', (p) => <TextInput {...p} ltr inputMode="numeric" disabled={packLocked} value={values.packSize} onChange={(e) => set('packSize', e.target.value)} />, packLocked ? 'لا يمكن تغييره أثناء وجود رصيد أو حجوزات لهذا المنتج. صفّر الرصيد بحركة مخزون موثقة أولًا.' : 'عدد صحيح.')}
      {f('minimumCartons', 'أقل كمية للطلب (كرتونة)', (p) => <TextInput {...p} ltr inputMode="numeric" value={values.minimumCartons} onChange={(e) => set('minimumCartons', e.target.value)} />)}
      {f('barcode', 'الباركود (اختياري)', (p) => <TextInput {...p} ltr spellCheck={false} autoCapitalize="off" value={values.barcode} onChange={(e) => set('barcode', e.target.value)} />, 'يُحفظ كما هو بالضبط (الأصفار في البداية وحالة الأحرف). اتركه فارغًا إن لم يوجد.')}
      {f('imageUrl', 'رابط الصورة (اختياري)', (p) => <TextInput {...p} ltr type="url" spellCheck={false} value={values.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} />, 'رابط https فقط. لا يُحمّل الخادم الصورة ولا يرفعها.')}
      {values.imageUrl && parseImageUrl(values.imageUrl).ok ? (
        <div className="c-product__media c-image-preview">
          <ProductImage url={values.imageUrl} name="معاينة الصورة" />
        </div>
      ) : null}
    </>
  );
}

function summaryFrom(errors: Partial<Record<keyof FormValues, string>>): SummaryItem[] {
  return (Object.entries(errors) as Array<[keyof FormValues, string]>).map(([k, message]) => ({ fieldId: IDS[k], message }));
}

function serverErrors(f: ApiFailure): Partial<Record<keyof FormValues, string>> {
  const out: Partial<Record<keyof FormValues, string>> = {};
  for (const e of f.fields) if (SERVER_FIELD[e.path]) out[SERVER_FIELD[e.path]!] = e.message;
  return out;
}

export function ProductCreatePage({ csrf }: { csrf: SessionCsrfToken }) {
  const { handleAuthFailure } = useIdentity();
  const filters = useLoad('filters', (signal) => getCatalogFilters(signal));
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [submits, setSubmits] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [reauth, setReauth] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const set = (k: keyof FormValues, v: string) => setValues((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmits((n) => n + 1);
    const { data, errors: errs } = validate(values);
    setErrors(errs);
    setSummary(summaryFrom(errs));
    setFailure(null);
    setUnknown(false);
    if (!data) return;
    setBusy(true);
    const r = await createProduct(csrf, {
      name: data.name,
      brand: data.brand,
      category: data.category,
      cartonPriceCents: data.cartonPriceCents,
      packSize: data.packSize,
      minimumCartons: data.minimumCartons,
      ...(data.barcode !== null ? { barcode: data.barcode } : {}),
      ...(data.imageUrl !== null ? { imageUrl: data.imageUrl } : {}),
    });
    setBusy(false);
    if (r.ok) {
      navigate(`/admin/products/${r.data.id}`, { created: '1' });
      return;
    }
    if (r.kind === 'reauth_required') return setReauth(true);
    if (r.kind === 'network' || r.kind === 'server' || r.kind === 'unavailable' || r.kind === 'invalid_response') {
      // Creation has no idempotency key: never resent automatically.
      setUnknown(true);
      setFailure(r);
      return;
    }
    if (handleAuthFailure(r)) return;
    setFailure(r);
    const se = serverErrors(r);
    setErrors(se);
    setSummary(Object.keys(se).length ? summaryFrom(se) : [{ message: r.message }]);
  };

  return (
    <section className="stack" aria-labelledby="pc-title">
      <p>
        <a href={href('/admin/products')}>العودة إلى المنتجات</a>
      </p>
      <h1 id="pc-title">منتج جديد</h1>
      <Notice tone="info">
        <p>يُنشأ المنتج <strong>غير مفعّل وبرصيد صفر</strong>. بعد الإنشاء: استلم الرصيد من شاشة المخزون، ثم فعّل المنتج ليظهر للتجار.</p>
      </Notice>
      {reauth ? <ReauthPanel onDone={() => setReauth(false)} /> : null}
      {unknown ? (
        <Notice tone="warning" title="لم يتأكد إنشاء المنتج">
          <p>
            قد يكون المنتج أُنشئ. ابحث عنه في <a href={href('/admin/products', { q: values.name.trim() || undefined })}>قائمة المنتجات</a> قبل إنشائه مرة أخرى، لتجنب التكرار.
          </p>
          {failure ? <RequestRef requestId={failure.requestId} /> : null}
        </Notice>
      ) : null}
      <ErrorSummary title="تعذّر إنشاء المنتج" items={summary} version={submits} />
      {failure && !unknown ? <RequestRef requestId={failure.requestId} /> : null}
      <form className="c-card stack" onSubmit={submit} noValidate>
        <ProductFields values={values} set={set} errors={errors} categories={filters.status === 'ok' ? filters.data.categories : []} packLocked={false} />
        <Button type="submit" busy={busy} busyLabel="جارٍ الإنشاء…" icon="plus">
          إنشاء المنتج (غير مفعّل)
        </Button>
      </form>
    </section>
  );
}

function ProductEditor({ product, csrf, onSaved, reload }: { product: AdminProduct; csrf: SessionCsrfToken; onSaved: (p: AdminProduct) => void; reload: () => void }) {
  const { handleAuthFailure } = useIdentity();
  const toast = useToast();
  const filters = useLoad('filters', (signal) => getCatalogFilters(signal));
  const [base, setBase] = useState(product);
  const [values, setValues] = useState<FormValues>(toValues(product));
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [submits, setSubmits] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [conflict, setConflict] = useState<AdminProduct | null>(null);
  const [reauth, setReauth] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [confirmActive, setConfirmActive] = useState(false);
  const set = (k: keyof FormValues, v: string) => setValues((x) => ({ ...x, [k]: v }));
  const packLocked = base.stock.onHand !== 0 || base.stock.reserved !== 0;
  const categories: Array<{ id: string; labelAr: string }> = [...(filters.status === 'ok' ? filters.data.categories : [])];
  if (!categories.some((c) => c.id === base.category.id)) categories.unshift(base.category);

  const send = async (changes: ProductPatch, after: (p: AdminProduct) => void) => {
    setBusy(true);
    setFailure(null);
    setUnknown(false);
    const r = await updateProduct(csrf, base.id, base.version, changes);
    setBusy(false);
    if (r.ok) return after(r.data);
    if (r.kind === 'reauth_required') return setReauth(true);
    if (r.kind === 'network' || r.kind === 'server' || r.kind === 'unavailable' || r.kind === 'invalid_response') {
      setUnknown(true); // never resent automatically; the current record decides
      setFailure(r);
      return;
    }
    if (handleAuthFailure(r)) return;
    const current = r.current?.product;
    if (r.code === 'VERSION_CONFLICT' && isAdminProduct(current)) {
      setConflict(current); // keep my unsaved values; show the current record
      return;
    }
    if (r.code === 'PACKAGING_LOCKED' && isAdminProduct(current)) setBase(current);
    setFailure(r);
    const se = serverErrors(r);
    setErrors(se);
    setSummary(Object.keys(se).length ? summaryFrom(se) : [{ message: r.message }]);
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    setSubmits((n) => n + 1);
    const { data, errors: errs } = validate(values);
    setErrors(errs);
    setSummary(summaryFrom(errs));
    if (!data) return;
    const changes: ProductPatch = {};
    if (data.name !== base.name) changes.name = data.name;
    if (data.brand !== base.brand) changes.brand = data.brand;
    if (data.category !== base.category.id) changes.category = data.category;
    if (data.barcode !== base.barcode) changes.barcode = data.barcode;
    if (data.imageUrl !== base.imageUrl) changes.imageUrl = data.imageUrl;
    if (data.cartonPriceCents !== base.cartonPriceCents) changes.cartonPriceCents = data.cartonPriceCents;
    if (data.packSize !== base.packSize) changes.packSize = data.packSize;
    if (data.minimumCartons !== base.minimumCartons) changes.minimumCartons = data.minimumCartons;
    if (Object.keys(changes).length === 0) {
      setSummary([{ message: 'لم تغيّر أي حقل.' }]);
      return;
    }
    void send(changes, (p) => {
      toast('تم حفظ بيانات المنتج.', 'success');
      onSaved(p);
    });
  };

  return (
    <>
      {reauth ? <ReauthPanel onDone={() => { setReauth(false); reload(); }} /> : null}
      {unknown ? (
        <Notice tone="warning" title="لم يتأكد الحفظ">
          <p>لم يصل رد مؤكد. لا يُعاد الإرسال تلقائيًا؛ اعرض البيانات الحالية لترى ما حُفظ.</p>
          <Button size="small" variant="secondary" icon="refresh" onClick={reload}>عرض البيانات الحالية</Button>
          {failure ? <RequestRef requestId={failure.requestId} /> : null}
        </Notice>
      ) : null}
      <div className="c-card stack">
        <h2 className="c-card__title">التفعيل</h2>
        <p>
          الحالة: {base.active ? <Badge tone="success" icon="check">مفعّل — يظهر للتجار</Badge> : <Badge tone="neutral" icon="x">غير مفعّل — لا يظهر للتجار</Badge>}
        </p>
        <p className="muted">
          {base.active
            ? 'الإيقاف يمنع الطلبات الجديدة وتأكيد الطلبات المعلّقة، ولا يمس الحجوزات القائمة: الطلبات المؤكدة يمكن تجهيزها وشحنها أو إلغاؤها.'
            : 'التفعيل يُظهر المنتج في كتالوج التجار المعتمدين. الرصيد يُستلم من شاشة المخزون.'}
        </p>
        <Button variant={base.active ? 'danger' : 'primary'} disabled={busy || conflict !== null} onClick={() => setConfirmActive(true)}>
          {base.active ? 'إيقاف المنتج…' : 'تفعيل المنتج…'}
        </Button>
      </div>
      <form className="c-card stack" onSubmit={save} noValidate aria-labelledby="pe-title">
        <h2 id="pe-title" className="c-card__title">بيانات المنتج</h2>
        {conflict ? (
          <Notice tone="warning" title="لم يُحفظ التعديل: تغيّر المنتج من مكان آخر">
            <p>
              ما أدخلته ما زال في النموذج. البيانات الحالية: {conflict.name} — <Money cents={conflict.cartonPriceCents} /> — {formatPackSize(conflict.packSize)} — {conflict.active ? 'مفعّل' : 'غير مفعّل'} (الإصدار {conflict.version}).
            </p>
            <div className="cluster">
              <Button size="small" onClick={() => { setBase(conflict); setConflict(null); }}>إعادة تطبيق تعديلاتي على النسخة الحالية</Button>
              <Button size="small" variant="secondary" onClick={() => { setBase(conflict); setValues(toValues(conflict)); setConflict(null); }}>تجاهل تعديلاتي</Button>
            </div>
          </Notice>
        ) : null}
        <ErrorSummary title="تعذّر حفظ المنتج" items={summary} version={submits} />
        {failure && !unknown ? <RequestRef requestId={failure.requestId} /> : null}
        <ProductFields values={values} set={set} errors={errors} categories={categories} packLocked={packLocked} />
        <Button type="submit" busy={busy} busyLabel="جارٍ الحفظ…" disabled={conflict !== null}>
          حفظ التعديلات
        </Button>
      </form>
      <ConfirmDialog
        open={confirmActive}
        title={base.active ? 'إيقاف المنتج؟' : 'تفعيل المنتج؟'}
        confirmLabel={base.active ? 'إيقاف' : 'تفعيل'}
        tone={base.active ? 'danger' : 'primary'}
        busy={busy}
        onCancel={() => setConfirmActive(false)}
        onConfirm={() =>
          void send({ active: !base.active }, (p) => {
            setConfirmActive(false);
            toast(p.active ? 'تم تفعيل المنتج.' : 'تم إيقاف المنتج.', 'success');
            onSaved(p);
          }).then(() => setConfirmActive(false))
        }
      >
        <p>{base.active ? 'لن يظهر المنتج للتجار ولن يمكن تأكيد طلبات معلّقة تحتويه. الحجوزات القائمة لا تتأثر.' : `سيظهر «${base.name}» في الكتالوج بسعر الكرتونة الحالي.`}</p>
      </ConfirmDialog>
    </>
  );
}

export function ProductEditPage({ id, csrf, created }: { id: string; csrf: SessionCsrfToken; created: boolean }) {
  const [gen, setGen] = useState(0);
  const data = useStickyLoad(`product:${id}`, gen, (signal) => getAdminProduct(id, signal));
  const [saved, setSaved] = useState<AdminProduct | null>(null);
  if (data.initialLoading) return <SkeletonLines lines={8} label="جارٍ تحميل المنتج…" />;
  if (!data.data) {
    if (data.failure?.kind === 'not_found') return <StateView icon="box" title="المنتج غير موجود" actions={<ButtonLink href={href('/admin/products')}>المنتجات</ButtonLink>} />;
    return data.failure ? <ErrorState failure={data.failure} onRetry={data.reload} /> : null;
  }
  const p = saved && saved.id === data.data.id && saved.version > data.data.version ? saved : data.data;
  return (
    <section className="stack" aria-labelledby="pd-title">
      <p>
        <a href={href('/admin/products')}>العودة إلى المنتجات</a>
      </p>
      {created ? (
        <Notice tone="success" title="أُنشئ المنتج">
          <p>المنتج الآن غير مفعّل وبرصيد صفر. الخطوة التالية: <a href={href(`/admin/inventory/${p.id}`)}>استلام رصيد من شاشة المخزون</a>، ثم التفعيل من هنا.</p>
        </Notice>
      ) : null}
      {data.refreshing ? <p className="muted" role="status">جارٍ تحديث البيانات…</p> : null}
      {data.failure ? <ErrorState failure={data.failure} onRetry={data.reload} /> : null}
      <div className="c-page-header">
        <div>
          <h1 id="pd-title">{p.name}</h1>
          <p className="c-page-header__desc">
            {p.brand} · الإصدار {p.version} · الرصيد: {formatCartons(p.stock.onHand)} (محجوز {formatInteger(p.stock.reserved)}، متاح {formatInteger(p.stock.available)})
          </p>
        </div>
        <ButtonLink href={href(`/admin/inventory/${p.id}`)} icon="inventory">
          المخزون والحركات
        </ButtonLink>
      </div>
      <ProductEditor key={`${p.id}:${p.version}`} product={p} csrf={csrf} onSaved={setSaved} reload={() => setGen((g) => g + 1)} />
    </section>
  );
}
