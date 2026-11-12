import { href } from '../../router.tsx';

/**
 * Administration landing page: where to go, nothing more. It deliberately shows NO counts or
 * statistics (none are fetched; reports are a later stage).
 */
const SECTIONS = [
  { title: 'الطلبات', to: '/admin/orders', desc: 'مراجعة الطلبات وتأكيدها بحجز المخزون، ثم التجهيز والشحن والتسليم، أو الإلغاء بسبب.', quick: { label: 'طلبات قيد المراجعة', q: { state: 'pending' } } },
  { title: 'التجار', to: '/admin/merchants', desc: 'مراجعة طلبات التسجيل واعتماد الحسابات أو إيقافها مع ذكر السبب.', quick: { label: 'حسابات قيد المراجعة', q: { status: 'pending' } } },
  { title: 'المنتجات', to: '/admin/products', desc: 'إضافة المنتجات وتعديل بياناتها وأسعارها وتفعيلها.', quick: null },
  { title: 'المخزون', to: '/admin/inventory', desc: 'الأرصدة وسجل الحركات، وتسجيل الاستلام والتسويات والجرد.', quick: { label: 'منتجات نفد رصيدها', q: { status: 'out_of_stock' } } },
] as const;

export function AdminHomePage() {
  return (
    <section className="stack" aria-labelledby="ah-title">
      <div className="c-page-header">
        <div>
          <h1 id="ah-title">الإدارة</h1>
          <p className="c-page-header__desc">كل إجراء إداري يتطلب تسجيل دخول خلال آخر 15 دقيقة، ويُسجل في السجل.</p>
        </div>
      </div>
      <ul className="c-grid-2 c-link-cards">
        {SECTIONS.map((s) => (
          <li key={s.to} className="c-card stack">
            <h2 className="c-card__title">
              <a href={href(s.to)}>{s.title}</a>
            </h2>
            <p className="muted">{s.desc}</p>
            {s.quick ? (
              <p>
                <a href={href(s.to, s.quick.q)}>{s.quick.label}</a>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
