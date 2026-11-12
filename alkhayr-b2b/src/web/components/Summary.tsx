import type { ReactNode } from 'react';
import type { OrderAmounts } from '../api/contracts.ts';
import { formatBasisPoints } from '../format.ts';
import { Money } from './Text.tsx';

export function SummaryRow({ label, value, total = false }: { label: ReactNode; value: ReactNode; total?: boolean }) {
  return (
    <div className={`c-summary__row${total ? ' c-summary__row--total' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * Order totals exactly as stored in the order snapshot (computed by the server at creation).
 * The UI never recalculates them from current prices or settings.
 */
export function OrderTotals({ amounts }: { amounts: OrderAmounts }) {
  return (
    <dl className="c-summary">
      <SummaryRow label="إجمالي البضاعة" value={<Money cents={amounts.subtotalCents} />} />
      <SummaryRow label={amounts.shippingTaxable ? 'الشحن (خاضع للضريبة)' : 'الشحن'} value={amounts.shippingCents === 0 ? 'بدون رسوم' : <Money cents={amounts.shippingCents} />} />
      <SummaryRow label={<>الضريبة (<bdi dir="ltr">{formatBasisPoints(amounts.taxBps)}</bdi>)</>} value={<Money cents={amounts.taxCents} />} />
      <SummaryRow label="الإجمالي" value={<Money cents={amounts.totalCents} />} total />
    </dl>
  );
}
