import { useEffect, useState, type FormEvent } from 'react';
import { newRequestKey, SECURE_RANDOM_MESSAGE, SecureRandomUnavailableError, type ApiFailure, type SessionCsrfToken } from '../../api/client.ts';
import { adjustInventory, getLedger, listInventory, type AdjustmentPayload, type AdjustmentResult, type InventoryItem, type LedgerEntry } from '../../api/admin.ts';
import type { StockStatus } from '../../api/contracts.ts';
import { ADJUSTMENT_ERROR, adjustmentPreview, MAX_ON_HAND, parseWhole, type AdjustmentType } from '../../admin/logic.ts';
import { AvailabilityBadge, Badge, DemoBadge } from '../../components/Badges.tsx';
import { Button } from '../../components/Button.tsx';
import { DataTable, LoadMore } from '../../components/DataTable.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { ErrorSummary, type SummaryItem } from '../../components/ErrorSummary.tsx';
import { EmptyState, ErrorState, Notice, SkeletonLines, StateView } from '../../components/Feedback.tsx';
import { FilterBar, SearchInput } from '../../components/Filters.tsx';
import { Field, Select, TextArea, TextInput } from '../../components/Form.tsx';
import { SummaryRow } from '../../components/Summary.tsx';
import { Ltr } from '../../components/Text.tsx';
import { useToast } from '../../components/Toast.tsx';
import { formatDateTime, formatInteger } from '../../format.ts';
import { STOCK_STATUS_LABEL } from '../../labels.ts';
import { useStickyLoad } from '../../hooks/useLoad.ts';
import { useOperation } from '../../hooks/useOperation.ts';
import { usePaged } from '../../hooks/usePaged.ts';
import { href, navigate } from '../../router.tsx';
import { useIdentity } from '../../session/identity.tsx';
import { OperationNotice } from './OperationNotice.tsx';

const STATUSES: StockStatus[] = ['out_of_stock', 'low_stock', 'normal'];
const SORTS = [
  ['name', 'الاسم'],
  ['available_asc', 'المتاح: من الأقل'],
  ['available_desc', 'المتاح: من الأكثر'],
  ['updated', 'آخر تحديث'],
] as const;
type InvSort = (typeof SORTS)[number][0];

/** Distributive Omit: the adjustment without its key (the key is created only at confirmation). */
type AdjustmentDraft = AdjustmentPayload extends infer T ? (T extends unknown ? Omit<T, 'operationKey'> : never) : never;

export const signed = (n: number) => (n > 0 ? `+${formatInteger(n)}` : n < 0 ? `−${formatInteger(-n)}` : '0');

export function InventoryPage({ query }: { query: URLSearchParams }) {
  const q: Parameters<typeof listInventory>[0] = {};
  const text = (query.get('q') ?? '').slice(0, 80);
  if (text.trim()) q.q = text;
  const status = query.get('status');
  if (STATUSES.includes(status as StockStatus)) q.status = status as StockStatus;
  const active = query.get('active');
  if (active === 'true' || active === 'false') q.active = active;
  const sort = query.get('sort');
  if (SORTS.some(([s]) => s === sort)) q.sort = sort as InvSort;
  const list = usePaged<InventoryItem>(JSON.stringify(q), (cursor, signal) => listInventory({ ...q, ...(cursor ? { cursor } : {}) }, signal));
  const [search, setSearch] = useState(q.q ?? '');
  const [statusSel, setStatus] = useState<string>(q.status ?? '');
  const [activeSel, setActive] = useState<string>(q.active ?? '');
  const [sortSel, setSort] = useState<string>(q.sort ?? 'name');
  const apply = () => navigate('/admin/inventory', { q: search.trim() || undefined, status: statusSel || undefined, active: activeSel || undefined, sort: sortSel === 'name' ? undefined : sortSel });
  return (
    <section className="stack" aria-labelledby="inv-title">
      <div className="c-page-header">
        <div>
          <h1 id="inv-title">المخزون</h1>
          <p className="c-page-header__desc">الرصيد الإجمالي والمحجوز للطلبات المؤكدة والمتاح للبيع. كل تغيير يُسجل كحركة في سجل لا يُعدّل.</p>
        </div>
      </div>
      <FilterBar label="بحث وتصفية المخزون" onSubmit={apply} actions={<Button type="submit" variant="secondary" icon="search">تطبيق</Button>}>
        <div className="c-filter-bar__search">
          <SearchInput label="بحث بالاسم أو الماركة أو الباركود" value={search} onChange={setSearch} />
        </div>
        <details className="c-filter-more" open={Boolean(q.status || q.active || q.sort)}>
          <summary>تصفية وترتيب</summary>
          <div className="c-filter-more__body">
            <div className="c-filter-bar__filter">
              <Field label="حالة المخزون">
                {(p) => (
                  <Select {...p} value={statusSel} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">الكل</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{STOCK_STATUS_LABEL[s]}</option>)}
                  </Select>
                )}
              </Field>
            </div>
            <div className="c-filter-bar__filter">
              <Field label="التفعيل">
                {(p) => (
                  <Select {...p} value={activeSel} onChange={(e) => setActive(e.target.value)}>
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
                  <Select {...p} value={sortSel} onChange={(e) => setSort(e.target.value)}>
                    {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                )}
              </Field>
            </div>
          </div>
        </details>
      </FilterBar>
      {list.status === 'loading' ? <SkeletonLines lines={6} label="جارٍ تحميل المخزون…" /> : null}
      {list.status === 'error' && list.failure ? <ErrorState failure={list.failure} onRetry={list.reload} /> : null}
      {list.status === 'ok' && list.items.length === 0 ? <EmptyState title="لا توجد منتجات مطابقة" /> : null}
      {list.status === 'ok' && list.items.length > 0 ? (
        <>
          <DataTable
            caption="أرصدة المخزون"
            captionHidden
            rows={list.items}
            rowKey={(i) => i.product.id}
            columns={[
              { key: 'n', header: 'المنتج', wide: true, rowHeader: true, cell: (i) => <><a href={href(`/admin/inventory/${i.product.id}`)}>{i.product.name}</a><br /><span className="muted">{i.product.brand}{i.product.active ? '' : ' · غير مفعّل'}</span></> },
              { key: 's', header: 'الحالة', nowrap: true, cell: (i) => <AvailabilityBadge status={i.status} /> },
              { key: 'h', header: 'الإجمالي', numeric: true, cell: (i) => formatInteger(i.onHand) },
              { key: 'r', header: 'المحجوز', numeric: true, cell: (i) => formatInteger(i.reserved) },
              { key: 'a', header: 'المتاح', numeric: true, cell: (i) => formatInteger(i.available) },
              { key: 'v', header: 'الإصدار', numeric: true, cell: (i) => formatInteger(i.version) },
            ]}
          />
          <LoadMore shown={list.items.length} hasMore={list.nextCursor !== null} busy={list.loadingMore} onLoadMore={list.loadMore} />
          {list.moreFailure ? <ErrorState failure={list.moreFailure} onRetry={list.loadMore} /> : null}
        </>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ ledger

const KIND_LABEL: Record<LedgerEntry['kind'], string> = {
  opening: 'رصيد افتتاحي',
  receipt: 'استلام',
  correction: 'تسوية',
  reserve: 'حجز لطلب مؤكد',
  release: 'إلغاء حجز',
  ship: 'خصم بالشحن',
  import: 'استيراد',
};
const ADJUSTMENT_LABEL: Record<AdjustmentType, string> = {
  receipt: 'استلام بضاعة (زيادة)',
  correction_delta: 'تسوية بفرق (+ أو −)',
  set_total: 'جرد: ضبط الإجمالي',
};

function LedgerTable({ items }: { items: LedgerEntry[] }) {
  return (
    <DataTable
      caption="سجل حركات المخزون (الأحدث أولًا)"
      captionHidden
      rows={items}
      rowKey={(e) => String(e.id)}
      columns={[
        { key: 't', header: 'الوقت', nowrap: true, rowHeader: true, cell: (e) => <time dateTime={new Date(e.createdAt).toISOString()}>{formatDateTime(e.createdAt)}</time> },
        { key: 'k', header: 'الحركة', nowrap: true, cell: (e) => <>{KIND_LABEL[e.kind]}{e.adjustmentType === 'set_total' ? ' (جرد)' : ''}</> },
        { key: 'd', header: 'فرق الإجمالي', numeric: true, cell: (e) => <Ltr>{signed(e.onHandDelta)}</Ltr> },
        { key: 'rd', header: 'فرق المحجوز', numeric: true, cell: (e) => <Ltr>{signed(e.reservedDelta)}</Ltr> },
        { key: 'a', header: 'بعد: إجمالي / محجوز / متاح', numeric: true, cell: (e) => `${formatInteger(e.onHandAfter)} / ${formatInteger(e.reservedAfter)} / ${formatInteger(e.availableAfter)}` },
        { key: 'r', header: 'السبب والمرجع', wide: true, cell: (e) => <>{e.reason ?? '—'}{e.reference ? <><br /><span className="muted">مرجع: {e.reference}</span></> : null}{e.orderId ? <><br /><a href={href(`/admin/orders/${e.orderId}`)}>الطلب</a></> : null}</> },
        { key: 'u', header: 'بواسطة', nowrap: true, cell: (e) => e.actor ?? '—' },
      ]}
    />
  );
}

/** Older ledger pages appended under the first page; reset whenever the first page is reloaded. */
function LedgerMore({ id, cursor }: { id: string; cursor: string | null }) {
  const { handleAuthFailure } = useIdentity();
  const [items, setItems] = useState<LedgerEntry[]>([]);
  const [next, setNext] = useState(cursor);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const more = async () => {
    if (!next || busy) return;
    setBusy(true);
    setFailure(null);
    const r = await getLedger(id, next);
    setBusy(false);
    if (r.ok) {
      setItems((x) => [...x, ...r.data.items]);
      setNext(r.data.nextCursor);
    } else if (!handleAuthFailure(r)) setFailure(r);
  };
  return (
    <>
      {items.length ? <LedgerTable items={items} /> : null}
      {next ? (
        <Button variant="secondary" busy={busy} busyLabel="جارٍ التحميل…" onClick={() => void more()}>
          عرض حركات أقدم
        </Button>
      ) : null}
      {failure ? <ErrorState failure={failure} onRetry={() => void more()} /> : null}
    </>
  );
}

// ------------------------------------------------------------------ adjustment

function AdjustmentForm({ item, csrf, reload }: { item: InventoryItem; csrf: SessionCsrfToken; reload: () => void }) {
  const toast = useToast();
  const op = useOperation<AdjustmentPayload, AdjustmentResult>(`inventory:${item.product.id}`, { label: `حركة مخزون على «${item.product.name}»`, href: `/admin/inventory/${item.product.id}` }, (p) =>
    adjustInventory(csrf, item.product.id, p),
  );
  const [type, setType] = useState<AdjustmentType>('receipt');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [submits, setSubmits] = useState(0);
  const [pending, setPending] = useState<AdjustmentDraft | null>(null);
  const [randomError, setRandomError] = useState(false);
  const [reconfirm, setReconfirm] = useState(false);
  const locked = op.unresolved;

  // A committed operation (or its replay) is handled ONCE, even if it finished while the operator
  // was on another screen: refresh the record and ledger, announce it, clear the form.
  const doneId = op.state.status === 'done' && !op.state.handled ? op.state.result.operation.id : null;
  useEffect(() => {
    if (doneId === null || op.state.status !== 'done') return;
    op.markHandled();
    reload();
    toast(op.state.result.replayed ? 'هذه العملية سُجلت من قبل؛ لم تتكرر.' : 'سُجلت حركة المخزون.', 'success');
    setAmount('');
    setReason('');
    setReference('');
  }, [doneId]); // eslint-disable-line react-hooks/exhaustive-deps
  // A definite refusal that depends on the current record (stale version, reserved changed) re-reads it once.
  const rejectedCode = op.state.status === 'rejected' && !op.state.handled ? op.state.failure.code : null;
  useEffect(() => {
    if (rejectedCode === null) return;
    op.markHandled();
    if (rejectedCode === 'VERSION_CONFLICT' || rejectedCode === 'INVENTORY_BELOW_RESERVED' || rejectedCode === 'INVENTORY_NEGATIVE') reload();
  }, [rejectedCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (fn: () => void) => {
    if (locked) return;
    if (op.state.status === 'done' || op.state.status === 'rejected') op.reset();
    fn();
  };

  const parsed = parseWhole(amount, type === 'set_total' ? 0 : type === 'receipt' ? 1 : -MAX_ON_HAND, MAX_ON_HAND, type === 'set_total' ? 'الإجمالي الجديد' : type === 'receipt' ? 'الكمية المستلمة' : 'قيمة التسوية', type === 'correction_delta');
  const preview = parsed.ok ? adjustmentPreview({ onHand: item.onHand, reserved: item.reserved }, type, parsed.value) : null;

  const review = (e: FormEvent) => {
    e.preventDefault();
    setSubmits((n) => n + 1);
    const errs: Record<string, string> = {};
    if (!parsed.ok) errs['adj-amount'] = parsed.message;
    else if (preview?.error) errs['adj-amount'] = ADJUSTMENT_ERROR[preview.error];
    const r = reason.normalize('NFC').trim();
    if (r.length < 3 || r.length > 300) errs['adj-reason'] = 'السبب من 3 إلى 300 حرف.';
    const ref = reference.normalize('NFC').trim();
    if (ref.length > 100) errs['adj-ref'] = 'المرجع حتى 100 حرف.';
    setErrors(errs);
    setSummary(Object.entries(errs).map(([fieldId, message]) => ({ fieldId, message })));
    if (Object.keys(errs).length || !parsed.ok) return;
    const common = { expectedVersion: item.version, reason: r, ...(ref ? { reference: ref } : {}) };
    setPending(
      type === 'receipt' ? { type, quantity: parsed.value, ...common } : type === 'correction_delta' ? { type, delta: parsed.value, ...common } : { type, total: parsed.value, ...common },
    );
  };

  const confirm = () => {
    if (!pending) return;
    let operationKey: string;
    try {
      operationKey = newRequestKey(); // one new key per NEW intended operation (never for a retry)
    } catch (err) {
      if (err instanceof SecureRandomUnavailableError) {
        setRandomError(true);
        setPending(null);
        return;
      }
      throw err;
    }
    const payload = { ...pending, operationKey } as AdjustmentPayload;
    setPending(null);
    setReconfirm(false);
    const amountText = payload.type === 'receipt' ? `استلام ${payload.quantity}` : payload.type === 'correction_delta' ? `تسوية ${signed(payload.delta)}` : `ضبط الإجمالي إلى ${payload.total}`;
    op.run(payload, `${amountText} كرتونة على «${item.product.name}»`);
  };

  const pendingPreview = pending ? adjustmentPreview({ onHand: item.onHand, reserved: item.reserved }, pending.type, pending.type === 'receipt' ? pending.quantity : pending.type === 'correction_delta' ? pending.delta : pending.total) : null;

  return (
    <form className="c-card stack" onSubmit={review} noValidate aria-labelledby="adj-title">
      <h2 id="adj-title" className="c-card__title">تسجيل حركة مخزون</h2>
      <p className="muted">
        الكمية المحجوزة ({formatInteger(item.reserved)}) تتغير فقط بتأكيد الطلبات وإلغائها وشحنها، ولا تُعدّل من هنا. السجل لا يُعدّل ولا يُحذف: لتصحيح حركة خاطئة سجّل
        تسوية عكسية بسبب واضح.
      </p>
      {randomError ? <Notice tone="danger">{SECURE_RANDOM_MESSAGE}</Notice> : null}
      <OperationNotice
        state={op.state}
        label={op.label}
        onRetry={op.retry}
        onDiscard={() => {
          op.reset();
          reload();
        }}
        onReauthenticated={() => {
          // The prepared movement stays UNSENT: the operator reviews the refreshed balance and confirms again.
          op.reset();
          setReconfirm(true);
          reload();
        }}
        historyHint="سجل الحركات أدناه"
      />
      {reconfirm && op.state.status === 'idle' ? (
        <Notice tone="info">
          <p>تم تأكيد هويتك. الحركة التي أعددتها <strong>لم تُسجل</strong>؛ راجع الرصيد المحدّث ثم اضغط «مراجعة الحركة» لتأكيدها من جديد.</p>
        </Notice>
      ) : null}
      {op.state.status === 'done' ? (
        <Notice tone="success" title={op.state.result.replayed ? 'العملية مسجلة من قبل (لم تتكرر)' : 'سُجلت الحركة'}>
          <p>
            {KIND_LABEL[op.state.result.operation.kind]}: <Ltr>{signed(op.state.result.operation.onHandDelta)}</Ltr> — الإجمالي بعدها {formatInteger(op.state.result.operation.onHandAfter)}. الرصيد الحالي{' '}
            {formatInteger(op.state.result.product.onHand)} (محجوز {formatInteger(op.state.result.product.reserved)}، متاح {formatInteger(op.state.result.product.available)}).
          </p>
        </Notice>
      ) : null}
      <ErrorSummary title="راجع بيانات الحركة" items={summary} version={submits} />
      <fieldset className="stack" disabled={locked}>
        <legend className="visually-hidden">بيانات الحركة</legend>
        <Field id="adj-type" label="نوع الحركة">
          {(p) => (
            <Select {...p} value={type} onChange={(e) => edit(() => setType(e.target.value as AdjustmentType))}>
              {(Object.keys(ADJUSTMENT_LABEL) as AdjustmentType[]).map((t) => <option key={t} value={t}>{ADJUSTMENT_LABEL[t]}</option>)}
            </Select>
          )}
        </Field>
        <Field
          id="adj-amount"
          label={type === 'receipt' ? 'الكمية المستلمة (كرتونة)' : type === 'correction_delta' ? 'الفرق (كرتونة، سالب للنقص)' : 'الإجمالي الفعلي بعد الجرد (كرتونة)'}
          error={errors['adj-amount'] ?? null}
          required
        >
          {(p) => <TextInput {...p} ltr inputMode={type === 'correction_delta' ? 'text' : 'numeric'} value={amount} onChange={(e) => edit(() => setAmount(e.target.value))} />}
        </Field>
        <Field id="adj-reason" label="السبب" error={errors['adj-reason'] ?? null} hint="من 3 إلى 300 حرف. يظهر في السجل للأبد." required>
          {(p) => <TextArea {...p} rows={2} value={reason} onChange={(e) => edit(() => setReason(e.target.value))} />}
        </Field>
        <Field id="adj-ref" label="المرجع (اختياري)" error={errors['adj-ref'] ?? null} hint="رقم فاتورة المورد أو محضر الجرد.">
          {(p) => <TextInput {...p} value={reference} onChange={(e) => edit(() => setReference(e.target.value))} />}
        </Field>
      </fieldset>
      {preview ? (
        <div className="c-summary" aria-live="polite">
          <SummaryRow label="الإجمالي الحالي" value={formatInteger(preview.before)} />
          <SummaryRow label="الإجمالي المقترح" value={formatInteger(preview.after)} />
          <SummaryRow label="الفرق" value={<Ltr>{signed(preview.delta)}</Ltr>} />
          <SummaryRow label="المحجوز (لا يتغير)" value={formatInteger(preview.reserved)} />
          <SummaryRow label="المتاح بعدها" value={formatInteger(preview.availableAfter)} total />
          {preview.error ? <p className="c-field__error">{ADJUSTMENT_ERROR[preview.error]}</p> : null}
          <p className="muted">معاينة على البيانات المعروضة (الإصدار {item.version}). الخادم يعيد الحساب، ويرفض الحركة إن تغيّر الرصيد قبلها.</p>
        </div>
      ) : null}
      <Button type="submit" disabled={locked}>
        مراجعة الحركة…
      </Button>
      <ConfirmDialog open={pending !== null} title="تأكيد حركة المخزون" confirmLabel="تسجيل الحركة" onCancel={() => setPending(null)} onConfirm={confirm}>
        {pending && pendingPreview ? (
          <>
            <p>
              {ADJUSTMENT_LABEL[pending.type]} على «{item.product.name}»: من {formatInteger(pendingPreview.before)} إلى {formatInteger(pendingPreview.after)} (<Ltr>{signed(pendingPreview.delta)}</Ltr>). المحجوز يبقى{' '}
              {formatInteger(pendingPreview.reserved)}.
            </p>
            <p>السبب: {pending.reason}</p>
            <p className="muted">ستُضاف حركة دائمة إلى السجل ولا يمكن حذفها.</p>
          </>
        ) : null}
      </ConfirmDialog>
    </form>
  );
}

export function InventoryDetailPage({ id, csrf }: { id: string; csrf: SessionCsrfToken }) {
  const [gen, setGen] = useState(0);
  const data = useStickyLoad(`ledger:${id}`, gen, (signal) => getLedger(id, undefined, signal));
  const reload = () => setGen((g) => g + 1);
  if (data.initialLoading) return <SkeletonLines lines={8} label="جارٍ تحميل المخزون…" />;
  if (!data.data) {
    if (data.failure?.kind === 'not_found') return <StateView icon="box" title="المنتج غير موجود" />;
    return data.failure ? <ErrorState failure={data.failure} onRetry={data.reload} /> : null;
  }
  const { product: item, items, nextCursor } = data.data;
  return (
    <section className="stack" aria-labelledby="invd-title">
      <p>
        <a href={href('/admin/inventory')}>العودة إلى المخزون</a> · <a href={href(`/admin/products/${item.product.id}`)}>بيانات المنتج</a>
      </p>
      <div className="c-page-header">
        <div>
          <h1 id="invd-title">{item.product.name}</h1>
          <p className="c-page-header__desc">
            {item.product.brand} · {item.product.active ? 'مفعّل' : 'غير مفعّل'} · المعرّف <Ltr mono>{item.product.id}</Ltr> · الإصدار {item.version}
          </p>
        </div>
        <div className="cluster">
          <AvailabilityBadge status={item.status} />
          {item.product.isDemo ? <DemoBadge /> : null}
        </div>
      </div>
      {data.refreshing ? <p className="muted" role="status">جارٍ تحديث البيانات…</p> : null}
      {data.failure ? <ErrorState failure={data.failure} onRetry={data.reload} /> : null}
      <div className="c-stat-row">
        <div className="c-card"><div className="muted">الرصيد الإجمالي</div><div className="c-stat">{formatInteger(item.onHand)}</div></div>
        <div className="c-card"><div className="muted">المحجوز لطلبات مؤكدة</div><div className="c-stat">{formatInteger(item.reserved)}</div></div>
        <div className="c-card"><div className="muted">المتاح للبيع</div><div className="c-stat">{formatInteger(item.available)}</div></div>
      </div>
      <AdjustmentForm item={item} csrf={csrf} reload={reload} />
      <section className="stack" aria-labelledby="ledger-title">
        <h2 id="ledger-title">سجل الحركات <Badge tone="neutral">الأحدث أولًا</Badge></h2>
        {items.length ? <LedgerTable items={items} /> : <EmptyState title="لا توجد حركات بعد" />}
        <LedgerMore key={`${gen}:${item.version}`} id={id} cursor={nextCursor} />
      </section>
    </section>
  );
}
