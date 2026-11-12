import { useState, type ReactNode } from 'react';
import type { CatalogProduct } from '../api/contracts.ts';
import { formatCartons, formatMoney, formatPackSize, piecePriceCents } from '../format.ts';
import { AvailabilityBadge, CategoryBadge, DemoBadge } from './Badges.tsx';
import { Icon } from './Icon.tsx';
import { Ltr, Money } from './Text.tsx';

/**
 * Product image: the administrator-supplied https URL (never fetched by our server; loaded
 * without a referrer) or a truthful placeholder. No invented packaging imagery.
 */
export function ProductImage({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="c-image-placeholder">
        <Icon name="image" />
        <span>لا توجد صورة</span>
      </div>
    );
  }
  return <img src={url} alt={name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

/**
 * Trader product card. Shows the CARTON selling price (what orders are priced in) and, clearly
 * labelled as informational, the price per piece. Availability is a status only: the
 * CatalogProduct contract carries no stock counts and this component cannot display any.
 */
export function ProductCard({ product, action }: { product: CatalogProduct; action?: ReactNode }) {
  const unavailable = product.availability.status === 'out_of_stock';
  const titleId = `product-${product.id}`;
  return (
    <article className={`c-product c-product--cat-${product.category.id}${unavailable ? ' c-product--unavailable' : ''}`} aria-labelledby={titleId}>
      <div className="c-product__media">
        <ProductImage url={product.imageUrl} name={product.name} />
      </div>
      <div className="c-product__body">
        <div className="cluster">
          <CategoryBadge id={product.category.id} label={product.category.labelAr} />
          <AvailabilityBadge status={product.availability.status} />
          {product.isDemo ? <DemoBadge /> : null}
        </div>
        <h3 className="c-product__name" id={titleId} title={product.name}>
          {product.name}
        </h3>
        <dl className="c-product__meta">
          <div>
            <dt>الماركة:</dt>
            <dd>{product.brand}</dd>
          </div>
          <div>
            <dt>التعبئة:</dt>
            <dd>{formatPackSize(product.packSize)}</dd>
          </div>
          <div>
            <dt>أقل كمية:</dt>
            <dd>{formatCartons(product.minimumCartons)}</dd>
          </div>
          {product.barcode ? (
            <div>
              <dt>الباركود:</dt>
              <dd>
                <Ltr mono>{product.barcode}</Ltr>
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="c-product__footer">
          <div className="c-price">
            <span className="c-price__main">
              <Money cents={product.cartonPriceCents} />
            </span>
            <span className="c-price__unit">سعر الكرتونة</span>
            <span className="c-price__info">
              للعلم فقط: حوالي <bdi dir="ltr" className="ltr">{formatMoney(piecePriceCents(product.cartonPriceCents, product.packSize), { currency: false })}</bdi> ج.م للقطعة — البيع بالكرتونة فقط
            </span>
          </div>
          {action}
        </div>
      </div>
    </article>
  );
}
