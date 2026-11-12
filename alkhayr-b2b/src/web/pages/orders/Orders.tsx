import { useState } from 'react';
import { ORDER_STATES, type CatalogProduct, type OrderState, type OrderSummary } from '../../api/contracts.ts';
import { getOrder, getProduct, listOrders } from '../../api/endpoints.ts';
import { useCart } from '../../cart/CartContext.tsx';
import { addProduct, EMPTY_CART, type Cart } from '../../cart/model.ts';
import { OrderStatusBadge } from '../../components/Badges.tsx';
import { Button, ButtonLink } from '../../components/Button.tsx';
import { DataTable, LoadMore } from '../../components/DataTable.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { EmptyState, ErrorState, Notice, SkeletonLines, StateView } from '../../components/Feedback.tsx';
import { Field, Select } from '../../components/Form.tsx';
import { OrderTimeline } from '../../components/OrderTimeline.tsx';
import { OrderTotals } from '../../components/Summary.tsx';
import { Ltr, Money } from '../../components/Text.tsx';
import { formatCartons, formatDateTime, formatLines, formatPackSize } from '../../format.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { usePaged } from '../../hooks/usePaged.ts';
import { ORDER_STATE_LABEL } from '../../labels.ts';
import { href, navigate } from '../../router.tsx';

export function OrdersPage({ query }: { query: URLSearchParams }) {
  const raw = query.get('state');
  const state = ORDER_STATES.includes(raw as OrderState) ? (raw as OrderState) : undefined;
  const orders = usePaged<OrderSummary>(state ?? '', (cursor, signal) => listOrders({ ...(state ? { state } : {}), ...(cursor ? { cursor } : {}) }, signal));
  return (
    <section className="stack" aria-labelledby="orders-title">
      <div className="c-page-header">
        <div>
          <h1 id="orders-title">طلباتي</h1>
          <p className="c-page-header__desc">طلبات حسابك فقط، الأحدث أولًا.</p>
        </div>
      </div>
      <div className="c-filter-bar">
        <div className="c-filter-bar__filter">
          <Field label="الحالة">
            {(p) => (
              <Select {...p} value={state ?? ''} onChange={(e) => navigate('/orders', { state: e.target.value || undefined })}>
                <option value="">كل الحالات</option>
                {ORDER_STATES.map((s) => (
                  <option key={s} value={s}>
                    {ORDER_STATE_LABEL[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
      {orders.status === 'loading' ? <SkeletonLines lines={5} label="جارٍ تحميل الطلبات…" /> : null}
      {orders.status === 'error' && orders.failure ? <ErrorState failure={orders.failure} onRetry={orders.reload} /> : null}
      {orders.status === 'ok' && orders.items.length === 0 ? (
        <EmptyState title={state ? 'لا توجد طلبات بهذه الحالة' : 'لا توجد طلبات بعد'} actions={<ButtonLink href={href('/catalog')} variant="primary">تصفح الكتالوج</ButtonLink>} />
      ) : null}
      {orders.status === 'ok' && orders.items.length > 0 ? (
        <>
          <DataTable
            caption="قائمة الطلبات"
            captionHidden
            rows={orders.items}
            rowKey={(o) => o.id}
            columns={[
              { key: 'n', header: 'رقم الطلب', rowHeader: true, nowrap: true, cell: (o) => <a href={href(`/orders/${o.id}`)}><Ltr mono>{o.displayNumber}</Ltr></a> },
              { key: 's', header: 'الحالة', nowrap: true, cell: (o) => <OrderStatusBadge state={o.state} /> },
              { key: 'l', header: 'الأصناف', nowrap: true, cell: (o) => `${formatLines(o.lineCount)} · ${formatCartons(o.cartonCount)}` },
              { key: 't', header: 'الإجمالي', numeric: true, cell: (o) => <Money cents={o.totalCents} /> },
              { key: 'd', header: 'تاريخ الطلب', nowrap: true, cell: (o) => formatDateTime(o.createdAt) },
            ]}
          />
          <LoadMore shown={orders.items.length} hasMore={orders.nextCursor !== null} busy={orders.loadingMore} onLoadMore={orders.loadMore} />
          {orders.moreFailure ? <ErrorState failure={orders.moreFailure} onRetry={orders.loadMore} /> : null}
        </>
      ) : null}
    </section>
  );
}

/**
 * Reorder: prepares a NEW cart from the CURRENT catalog (current price, packaging, minimum and
 * availability). Old snapshot prices are never reused, nothing is submitted automatically, and
 * every omitted product is listed.
 */
async function prepareReorder(items: Array<{ productId: string; name: string; cartons: number }>): Promise<{ cart: Cart; omitted: string[]; adjusted: string[] }> {
  let cart: Cart = EMPTY_CART;
  const omitted: string[] = [];
  const adjusted: string[] = [];
  for (const item of items) {
    const r = await getProduct(item.productId);
    if (!r.ok || r.data.availability.status === 'out_of_stock') {
      omitted.push(item.name);
      continue;
    }
    const product: CatalogProduct = r.data;
    const cartons = Math.max(item.cartons, product.minimumCartons);
    if (cartons !== item.cartons) adjusted.push(product.name);
    const next = addProduct(cart, product, cartons);
    if (next.error) omitted.push(item.name);
    else cart = next.cart;
  }
  return { cart, omitted, adjusted };
}

export function OrderDetailPage({ id, received }: { id: string; received: string | null }) {
  const order = useLoad(`order:${id}`, (signal) => getOrder(id, signal));
  const cart = useCart();
  const [reorder, setReorder] = useState<{ status: 'idle' | 'confirm' | 'working' } | { status: 'done'; omitted: string[]; adjusted: string[] }>({ status: 'idle' });

  if (order.status === 'loading') return <SkeletonLines lines={6} label="جارٍ تحميل الطلب…" />;
  if (order.status === 'error') {
    if (order.failure.kind === 'not_found') {
      return <StateView icon="info" title="الطلب غير موجود" message="لا يوجد طلب بهذا الرقم في حسابك." actions={<ButtonLink href={href('/orders')}>طلباتي</ButtonLink>} />;
    }
    return <ErrorState failure={order.failure} onRetry={order.reload} />;
  }
  const o = order.data;
  const runReorder = async () => {
    setReorder({ status: 'working' });
    const r = await prepareReorder(o.items.map((i) => ({ productId: i.productId, name: i.name, cartons: i.cartons })));
    cart.replace(r.cart);
    setReorder({ status: 'done', omitted: r.omitted, adjusted: r.adjusted });
  };
  return (
    <section className="stack" aria-labelledby="order-title">
      <p>
        <a href={href('/orders')}>العودة إلى طلباتي</a>
      </p>
      {received ? (
        <Notice tone="success" title={received === 'replayed' ? 'هذا هو الطلب الذي أُرسل سابقًا' : 'تم استلام طلبك'}>
          <p>
            {received === 'replayed' ? 'تبيّن أن الطلب كان قد استُلم من قبل؛ لم يُنشأ طلب ثانٍ. ' : ''}
            حالة الطلب الآن «{ORDER_STATE_LABEL[o.state]}». لا يُحجز المخزون لطلب قيد المراجعة؛ يُحجز عند تأكيد الإدارة.
          </p>
        </Notice>
      ) : null}
      <div className="c-page-header">
        <div>
          <h1 id="order-title">
            طلب <Ltr mono>{o.displayNumber}</Ltr>
          </h1>
          <p className="c-page-header__desc">أُنشئ في {formatDateTime(o.createdAt)} — البيانات أدناه كما سُجلت وقت الطلب.</p>
        </div>
        <OrderStatusBadge state={o.state} />
      </div>
      <div className="c-card">
        <h2 className="c-card__title">مراحل الطلب</h2>
        {/* Trader events carry no administrator names or reasons (API contract). */}
        <OrderTimeline state={o.state} events={o.events} />
      </div>
      <DataTable
        caption="أصناف الطلب (كما سُجلت وقت الطلب)"
        rows={o.items}
        rowKey={(i) => String(i.lineNo)}
        columns={[
          { key: 'name', header: 'الصنف', wide: true, rowHeader: true, cell: (i) => <>{i.name}<br /><span className="muted">{i.brand}{i.barcode ? <> · <Ltr mono>{i.barcode}</Ltr></> : null}</span></> },
          { key: 'pack', header: 'التعبئة', nowrap: true, cell: (i) => formatPackSize(i.packSize) },
          { key: 'price', header: 'سعر الكرتونة', numeric: true, cell: (i) => <Money cents={i.cartonPriceCents} /> },
          { key: 'qty', header: 'الكمية', nowrap: true, cell: (i) => formatCartons(i.cartons) },
          { key: 'total', header: 'الإجمالي', numeric: true, cell: (i) => <Money cents={i.lineTotalCents} /> },
        ]}
      />
      <div className="c-card">
        <h2 className="c-card__title">الإجمالي</h2>
        <OrderTotals amounts={o.amounts} />
      </div>
      <div className="c-card">
        <h2 className="c-card__title">بيانات التسليم (وقت الطلب)</h2>
        <dl className="c-summary">
          <div className="c-summary__row"><dt>النشاط</dt><dd>{o.buyer.businessName}</dd></div>
          <div className="c-summary__row"><dt>المسؤول</dt><dd>{o.buyer.contactName}</dd></div>
          <div className="c-summary__row"><dt>الهاتف</dt><dd><Ltr>{o.buyer.phone}</Ltr></dd></div>
          <div className="c-summary__row"><dt>العنوان</dt><dd>{o.buyer.governorate} — {o.buyer.address}</dd></div>
          {o.note ? <div className="c-summary__row"><dt>ملاحظتك</dt><dd>{o.note}</dd></div> : null}
        </dl>
      </div>
      <div className="c-card stack">
        <h2 className="c-card__title">إعادة الطلب</h2>
        <p className="muted">يُجهّز سلة جديدة بالأسعار والتعبئة والحدود الحالية للمنتجات المتاحة الآن. لا يُرسل أي شيء تلقائيًا.</p>
        {reorder.status === 'done' ? (
          <Notice tone={reorder.omitted.length ? 'warning' : 'success'} title="تم تجهيز السلة">
            {reorder.omitted.length ? <p>لم تُضف لأنها غير متاحة الآن: {reorder.omitted.join('، ')}.</p> : null}
            {reorder.adjusted.length ? <p>رُفعت الكمية إلى الحد الأدنى الحالي: {reorder.adjusted.join('، ')}.</p> : null}
            <ButtonLink href={href('/cart')} variant="primary">مراجعة السلة</ButtonLink>
          </Notice>
        ) : (
          <Button variant="secondary" icon="refresh" busy={reorder.status === 'working'} busyLabel="جارٍ التحقق من المنتجات الحالية…" onClick={() => (cart.cart.lines.length ? setReorder({ status: 'confirm' }) : void runReorder())}>
            تجهيز سلة جديدة من هذا الطلب
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={reorder.status === 'confirm'}
        title="استبدال السلة الحالية؟"
        confirmLabel="استبدال السلة"
        onCancel={() => setReorder({ status: 'idle' })}
        onConfirm={() => void runReorder()}
      >
        <p>السلة تحتوي أصنافًا الآن. سيُستبدل محتواها بأصناف هذا الطلب بالأسعار الحالية.</p>
      </ConfirmDialog>
    </section>
  );
}
