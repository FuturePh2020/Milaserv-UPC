import { useEffect, useState } from 'react';
import type { CatalogProduct } from '../../api/contracts.ts';
import { catalogQueryString, getCatalogFilters, listProducts, type CatalogQuery } from '../../api/endpoints.ts';
import { useCart } from '../../cart/CartContext.tsx';
import { Button, ButtonLink } from '../../components/Button.tsx';
import { LoadMore } from '../../components/DataTable.tsx';
import { EmptyState, ErrorState, SkeletonLines } from '../../components/Feedback.tsx';
import { FilterBar, SearchInput } from '../../components/Filters.tsx';
import { Field, Select } from '../../components/Form.tsx';
import { ProductCard } from '../../components/Product.tsx';
import { useToast } from '../../components/Toast.tsx';
import { formatCartons } from '../../format.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { usePaged } from '../../hooks/usePaged.ts';
import { href, navigate } from '../../router.tsx';
import { cartErrorMessage } from './cartMessages.ts';

const SORTS: Array<[NonNullable<CatalogQuery['sort']>, string]> = [
  ['name', 'الاسم'],
  ['newest', 'الأحدث'],
  ['price_asc', 'السعر: من الأقل'],
  ['price_desc', 'السعر: من الأعلى'],
];

/** Reads the catalog query from the route, keeping only supported values. */
export function catalogQueryFrom(query: URLSearchParams): CatalogQuery {
  const sort = query.get('sort');
  const q = (query.get('q') ?? '').slice(0, 80);
  const category = query.get('category') ?? '';
  const brand = (query.get('brand') ?? '').slice(0, 80);
  return {
    ...(q.trim() ? { q } : {}),
    ...(/^[a-z][a-z0-9_]{1,39}$/.test(category) ? { category } : {}),
    ...(brand.trim() ? { brand } : {}),
    ...(SORTS.some(([s]) => s === sort) ? { sort: sort as NonNullable<CatalogQuery['sort']> } : {}),
  };
}

export function CatalogPage({ query }: { query: URLSearchParams }) {
  const cq = catalogQueryFrom(query);
  const key = catalogQueryString(cq);
  const filters = useLoad('filters', (signal) => getCatalogFilters(signal));
  const products = usePaged<CatalogProduct>(key, (cursor, signal) => listProducts({ ...cq, ...(cursor ? { cursor } : {}) }, signal));
  const [search, setSearch] = useState(cq.q ?? '');
  const [category, setCategory] = useState(cq.category ?? '');
  const [brand, setBrand] = useState(cq.brand ?? '');
  const [sort, setSort] = useState(cq.sort ?? 'name');
  // Keep the form in sync when the route changes (back/forward).
  useEffect(() => {
    setSearch(cq.q ?? '');
    setCategory(cq.category ?? '');
    setBrand(cq.brand ?? '');
    setSort(cq.sort ?? 'name');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const cart = useCart();
  const toast = useToast();

  const apply = () => navigate('/catalog', { q: search.trim() || undefined, category: category || undefined, brand: brand || undefined, sort: sort === 'name' ? undefined : sort });

  const quickAdd = (p: CatalogProduct) => {
    const error = cart.add(p, p.minimumCartons);
    toast(error ? cartErrorMessage(error) : `أُضيف إلى السلة: ${formatCartons(p.minimumCartons)} — ${p.name}`, error ? 'danger' : 'success');
  };

  return (
    <section aria-labelledby="catalog-title">
      <div className="c-page-header">
        <div>
          <h1 id="catalog-title">الكتالوج</h1>
          <p className="c-page-header__desc">الأسعار بالكرتونة. الطلب بالكرتونة الكاملة فقط.</p>
        </div>
        <ButtonLink href={href('/cart')} icon="cart">
          السلة ({cart.cart.lines.length})
        </ButtonLink>
      </div>
      <FilterBar label="بحث وتصفية المنتجات" onSubmit={apply} actions={<Button type="submit" variant="secondary" icon="search">تطبيق</Button>}>
        <div className="c-filter-bar__search">
          <SearchInput label="بحث بالاسم أو الماركة أو الباركود" value={search} onChange={setSearch} />
        </div>
        <details className="c-filter-more" open={Boolean(cq.category || cq.brand || cq.sort)}>
          <summary>تصفية وترتيب</summary>
          <div className="c-filter-more__body">
        <div className="c-filter-bar__filter">
          <Field label="القسم">
            {(p) => (
              <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)} disabled={filters.status !== 'ok'}>
                <option value="">كل الأقسام</option>
                {filters.status === 'ok' ? filters.data.categories.map((c) => <option key={c.id} value={c.id}>{c.labelAr}</option>) : null}
              </Select>
            )}
          </Field>
        </div>
        <div className="c-filter-bar__filter">
          <Field label="الماركة">
            {(p) => (
              <Select {...p} value={brand} onChange={(e) => setBrand(e.target.value)} disabled={filters.status !== 'ok'}>
                <option value="">كل الماركات</option>
                {filters.status === 'ok' ? filters.data.brands.map((b) => <option key={b.name} value={b.name}>{b.name}</option>) : null}
              </Select>
            )}
          </Field>
        </div>
        <div className="c-filter-bar__filter">
          <Field label="الترتيب">
            {(p) => (
              <Select {...p} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            )}
          </Field>
        </div>
          </div>
        </details>
      </FilterBar>
      {filters.status === 'error' ? <p className="muted" role="status">تعذّر تحميل قوائم الأقسام والماركات؛ ما زال البحث متاحًا.</p> : null}

      {products.status === 'loading' ? <SkeletonLines lines={6} label="جارٍ تحميل المنتجات…" /> : null}
      {products.status === 'error' && products.failure ? <ErrorState failure={products.failure} onRetry={products.reload} /> : null}
      {products.status === 'ok' && products.items.length === 0 ? (
        <EmptyState title="لا توجد منتجات مطابقة" message={key ? 'جرّب تغيير البحث أو التصفية.' : 'لا توجد منتجات متاحة حاليًا.'} actions={key ? <ButtonLink href={href('/catalog')}>مسح التصفية</ButtonLink> : undefined} />
      ) : null}
      {products.status === 'ok' && products.items.length > 0 ? (
        <>
          <p className="visually-hidden" role="status">
            {`معروض ${products.items.length} منتج`}
          </p>
          <div className="c-product-grid">
            {products.items.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                action={
                  <div className="cluster">
                    <ButtonLink href={href(`/catalog/${p.id}`, Object.fromEntries(query))}>التفاصيل</ButtonLink>
                    <Button size="small" icon="cart" disabled={p.availability.status === 'out_of_stock'} onClick={() => quickAdd(p)}>
                      {p.availability.status === 'out_of_stock' ? 'غير متوفر' : 'أضف أقل كمية'}
                    </Button>
                  </div>
                }
              />
            ))}
          </div>
          <LoadMore shown={products.items.length} hasMore={products.nextCursor !== null} busy={products.loadingMore} onLoadMore={products.loadMore} />
          {products.moreFailure ? <ErrorState failure={products.moreFailure} onRetry={products.loadMore} /> : null}
        </>
      ) : null}
    </section>
  );
}
