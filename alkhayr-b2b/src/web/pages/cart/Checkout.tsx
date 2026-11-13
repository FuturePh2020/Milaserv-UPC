import { useEffect, useState } from 'react';
import { SECURE_RANDOM_MESSAGE, SecureRandomUnavailableError, type ApiFailure, type SessionCsrfToken } from '../../api/client.ts';
import type { OrderQuote } from '../../api/contracts.ts';
import { createOrder, quoteOrder } from '../../api/endpoints.ts';
import { useCart } from '../../cart/CartContext.tsx';
import { acceptCurrentTerms, cartIsValid, cartMatchesPayload, payloadLines, removeLines, type Cart } from '../../cart/model.ts';
import type { PendingSubmission } from '../../cart/storage.ts';
import { classifyFailure, conflictProductIds, conflictTerms, newSubmission } from '../../checkout/submission.ts';
import { Button, ButtonLink } from '../../components/Button.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { EmptyState, ErrorState, Notice, Spinner } from '../../components/Feedback.tsx';
import { Field, TextArea } from '../../components/Form.tsx';
import { OrderTotals } from '../../components/Summary.tsx';
import { Ltr, Money, RequestRef } from '../../components/Text.tsx';
import { formatCartons, formatDateTime, formatPackSize } from '../../format.ts';
import { href, navigate } from '../../router.tsx';
import { useIdentity } from '../../session/identity.tsx';

type QuoteState = { status: 'idle' | 'loading' } | { status: 'ok'; quote: OrderQuote } | { status: 'error'; failure: ApiFailure };
type SendState = { status: 'idle' } | { status: 'sending' } | { status: 'unknown'; failure: ApiFailure } | { status: 'not_processed'; failure: ApiFailure } | { status: 'rejected'; failure: ApiFailure };

/** Explains a refused quote/order and offers the corresponding cart change (never automatic). */
function ConflictPanel({ failure, cart, onApply }: { failure: ApiFailure; cart: Cart; onApply: (next: Cart, message: string) => void }) {
  const names = new Map(cart.lines.map((l) => [l.productId, l]));
  if (failure.code === 'TERMS_CHANGED') {
    return (
      <Notice tone="warning" title="تغيّرت رسوم الشحن أو نسبة الضريبة">
        <p>لم يُرسل الطلب. أُعيد حساب الإجمالي بالشروط الحالية أدناه؛ راجعه ثم اضغط «تأكيد وإرسال الطلب» من جديد إن كان مناسبًا.</p>
      </Notice>
    );
  }
  if (failure.code === 'PRICE_CHANGED' || failure.code === 'PACKAGING_CHANGED') {
    const terms = conflictTerms(failure);
    return (
      <Notice tone="warning" title={failure.message}>
        <ul>
          {terms.map((t) => {
            const l = names.get(t.productId);
            return (
              <li key={t.productId}>
                {l?.name ?? 'منتج'}: السعر الذي راجعته <Money cents={l?.cartonPriceCents ?? 0} /> ← الحالي <Money cents={t.cartonPriceCents} />
                {l && l.packSize !== t.packSize ? ` · التعبئة ${formatPackSize(l.packSize)} ← ${formatPackSize(t.packSize)}` : ''}
              </li>
            );
          })}
        </ul>
        <p>لن يُرسل أي طلب بالأسعار الجديدة إلا بعد موافقتك ومراجعتها مرة أخرى.</p>
        <Button variant="secondary" onClick={() => onApply(acceptCurrentTerms(cart, terms), 'تم تحديث السلة بالأسعار والتعبئة الحالية. راجع الطلب من جديد.')}>
          قبول القيم الحالية ومراجعة الطلب من جديد
        </Button>
        <RequestRef requestId={failure.requestId} />
      </Notice>
    );
  }
  if (failure.code === 'PRODUCT_UNAVAILABLE') {
    const ids = conflictProductIds(failure);
    return (
      <Notice tone="warning" title={failure.message}>
        <ul>{ids.map((id) => <li key={id}>{names.get(id)?.name ?? 'منتج لم يعد متاحًا'}</li>)}</ul>
        <Button variant="secondary" onClick={() => onApply(removeLines(cart, ids), 'أُزيلت المنتجات غير المتاحة من السلة.')}>
          إزالة المنتجات غير المتاحة
        </Button>
        <RequestRef requestId={failure.requestId} />
      </Notice>
    );
  }
  if (failure.code === 'INSUFFICIENT_STOCK' || failure.code === 'MINIMUM_QUANTITY_NOT_MET') {
    const ids = conflictProductIds(failure);
    return (
      <Notice tone="warning" title={failure.message}>
        {/* Only the server's status/message: exact stock is never known or shown here. */}
        <ul>{ids.map((id) => <li key={id}>{names.get(id)?.name ?? 'منتج'}</li>)}</ul>
        <ButtonLink href={href('/cart')}>تعديل الكميات في السلة</ButtonLink>
        <RequestRef requestId={failure.requestId} />
      </Notice>
    );
  }
  return <ErrorState failure={failure} />;
}

function PendingPanel({ pending, cartChanged, sending, onRetry, onDiscard }: { pending: PendingSubmission; cartChanged: boolean; sending: boolean; onRetry: () => void; onDiscard: () => void }) {
  return (
    <Notice tone="warning" title="لم يتأكد إرسال الطلب">
      <p>
        بدأ إرسال طلب في <bdi dir="ltr">{formatDateTime(pending.createdAt)}</bdi> ولم يصل رد مؤكد. قد يكون الطلب استُلم أو لم يُستلم.
      </p>
      <p>
        «إعادة الإرسال» تُرسل <strong>نفس الطلب بنفس المفتاح</strong>: إذا كان قد استُلم فسيعرض الخادم الطلب نفسه ولن يُنشأ طلب ثانٍ. يمكنك أيضًا مراجعة{' '}
        <a href={href('/orders')}>طلباتي</a>.
      </p>
      {cartChanged ? <p>تغيّرت السلة بعد هذه المحاولة؛ ستُرسل إعادة الإرسال الطلب الأصلي كما كان، لا السلة الحالية.</p> : null}
      <p className="c-request-ref">
        مفتاح الطلب: <Ltr mono>{pending.requestKey}</Ltr>
      </p>
      <div className="cluster">
        <Button onClick={onRetry} busy={sending} busyLabel="جارٍ إعادة الإرسال…" icon="refresh">
          إعادة إرسال نفس الطلب
        </Button>
        <Button variant="ghost" onClick={onDiscard} disabled={sending}>
          تجاهل هذه المحاولة
        </Button>
      </div>
    </Notice>
  );
}

/**
 * Review and submission. Steps: server quote of the current cart (read-only preview, not a price
 * lock) -> deliberate "confirm and send" -> POST /orders with a fresh request key whose exact
 * payload is stored first. Unclear outcomes keep the key+payload for an explicit same-request retry.
 */
export function CheckoutPage({ csrf }: { csrf: SessionCsrfToken }) {
  const cart = useCart();
  const { handleAuthFailure } = useIdentity();
  const [quote, setQuote] = useState<QuoteState>({ status: 'idle' });
  const [quoteGen, setQuoteGen] = useState(0);
  const [send, setSend] = useState<SendState>({ status: 'idle' });
  const [note, setNote] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const linesKey = JSON.stringify(payloadLines(cart.cart));
  const valid = cartIsValid(cart.cart);

  // Quote the current cart (on entry, after cart changes, or when asked). Stale answers are ignored.
  useEffect(() => {
    if (!valid || cart.pending) return;
    const controller = new AbortController();
    setQuote({ status: 'loading' });
    quoteOrder(csrf, JSON.parse(linesKey), controller.signal).then(
      (r) => {
        if (controller.signal.aborted) return;
        if (r.ok) setQuote({ status: 'ok', quote: r.data });
        else {
          handleAuthFailure(r);
          setQuote({ status: 'error', failure: r });
        }
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [csrf, linesKey, valid, quoteGen, cart.pending, handleAuthFailure]);

  const transmit = async (pending: PendingSubmission) => {
    setSend({ status: 'sending' });
    setInfo(null);
    const r = await createOrder(csrf, pending.payload, pending.epoch);
    if (r.ok) {
      cart.complete(cartMatchesPayload(cart.cart, pending.payload));
      navigate(`/orders/${r.data.order.id}`, { received: r.data.replayed ? 'replayed' : 'new' });
      return;
    }
    const outcome = classifyFailure(r);
    if (outcome === 'unknown') setSend({ status: 'unknown', failure: r });
    else if (outcome === 'not_processed') setSend({ status: 'not_processed', failure: r });
    else if (outcome === 'session') {
      setSend({ status: 'idle' });
      handleAuthFailure(r); // pending stays stored for this account; retry after signing in again
    } else {
      cart.setPending(null); // a definite refusal: nothing was created, the key is released
      setSend({ status: 'rejected', failure: r });
      handleAuthFailure(r);
      // Shipping/tax changed after the review: recompute the read-only quote; a NEW explicit submission is required.
      if (r.code === 'TERMS_CHANGED') setQuoteGen((g) => g + 1);
    }
  };

  const submit = () => {
    if (cart.pending || send.status === 'sending' || quote.status !== 'ok') return;
    let pending: PendingSubmission;
    try {
      pending = newSubmission(cart.cart, note, quote.quote.amounts);
    } catch (err) {
      if (err instanceof SecureRandomUnavailableError) {
        setInfo(SECURE_RANDOM_MESSAGE); // nothing is sent without a secure key
        return;
      }
      throw err;
    }
    cart.setPending(pending); // stored before the request leaves
    void transmit(pending);
  };

  const applyCart = (next: Cart, message: string) => {
    cart.replace(next);
    setSend({ status: 'idle' });
    setInfo(message);
    setQuoteGen((g) => g + 1);
  };

  if (cart.cart.lines.length === 0 && !cart.pending) {
    // Stage 16 (F-12): a refusal that discarded the pending submission must stay visible even when the
    // cart is empty, otherwise the trader would not learn that NO order was created.
    return (
      <section className="stack" aria-labelledby="checkout-empty">
        {send.status === 'rejected' ? (
          <div aria-live="polite">
            <Notice tone="warning" title="لم يُنشأ الطلب">
              <p>{send.failure.message}</p>
            </Notice>
          </div>
        ) : null}
        <EmptyState title="لا يوجد ما يُراجع" message="السلة فارغة." actions={<ButtonLink href={href('/catalog')} variant="primary">تصفح الكتالوج</ButtonLink>} />
        <span id="checkout-empty" hidden>
          لا يوجد ما يُراجع
        </span>
      </section>
    );
  }

  return (
    <section className="stack" aria-labelledby="checkout-title">
      <div className="c-page-header">
        <div>
          <h1 id="checkout-title">مراجعة الطلب وإرساله</h1>
          <p className="c-page-header__desc">راجع الأصناف والإجمالي ثم أكّد الإرسال. الطلب بعد الإرسال يكون «قيد المراجعة» ولا يُحجز له مخزون حتى تؤكده الإدارة.</p>
        </div>
        <ButtonLink href={href('/cart')}>تعديل السلة</ButtonLink>
      </div>
      <div aria-live="polite">{info ? <Notice tone="info"><p>{info}</p></Notice> : null}</div>

      {cart.pending && send.status === 'sending' ? <Spinner label="جارٍ إرسال الطلب… لا تغلق الصفحة." /> : null}
      {cart.pending && send.status !== 'sending' ? (
        <>
          <PendingPanel pending={cart.pending} cartChanged={!cartMatchesPayload(cart.cart, cart.pending.payload)} sending={false} onRetry={() => void transmit(cart.pending!)} onDiscard={() => setConfirmDiscard(true)} />
          {send.status === 'unknown' ? <ErrorState failure={send.failure} /> : null}
          {send.status === 'not_processed' ? (
            <Notice tone="warning" title="لم يُعالج الطلب بعد">
              <p>
                {send.failure.message}
                {send.failure.retryAfterSeconds ? ` يمكنك إعادة الإرسال بعد حوالي ${Math.ceil(send.failure.retryAfterSeconds / 60)} دقيقة.` : ''}
              </p>
            </Notice>
          ) : null}
        </>
      ) : null}

      {send.status === 'rejected' ? <ConflictPanel failure={send.failure} cart={cart.cart} onApply={applyCart} /> : null}

      {!cart.pending && !valid ? <Notice tone="warning"><p>بعض الكميات في السلة غير صالحة. <a href={href('/cart')}>صحّحها في السلة</a>.</p></Notice> : null}

      {!cart.pending && valid ? (
        <>
          {quote.status === 'loading' || quote.status === 'idle' ? <Spinner label="جارٍ حساب الإجمالي على الخادم…" /> : null}
          {quote.status === 'error' ? (
            ['PRICE_CHANGED', 'PACKAGING_CHANGED', 'PRODUCT_UNAVAILABLE', 'INSUFFICIENT_STOCK', 'MINIMUM_QUANTITY_NOT_MET'].includes(quote.failure.code ?? '') ? (
              <ConflictPanel failure={quote.failure} cart={cart.cart} onApply={applyCart} />
            ) : (
              <ErrorState failure={quote.failure} onRetry={() => setQuoteGen((g) => g + 1)} />
            )
          ) : null}
          {quote.status === 'ok' ? (
            <>
              <div className="c-card">
                <h2 className="c-card__title">الأصناف</h2>
                <ul className="c-cart">
                  {quote.quote.items.map((i) => (
                    <li key={i.productId} className="c-review-line">
                      <span>
                        {i.name} — {formatCartons(i.cartons)} × <Money cents={i.cartonPriceCents} />
                        <span className="muted"> ({formatPackSize(i.packSize)})</span>
                      </span>
                      <Money cents={i.lineTotalCents} />
                    </li>
                  ))}
                </ul>
              </div>
              <div className="c-card stack">
                <h2 className="c-card__title">الإجمالي التقديري</h2>
                <OrderTotals amounts={quote.quote.amounts} />
                <p className="muted">
                  محسوب على الخادم بالأسعار والإعدادات الحالية في <bdi dir="ltr">{formatDateTime(quote.quote.quotedAt)}</bdi>. هذا تقدير وليس تثبيتًا للسعر: يُعاد التحقق من كل شيء عند الإرسال.
                </p>
                {!quote.quote.minimumOrderMet ? (
                  <Notice tone="warning">
                    <p>
                      إجمالي البضاعة أقل من الحد الأدنى للطلب (<Money cents={quote.quote.amounts.minimumOrderCents} />). أضف أصنافًا للمتابعة.
                    </p>
                  </Notice>
                ) : null}
                <Field id="checkout-note" label="ملاحظة للإدارة (اختياري)" hint="حتى 500 حرف.">
                  {(p) => <TextArea {...p} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
                </Field>
                <Button onClick={submit} busy={send.status === 'sending'} busyLabel="جارٍ الإرسال…" disabled={!quote.quote.minimumOrderMet} icon="check">
                  تأكيد وإرسال الطلب
                </Button>
                <Button variant="ghost" icon="refresh" onClick={() => setQuoteGen((g) => g + 1)}>
                  إعادة حساب الإجمالي
                </Button>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={confirmDiscard}
        title="تجاهل المحاولة السابقة؟"
        confirmLabel="تجاهل المحاولة"
        tone="danger"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          cart.setPending(null);
          setSend({ status: 'idle' });
          setConfirmDiscard(false);
          setQuoteGen((g) => g + 1);
        }}
      >
        <p>تأكّد أولًا من <a href={href('/orders')}>طلباتي</a> أن الطلب لم يُستلم. بعد التجاهل سيُعامل أي إرسال جديد كطلب جديد بمفتاح جديد، وقد يُنشئ طلبًا ثانيًا إذا كان الأول قد استُلم.</p>
      </ConfirmDialog>
    </section>
  );
}
