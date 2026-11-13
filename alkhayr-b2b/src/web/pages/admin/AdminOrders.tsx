import { useEffect, useState } from 'react';
import { newRequestKey, SECURE_RANDOM_MESSAGE, SecureRandomUnavailableError, type ApiFailure, type SessionCsrfToken } from '../../api/client.ts';
import { getAdminOrder, listAdminOrders, transitionOrder, type TransitionPayload, type TransitionResult } from '../../api/admin.ts';
import { ORDER_STATES, type AdminOrder, type AdminOrderSummary, type OrderState } from '../../api/contracts.ts';
import { AllocationBadge, Badge, DemoBadge, MerchantStatusBadge, OrderStatusBadge } from '../../components/Badges.tsx';
import { Button, ButtonLink } from '../../components/Button.tsx';
import { DataTable, LoadMore } from '../../components/DataTable.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { EmptyState, ErrorState, Notice, SkeletonLines, StateView } from '../../components/Feedback.tsx';
import { FilterBar, SearchInput } from '../../components/Filters.tsx';
import { Field, Select, TextArea } from '../../components/Form.tsx';
import { OrderTimeline } from '../../components/OrderTimeline.tsx';
import { OrderTotals } from '../../components/Summary.tsx';
import { Ltr, Money } from '../../components/Text.tsx';
import { useToast } from '../../components/Toast.tsx';
import { formatDateTime, formatInteger, formatPackSize } from '../../format.ts';
import { useStickyLoad } from '../../hooks/useLoad.ts';
import { useOperation } from '../../hooks/useOperation.ts';
import { usePaged } from '../../hooks/usePaged.ts';
import { ORDER_STATE_LABEL } from '../../labels.ts';
import { href, navigate } from '../../router.tsx';
import { OperationNotice } from './OperationNotice.tsx';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function AdminOrdersPage({ query }: { query: URLSearchParams }) {
  const q: Parameters<typeof listAdminOrders>[0] = {};
  const state = query.get('state');
  if (ORDER_STATES.includes(state as OrderState)) q.state = state as OrderState;
  const text = (query.get('q') ?? '').slice(0, 80);
  if (text.trim()) q.q = text;
  const merchantId = query.get('merchantId') ?? '';
  if (ID.test(merchantId)) q.merchantId = merchantId;
  if (query.get('sort') === 'oldest') q.sort = 'oldest';
  const list = usePaged<AdminOrderSummary>(JSON.stringify(q), (cursor, signal) => listAdminOrders({ ...q, ...(cursor ? { cursor } : {}) }, signal));
  const [search, setSearch] = useState(q.q ?? '');
  const [stateSel, setState] = useState<string>(q.state ?? '');
  const [sortSel, setSort] = useState<string>(q.sort ?? 'newest');
  const apply = () => navigate('/admin/orders', { q: search.trim() || undefined, state: stateSel || undefined, sort: sortSel === 'oldest' ? 'oldest' : undefined, merchantId: q.merchantId });
  return (
    <section className="stack" aria-labelledby="ao-title">
      <div className="c-page-header">
        <div>
          <h1 id="ao-title">الطلبات</h1>
          <p className="c-page-header__desc">مراجعة الطلبات وتأكيدها (حجز المخزون) وتجهيزها وشحنها وتسليمها أو إلغاؤها.</p>
        </div>
      </div>
      {q.merchantId ? (
        <Notice tone="info">
          <p>
            معروض: طلبات تاجر واحد. <a href={href('/admin/orders')}>عرض كل الطلبات</a>
          </p>
        </Notice>
      ) : null}
      <FilterBar label="بحث وتصفية الطلبات" onSubmit={apply} actions={<Button type="submit" variant="secondary" icon="search">تطبيق</Button>}>
        <div className="c-filter-bar__search">
          <SearchInput label="بحث برقم الطلب أو اسم النشاط" value={search} onChange={setSearch} />
        </div>
        <details className="c-filter-more" open={Boolean(q.state || q.sort)}>
          <summary>تصفية وترتيب</summary>
          <div className="c-filter-more__body">
            <div className="c-filter-bar__filter">
              <Field label="حالة الطلب">
                {(p) => (
                  <Select {...p} value={stateSel} onChange={(e) => setState(e.target.value)}>
                    <option value="">كل الحالات</option>
                    {ORDER_STATES.map((s) => <option key={s} value={s}>{ORDER_STATE_LABEL[s]}</option>)}
                  </Select>
                )}
              </Field>
            </div>
            <div className="c-filter-bar__filter">
              <Field label="الترتيب">
                {(p) => (
                  <Select {...p} value={sortSel} onChange={(e) => setSort(e.target.value)}>
                    <option value="newest">الأحدث</option>
                    <option value="oldest">الأقدم</option>
                  </Select>
                )}
              </Field>
            </div>
          </div>
        </details>
      </FilterBar>
      {list.status === 'loading' ? <SkeletonLines lines={6} label="جارٍ تحميل الطلبات…" /> : null}
      {list.status === 'error' && list.failure ? <ErrorState failure={list.failure} onRetry={list.reload} /> : null}
      {list.status === 'ok' && list.items.length === 0 ? <EmptyState title="لا توجد طلبات مطابقة" /> : null}
      {list.status === 'ok' && list.items.length > 0 ? (
        <>
          <DataTable
            caption="قائمة الطلبات"
            captionHidden
            rows={list.items}
            rowKey={(o) => o.id}
            columns={[
              { key: 'n', header: 'رقم الطلب', nowrap: true, rowHeader: true, cell: (o) => <a href={href(`/admin/orders/${o.id}`)}><Ltr mono>{o.displayNumber}</Ltr></a> },
              { key: 'b', header: 'التاجر', wide: true, cell: (o) => <>{o.buyerBusinessName}<br /><span className="muted">{o.buyerGovernorate}</span>{o.isDemo ? <> <DemoBadge /></> : null}</> },
              { key: 's', header: 'الحالة', nowrap: true, cell: (o) => <OrderStatusBadge state={o.state} /> },
              { key: 'l', header: 'الأصناف', numeric: true, cell: (o) => formatInteger(o.lineCount) },
              { key: 't', header: 'الإجمالي', numeric: true, cell: (o) => <Money cents={o.totalCents} /> },
              { key: 'd', header: 'التاريخ', nowrap: true, cell: (o) => <time dateTime={new Date(o.createdAt).toISOString()}>{formatDateTime(o.createdAt)}</time> },
            ]}
          />
          <LoadMore shown={list.items.length} hasMore={list.nextCursor !== null} busy={list.loadingMore} onLoadMore={list.loadMore} />
          {list.moreFailure ? <ErrorState failure={list.moreFailure} onRetry={list.loadMore} /> : null}
        </>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ detail

type Target = TransitionPayload['to'];
const NEEDS_APPROVED_BUYER: ReadonlySet<Target> = new Set(['confirmed', 'preparing', 'shipped']);

const ACTION_LABEL: Record<Target, string> = {
  confirmed: 'تأكيد الطلب وحجز المخزون',
  preparing: 'بدء التجهيز',
  shipped: 'تسجيل الشحن',
  delivered: 'تسجيل التسليم',
  cancelled: 'إلغاء الطلب',
};

export function explainTransition(from: OrderState, to: Target): string {
  switch (to) {
    case 'confirmed':
      return 'يحجز كمية كل صنف من الرصيد المتاح دفعة واحدة: إما كل الأصناف أو لا شيء. يتطلب أن تكون المنتجات مفعّلة وبنفس التعبئة المطلوبة وأن يكون التاجر معتمدًا.';
    case 'preparing':
      return 'يسجل بدء التجهيز. لا يغيّر المخزون؛ الحجز يبقى كما هو.';
    case 'shipped':
      return 'يخصم الكميات المحجوزة لهذا الطلب من الرصيد الإجمالي. لا يمكن إلغاء الطلب بعد الشحن.';
    case 'delivered':
      return 'يسجل التسليم. لا يغيّر المخزون. الحالة نهائية.';
    case 'cancelled':
      return from === 'pending'
        ? 'يلغي الطلب. لا يوجد حجز لهذا الطلب، فلا يتغير المخزون. السبب مطلوب ويظهر في سجل الطلب.'
        : 'يلغي الطلب ويعيد الكمية المحجوزة لهذا الطلب فقط إلى المتاح (لا يمس حجوزات الطلبات الأخرى). السبب مطلوب ويظهر في سجل الطلب.';
  }
}

function StockShortage({ failure, order }: { failure: ApiFailure; order: AdminOrder }) {
  const items = failure.current?.items;
  if (!Array.isArray(items)) return null;
  const name = (line: unknown) => order.items.find((i) => i.lineNo === line)?.name ?? `سطر ${String(line)}`;
  return (
    <ul>
      {items.map((raw, i) => {
        const it = raw as { lineNo?: number; requested?: number; available?: number; orderedPackSize?: number; currentPackSize?: number };
        return (
          <li key={i}>
            {name(it.lineNo)}
            {typeof it.requested === 'number' ? ` — مطلوب ${formatInteger(it.requested)}، متاح ${formatInteger(it.available ?? 0)}` : ''}
            {typeof it.orderedPackSize === 'number' ? ` — التعبئة عند الطلب ${formatPackSize(it.orderedPackSize)}، الحالية ${formatPackSize(it.currentPackSize ?? 0)}` : ''}
          </li>
        );
      })}
    </ul>
  );
}

function TransitionPanel({ order, csrf, reload }: { order: AdminOrder; csrf: SessionCsrfToken; reload: () => void }) {
  const toast = useToast();
  const op = useOperation<TransitionPayload, TransitionResult>(`order:${order.id}`, { label: `إجراء على الطلب ${order.displayNumber}`, href: `/admin/orders/${order.id}` }, (p) => transitionOrder(csrf, order.id, p));
  const [draft, setDraft] = useState<{ to: Target; reason: string } | null>(null);
  const [dialog, setDialog] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [randomError, setRandomError] = useState(false);
  /** Re-authenticated with a prepared (unsent) action: it waits for an explicit new confirmation. */
  const [reconfirm, setReconfirm] = useState(false);
  const allowed = order.allowedTransitions.filter((s): s is Target => s !== 'pending');
  const buyerBlocked = order.merchant.currentStatus !== 'approved';
  const locked = op.unresolved;

  // Handled once, even if it finished while the operator was on another screen.
  const doneEvent = op.state.status === 'done' && !op.state.handled ? op.state.result.operation.eventId : null;
  useEffect(() => {
    if (doneEvent === null || op.state.status !== 'done') return;
    op.markHandled();
    toast(op.state.result.replayed ? 'هذه العملية نُفذت من قبل؛ لم تتكرر.' : `تم: ${ORDER_STATE_LABEL[op.state.result.operation.toState]}.`, 'success');
    setDraft(null);
    reload();
  }, [doneEvent]); // eslint-disable-line react-hooks/exhaustive-deps
  // A definite refusal: nothing changed; re-read the order so the operator decides on current data.
  const rejected = op.state.status === 'rejected' && !op.state.handled ? op.state.failure : null;
  useEffect(() => {
    if (!rejected) return;
    op.markHandled();
    reload();
  }, [rejected]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (to: Target) => {
    if (locked) return;
    setReconfirm(false);
    if (op.state.status !== 'idle' && op.state.status !== 'reauth') op.reset();
    setDraft((d) => (d && d.to === to ? d : { to, reason: '' }));
    setReasonError(null);
    setDialog(true);
  };

  const confirm = () => {
    if (!draft) return;
    const reason = draft.reason.normalize('NFC').trim();
    if (draft.to === 'cancelled' && reason.length === 0) return setReasonError('سبب الإلغاء مطلوب.');
    if (reason.length > 0 && (reason.length < 3 || reason.length > 300)) return setReasonError('السبب من 3 إلى 300 حرف.');
    let operationKey: string;
    try {
      operationKey = newRequestKey(); // a new key per NEW confirmed intention; retries reuse the payload
    } catch (err) {
      if (err instanceof SecureRandomUnavailableError) {
        setRandomError(true);
        setDialog(false);
        return;
      }
      throw err;
    }
    setDialog(false);
    setReconfirm(false);
    if (op.state.status === 'reauth') op.reset();
    op.run({ to: draft.to, expectedVersion: order.version, operationKey, ...(reason ? { reason } : {}) }, `${ACTION_LABEL[draft.to]} — الطلب ${order.displayNumber}`);
  };

  if (allowed.length === 0 && op.state.status === 'idle') {
    return (
      <div className="c-card">
        <h2 className="c-card__title">الإجراءات</h2>
        <p className="muted">الطلب في حالة نهائية ({ORDER_STATE_LABEL[order.state]})؛ لا توجد إجراءات متاحة.</p>
      </div>
    );
  }

  return (
    <div className="c-card stack" aria-labelledby="tp-title">
      <h2 id="tp-title" className="c-card__title">الإجراءات</h2>
      {randomError ? <Notice tone="danger">{SECURE_RANDOM_MESSAGE}</Notice> : null}
      {buyerBlocked ? (
        <Notice tone="warning" title={`حساب التاجر الآن: ${order.merchant.currentStatus === 'suspended' ? 'موقوف' : 'قيد المراجعة'}`}>
          <p>لا يمكن تأكيد الطلب أو تجهيزه أو شحنه حتى يُعتمد التاجر. الإلغاء (بسبب) وتسجيل تسليم طلب مشحون يبقيان متاحين.</p>
        </Notice>
      ) : null}
      <OperationNotice
        state={op.state}
        label={op.label}
        onRetry={op.retry}
        onDiscard={() => {
          op.reset();
          reload();
        }}
        onReauthenticated={() => {
          // Identity refreshed; re-read the order. The prepared action stays UNSENT until re-confirmed.
          op.reset();
          setReconfirm(true);
          reload();
        }}
        historyHint="سجل الطلب أدناه"
      />
      {op.state.status === 'rejected' ? <StockShortage failure={op.state.failure} order={order} /> : null}
      {reconfirm && draft && op.state.status === 'idle' ? (
        <p>
          الإجراء المحضّر «{ACTION_LABEL[draft.to]}» لم يُنفذ. بعد تأكيد هويتك راجع الطلب ثم{' '}
          <Button size="small" variant="secondary" onClick={() => setDialog(true)}>
            أكّد الإجراء من جديد
          </Button>
        </p>
      ) : null}
      {op.state.status === 'done' ? (
        <Notice tone="success" title={op.state.result.replayed ? 'العملية نُفذت من قبل (لم تتكرر)' : 'تم تنفيذ الإجراء'}>
          <p>
            العملية الأصلية: من «{ORDER_STATE_LABEL[op.state.result.operation.fromState]}» إلى «{ORDER_STATE_LABEL[op.state.result.operation.toState]}» —{' '}
            {formatDateTime(op.state.result.operation.at)}
            {op.state.result.operation.actor ? ` — بواسطة ${op.state.result.operation.actor}` : ''}.
          </p>
          <p>
            حالة الطلب الآن: <OrderStatusBadge state={op.state.result.order.state} /> (الإصدار {op.state.result.order.version}).
          </p>
        </Notice>
      ) : null}
      {allowed.length === 0 ? <p className="muted">الطلب في حالة نهائية ({ORDER_STATE_LABEL[order.state]})؛ لا توجد إجراءات متاحة.</p> : null}
      <ul className="c-action-list">
        {allowed.map((to) => {
          const blocked = buyerBlocked && NEEDS_APPROVED_BUYER.has(to);
          return (
            <li key={to} className="stack">
              <Button variant={to === 'cancelled' ? 'danger' : 'primary'} disabled={locked || blocked} onClick={() => choose(to)}>
                {ACTION_LABEL[to]}…
              </Button>
              <p className="muted">{blocked ? 'غير متاح: حساب التاجر غير معتمد حاليًا.' : explainTransition(order.state, to)}</p>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={dialog && draft !== null}
        title={draft ? `${ACTION_LABEL[draft.to]}؟` : ''}
        confirmLabel={draft ? ACTION_LABEL[draft.to] : ''}
        tone={draft?.to === 'cancelled' ? 'danger' : 'primary'}
        onCancel={() => setDialog(false)}
        onConfirm={confirm}
      >
        {draft ? (
          <>
            <p>
              الطلب <Ltr mono>{order.displayNumber}</Ltr> (الإصدار {order.version}): {explainTransition(order.state, draft.to)}
            </p>
            <Field id="tp-reason" label={draft.to === 'cancelled' ? 'سبب الإلغاء' : 'ملاحظة (اختيارية)'} error={reasonError} required={draft.to === 'cancelled'} hint="من 3 إلى 300 حرف. تظهر في سجل الطلب للإدارة.">
              {(p) => <TextArea {...p} rows={2} value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />}
            </Field>
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

export function AdminOrderDetailPage({ id, csrf }: { id: string; csrf: SessionCsrfToken }) {
  const [gen, setGen] = useState(0);
  const data = useStickyLoad(`aorder:${id}`, gen, (signal) => getAdminOrder(id, signal));
  const reload = () => setGen((g) => g + 1);
  if (data.initialLoading) return <SkeletonLines lines={8} label="جارٍ تحميل الطلب…" />;
  if (!data.data) {
    if (data.failure?.kind === 'not_found') return <StateView icon="orders" title="الطلب غير موجود" />;
    return data.failure ? <ErrorState failure={data.failure} onRetry={data.reload} /> : null;
  }
  const o = data.data;
  return (
    <section className="stack" aria-labelledby="aod-title">
      <p>
        <a href={href('/admin/orders')}>العودة إلى الطلبات</a>
      </p>
      <div className="c-page-header">
        <div>
          <h1 id="aod-title">
            طلب <Ltr mono>{o.displayNumber}</Ltr>
          </h1>
          <p className="c-page-header__desc">
            {formatDateTime(o.createdAt)} · الإصدار {o.version}
          </p>
        </div>
        <div className="cluster">
          <OrderStatusBadge state={o.state} />
          {o.isDemo ? <DemoBadge /> : null}
          <ButtonLink href={href(`/admin/orders/${o.id}/print`)} icon="orders">ملخص للطباعة</ButtonLink>
        </div>
      </div>
      {data.refreshing ? <p className="muted" role="status">جارٍ تحديث البيانات…</p> : null}
      {data.failure ? <ErrorState failure={data.failure} onRetry={data.reload} /> : null}
      <TransitionPanel order={o} csrf={csrf} reload={reload} />
      <div className="c-grid-2">
        <div className="c-card stack">
          <h2 className="c-card__title">بيانات المشتري وقت الطلب</h2>
          <p>
            {o.buyer.businessName} — {o.buyer.contactName}
            <br />
            <Ltr>{o.buyer.phone}</Ltr>
            <br />
            {o.buyer.governorate}، {o.buyer.address}
          </p>
          {o.note ? <p>ملاحظة التاجر: {o.note}</p> : null}
        </div>
        <div className="c-card stack">
          <h2 className="c-card__title">حساب التاجر الآن</h2>
          <p>
            <a href={href(`/admin/merchants/${o.merchant.id}`)}>{o.merchant.currentBusinessName}</a> (<Ltr>{o.merchant.username}</Ltr>) <MerchantStatusBadge status={o.merchant.currentStatus} />
          </p>
        </div>
      </div>
      <section className="stack" aria-labelledby="aod-items">
        <h2 id="aod-items">الأصناف</h2>
        <p className="muted">الاسم والسعر والتعبئة كما كانت وقت الطلب (لا تتغير). عمود «الآن» يعرض حالة المنتج والمخزون الحالية.</p>
        <DataTable
          caption="أصناف الطلب"
          captionHidden
          rows={o.items}
          rowKey={(i) => String(i.lineNo)}
          columns={[
            { key: 'n', header: 'الصنف (وقت الطلب)', wide: true, rowHeader: true, cell: (i) => <><a href={href(`/admin/inventory/${i.productId}`)}>{i.name}</a><br /><span className="muted">{i.brand} · {formatPackSize(i.packSize)}</span></> },
            { key: 'c', header: 'الكراتين', numeric: true, cell: (i) => formatInteger(i.cartons) },
            { key: 'p', header: 'سعر الكرتونة', numeric: true, cell: (i) => <Money cents={i.cartonPriceCents} /> },
            { key: 't', header: 'الإجمالي', numeric: true, cell: (i) => <Money cents={i.lineTotalCents} /> },
            { key: 'a', header: 'حجز هذا الطلب', nowrap: true, cell: (i) => <AllocationBadge status={i.allocation?.status ?? null} /> },
            {
              key: 'now',
              header: 'الآن',
              cell: (i) => (
                <>
                  {i.currentProduct.active ? null : <><Badge tone="danger" icon="x">غير مفعّل</Badge><br /></>}
                  {i.currentProduct.packSize !== i.packSize ? <><Badge tone="warning" icon="alert">التعبئة تغيّرت: {formatPackSize(i.currentProduct.packSize)}</Badge><br /></> : null}
                  <span className="muted">متاح {formatInteger(i.currentProduct.available)} من {formatInteger(i.currentProduct.onHand)}</span>
                </>
              ),
            },
          ]}
        />
        <OrderTotals amounts={o.amounts} />
      </section>
      <section className="stack" aria-labelledby="aod-history">
        <h2 id="aod-history">سجل الطلب</h2>
        <OrderTimeline state={o.state} events={o.events} />
        <EventList order={o} />
      </section>
    </section>
  );
}

/** Every event (including notes on non-cancel transitions), newest first. */
function EventList({ order }: { order: AdminOrder }) {
  const events = [...order.events].reverse();
  return (
    <ol className="c-history">
      {events.map((e) => (
        <li key={e.id}>
          <time dateTime={new Date(e.at).toISOString()}>{formatDateTime(e.at)}</time> — {e.fromState ? `${ORDER_STATE_LABEL[e.fromState]} ← ` : ''}
          {ORDER_STATE_LABEL[e.toState]}
          {e.actor ? ` — ${e.actor}` : ''}
          {e.reason ? <> — {e.reason}</> : null}
        </li>
      ))}
    </ol>
  );
}
