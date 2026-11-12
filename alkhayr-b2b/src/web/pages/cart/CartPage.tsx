import { useState } from 'react';
import { useCart } from '../../cart/CartContext.tsx';
import { cartIsValid, lineError, lineTotalCents, MAX_CARTONS, MAX_LINES, subtotalCents, type CartLine } from '../../cart/model.ts';
import { Button, ButtonLink, IconButton } from '../../components/Button.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { EmptyState, Notice } from '../../components/Feedback.tsx';
import { QuantityStepper } from '../../components/QuantityStepper.tsx';
import { Money } from '../../components/Text.tsx';
import { formatCartons, formatLines, formatPackSize } from '../../format.ts';
import { href } from '../../router.tsx';

function CartLineRow({ line }: { line: CartLine }) {
  const cart = useCart();
  const [text, setText] = useState(String(line.cartons));
  const error = lineError(line);
  return (
    <li className="c-cart-line">
      <div className="c-cart-line__info">
        <a className="c-cart-line__name" href={href(`/catalog/${line.productId}`)}>
          {line.name}
        </a>
        <span className="muted">
          {line.brand} · {formatPackSize(line.packSize)}
        </span>
        <span>
          <Money cents={line.cartonPriceCents} /> للكرتونة <span className="muted">(عند الإضافة)</span>
        </span>
      </div>
      <div className="c-cart-line__controls">
        <QuantityStepper
          labelSuffix={line.name}
          value={error === null ? line.cartons : null}
          text={text}
          min={line.minimumCartons}
          max={MAX_CARTONS}
          onChange={(next) => {
            setText(next.text);
            if (next.value !== null) cart.setQuantity(line.productId, next.value);
          }}
        />
        <div className="c-cart-line__total">
          <span className="muted">الإجمالي</span>
          <Money cents={lineTotalCents(line)} />
        </div>
        <IconButton icon="close" label={`إزالة ${line.name} من السلة`} onClick={() => cart.remove(line.productId)} />
      </div>
    </li>
  );
}

export function CartPage() {
  const cart = useCart();
  const [confirmClear, setConfirmClear] = useState(false);
  const lines = cart.cart.lines;
  if (lines.length === 0 && !cart.pending) {
    return (
      <section aria-labelledby="cart-title">
        <h1 id="cart-title">السلة</h1>
        <EmptyState title="السلة فارغة" message="أضف منتجات من الكتالوج بالكرتونة." actions={<ButtonLink href={href('/catalog')} variant="primary">تصفح الكتالوج</ButtonLink>} />
      </section>
    );
  }
  const valid = cartIsValid(cart.cart);
  return (
    <section className="stack" aria-labelledby="cart-title">
      <div className="c-page-header">
        <div>
          <h1 id="cart-title">السلة</h1>
          <p className="c-page-header__desc">
            {formatLines(lines.length)} — الحد الأقصى {MAX_LINES} صنفًا في الطلب الواحد.
          </p>
        </div>
        {lines.length > 0 ? (
          <Button variant="ghost" icon="close" onClick={() => setConfirmClear(true)}>
            إفراغ السلة
          </Button>
        ) : null}
      </div>
      {cart.pending ? (
        <Notice tone="warning" title="يوجد طلب سابق لم يتأكد إرساله">
          <p>
            قبل إرسال طلب جديد، تحقّق من نتيجة الطلب السابق من <a href={href('/checkout')}>صفحة المراجعة</a>.
          </p>
        </Notice>
      ) : null}
      {lines.length > 0 ? (
        <>
          <ul className="c-cart">
            {lines.map((l) => (
              <CartLineRow key={l.productId} line={l} />
            ))}
          </ul>
          <div className="c-card c-cart-summary">
            <dl className="c-summary">
              <div className="c-summary__row c-summary__row--total">
                <dt>إجمالي البضاعة (تقديري)</dt>
                <dd>
                  <Money cents={subtotalCents(cart.cart)} />
                </dd>
              </div>
            </dl>
            <p className="muted">الشحن والضريبة والإجمالي النهائي تُحسب على الخادم في خطوة المراجعة قبل الإرسال.</p>
            {!valid ? (
              <p className="c-field__error" role="status">
                صحّح الكميات المظللة قبل المتابعة (أقل كمية لكل منتج، وحتى {formatCartons(MAX_CARTONS)}).
              </p>
            ) : null}
            <ButtonLink href={href('/checkout')} variant="primary" icon="check">
              مراجعة الطلب
            </ButtonLink>
          </div>
        </>
      ) : null}
      <ConfirmDialog
        open={confirmClear}
        title="إفراغ السلة؟"
        confirmLabel="إفراغ السلة"
        tone="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          cart.clear();
          setConfirmClear(false);
        }}
      >
        <p>ستُحذف كل الأصناف من السلة على هذا المتصفح. لا يؤثر ذلك على أي طلب أُرسل بالفعل.</p>
      </ConfirmDialog>
    </section>
  );
}
