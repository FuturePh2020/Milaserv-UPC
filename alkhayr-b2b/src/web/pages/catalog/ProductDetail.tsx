import { useState } from 'react';
import { getProduct } from '../../api/endpoints.ts';
import { useCart } from '../../cart/CartContext.tsx';
import { Button, ButtonLink } from '../../components/Button.tsx';
import { ErrorState, SkeletonLines, StateView } from '../../components/Feedback.tsx';
import { ProductCard } from '../../components/Product.tsx';
import { QuantityStepper } from '../../components/QuantityStepper.tsx';
import { useToast } from '../../components/Toast.tsx';
import { formatCartons } from '../../format.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { href } from '../../router.tsx';
import { cartErrorMessage } from './cartMessages.ts';

/** Product detail (GET /products/:id). Unknown, hidden and inactive products are one "unavailable" state. */
export function ProductDetailPage({ id, backQuery }: { id: string; backQuery: URLSearchParams }) {
  const product = useLoad(`product:${id}`, (signal) => getProduct(id, signal));
  const cart = useCart();
  const toast = useToast();
  const [qty, setQty] = useState<{ value: number | null; text: string } | null>(null);
  const back = href('/catalog', Object.fromEntries(backQuery));

  if (product.status === 'loading') return <SkeletonLines lines={5} label="جارٍ تحميل المنتج…" />;
  if (product.status === 'error') {
    if (product.failure.kind === 'not_found') {
      return <StateView icon="box" title="المنتج غير متاح" message="قد يكون المنتج أُوقف أو لم يعد معروضًا." actions={<ButtonLink href={back}>العودة إلى الكتالوج</ButtonLink>} />;
    }
    return <ErrorState failure={product.failure} onRetry={product.reload} />;
  }
  const p = product.data;
  const q = qty ?? { value: p.minimumCartons, text: String(p.minimumCartons) };
  const inCart = cart.cart.lines.find((l) => l.productId === p.id);
  const unavailable = p.availability.status === 'out_of_stock';
  const add = () => {
    if (q.value === null) return;
    const error = cart.add(p, q.value);
    toast(error ? cartErrorMessage(error) : `أُضيف إلى السلة: ${formatCartons(q.value)}`, error ? 'danger' : 'success');
  };
  return (
    <section className="stack" aria-label="تفاصيل المنتج">
      <p>
        <a href={back}>العودة إلى الكتالوج</a>
      </p>
      <div className="c-product-detail">
        <ProductCard
          product={p}
          action={
            <div className="stack">
              <QuantityStepper value={q.value} text={q.text} onChange={setQty} min={p.minimumCartons} disabled={unavailable} />
              <Button icon="cart" onClick={add} disabled={unavailable || q.value === null}>
                {unavailable ? 'غير متوفر حاليًا' : 'أضف إلى السلة'}
              </Button>
              {inCart ? (
                <p className="muted" role="status">
                  في السلة الآن: {formatCartons(inCart.cartons)}. <a href={href('/cart')}>عرض السلة</a>
                </p>
              ) : null}
            </div>
          }
        />
      </div>
    </section>
  );
}
