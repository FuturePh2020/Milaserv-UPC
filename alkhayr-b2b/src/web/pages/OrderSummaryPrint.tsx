import { getOrderSummary } from '../api/endpoints.ts';
import { Button, ButtonLink } from '../components/Button.tsx';
import { ErrorState, SkeletonLines, StateView } from '../components/Feedback.tsx';
import { Ltr, Money } from '../components/Text.tsx';
import { formatBasisPoints, formatDateTime, formatInteger, formatPackSize } from '../format.ts';
import { useLoad } from '../hooks/useLoad.ts';
import { ORDER_STATE_LABEL } from '../labels.ts';
import { href } from '../router.tsx';

/**
 * Printable order summary ("ملخص طلب", stage 14). Rendered without the application shell. All
 * values are React text (no HTML interpolation). Printing uses the browser's print dialog only
 * after the authorized summary has loaded. Not a tax invoice, receipt or proof of payment.
 */
export function OrderSummaryPrintPage({ id, admin }: { id: string; admin: boolean }) {
  const data = useLoad(`summary:${admin ? 'a' : 'm'}:${id}`, (signal) => getOrderSummary(id, admin, signal));
  const back = admin ? href(`/admin/orders/${id}`) : href(`/orders/${id}`);
  if (data.status === 'loading') return <div className="p-print"><SkeletonLines lines={8} label="جارٍ تحميل ملخص الطلب…" /></div>;
  if (data.status === 'error') {
    return (
      <div className="p-print">
        {data.failure.kind === 'not_found' ? <StateView icon="orders" title="الطلب غير موجود" actions={<ButtonLink href={back}>رجوع</ButtonLink>} /> : <ErrorState failure={data.failure} onRetry={data.reload} />}
      </div>
    );
  }
  const { order: o, company, generatedAt } = data.data;
  const companyLines = [company.name, company.address, company.phone, company.email].filter((x): x is string => typeof x === 'string' && x.length > 0);
  return (
    <div className="p-print">
      <div className="p-print__toolbar no-print">
        <ButtonLink href={back} icon="chevron">رجوع إلى الطلب</ButtonLink>
        <Button icon="orders" onClick={() => window.print()}>
          طباعة
        </Button>
      </div>
      <article className="p-doc" aria-labelledby="doc-title">
        <header className="p-doc__header">
          <div>
            <h1 id="doc-title">ملخص طلب</h1>
            <p className="p-doc__disclaimer">ملخص لبيانات الطلب كما سُجلت وقت إنشائه. ليس فاتورة ضريبية ولا إيصال دفع ولا إثباتًا للسداد.</p>
          </div>
          <div className="p-doc__company">
            <h2>بيانات الشركة</h2>
            {companyLines.length ? companyLines.map((l, i) => <p key={i}>{l}</p>) : <p className="muted">لم تُسجل بيانات الشركة.</p>}
            <p className="p-doc__small">بيانات الشركة الحالية وقت الطباعة، وليست جزءًا محفوظًا من الطلب.</p>
          </div>
        </header>
        <dl className="p-doc__meta">
          <div><dt>رقم الطلب</dt><dd><Ltr mono>{o.displayNumber}</Ltr></dd></div>
          <div><dt>تاريخ الإنشاء</dt><dd>{formatDateTime(o.createdAt)}</dd></div>
          <div><dt>الحالة الحالية</dt><dd>{ORDER_STATE_LABEL[o.state]}</dd></div>
          <div><dt>تاريخ الطباعة</dt><dd>{formatDateTime(generatedAt)}</dd></div>
        </dl>
        {o.isDemo ? <p className="p-doc__demo">طلب عرض تجريبي — ليس طلبًا تجاريًا.</p> : null}
        <section className="p-doc__buyer" aria-label="بيانات المشتري">
          <h2>المشتري (وقت الطلب)</h2>
          <p>
            {o.buyer.businessName} — {o.buyer.contactName}
          </p>
          <p>
            <Ltr>{o.buyer.phone}</Ltr> · {o.buyer.governorate}، {o.buyer.address}
          </p>
        </section>
        <table className="p-doc__table">
          <caption className="visually-hidden">أصناف الطلب</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">الصنف</th>
              <th scope="col">التعبئة</th>
              <th scope="col">الكراتين</th>
              <th scope="col">سعر الكرتونة</th>
              <th scope="col">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {o.items.map((i) => (
              <tr key={i.lineNo}>
                <td className="num">{i.lineNo}</td>
                <td>
                  <div className="p-doc__name">{i.name}</div>
                  <div className="p-doc__small">
                    {i.brand}
                    {i.barcode ? <> · <Ltr mono>{i.barcode}</Ltr></> : null}
                  </div>
                </td>
                <td>{formatPackSize(i.packSize)}</td>
                <td className="num">{formatInteger(i.cartons)}</td>
                <td className="num"><Money cents={i.cartonPriceCents} /></td>
                <td className="num"><Money cents={i.lineTotalCents} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="p-doc__totals">
          <div><dt>إجمالي البضاعة</dt><dd><Money cents={o.amounts.subtotalCents} /></dd></div>
          <div><dt>الشحن{o.amounts.shippingTaxable ? ' (خاضع للضريبة)' : ''}</dt><dd><Money cents={o.amounts.shippingCents} /></dd></div>
          <div><dt>الضريبة (<Ltr>{formatBasisPoints(o.amounts.taxBps)}</Ltr>)</dt><dd><Money cents={o.amounts.taxCents} /></dd></div>
          <div className="p-doc__grand"><dt>الإجمالي</dt><dd><Money cents={o.amounts.totalCents} /></dd></div>
        </dl>
        {o.note ? (
          <section className="p-doc__note">
            <h2>ملاحظة التاجر</h2>
            <p>{o.note}</p>
          </section>
        ) : null}
        <footer className="p-doc__footer">القيم من لقطة الطلب وقت إنشائه بالجنيه المصري. لا تعكس الدفع أو التحصيل.</footer>
      </article>
    </div>
  );
}
