import type { ReactNode } from 'react';
import type { AllocationStatus, MerchantStatus, OrderState, StockStatus } from '../api/contracts.ts';
import { ALLOCATION_STATUS_LABEL, MERCHANT_STATUS_LABEL, ORDER_STATE_LABEL, STOCK_STATUS_LABEL } from '../labels.ts';
import { Icon, type IconName } from './Icon.tsx';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

/** Status is always text + icon; colour is never the only signal. */
export function Badge({ tone, icon, children, className }: { tone: Tone; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={['c-badge', `c-badge--${tone}`, className ?? ''].filter(Boolean).join(' ')}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}

const ORDER_TONE: Record<OrderState, [Tone, IconName]> = {
  pending: ['warning', 'clock'],
  confirmed: ['info', 'check'],
  preparing: ['info', 'box'],
  shipped: ['brand', 'truck'],
  delivered: ['success', 'check'],
  cancelled: ['neutral', 'x'],
};

export function OrderStatusBadge({ state }: { state: OrderState }) {
  const [tone, icon] = ORDER_TONE[state];
  return (
    <Badge tone={tone} icon={icon}>
      {ORDER_STATE_LABEL[state]}
    </Badge>
  );
}

const STOCK_TONE: Record<StockStatus, [Tone, IconName]> = {
  normal: ['success', 'check'],
  low_stock: ['warning', 'alert'],
  out_of_stock: ['danger', 'x'],
};

/** Trader availability: status only. This component has no way to show stock counts. */
export function AvailabilityBadge({ status }: { status: StockStatus }) {
  const [tone, icon] = STOCK_TONE[status];
  return (
    <Badge tone={tone} icon={icon}>
      {STOCK_STATUS_LABEL[status]}
    </Badge>
  );
}

export function MerchantStatusBadge({ status }: { status: MerchantStatus }) {
  const map: Record<MerchantStatus, [Tone, IconName]> = { pending: ['warning', 'clock'], approved: ['success', 'check'], suspended: ['danger', 'lock'] };
  const [tone, icon] = map[status];
  return (
    <Badge tone={tone} icon={icon}>
      {MERCHANT_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Administrator-only reservation status of one order line. */
export function AllocationBadge({ status }: { status: AllocationStatus | null }) {
  if (status === null) return <Badge tone="neutral">غير محجوز</Badge>;
  const map: Record<AllocationStatus, [Tone, IconName]> = { reserved: ['info', 'lock'], released: ['neutral', 'refresh'], consumed: ['success', 'truck'] };
  const [tone, icon] = map[status];
  return (
    <Badge tone={tone} icon={icon}>
      {ALLOCATION_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Category label with its restrained packaging accent (text stays readable, >= 5.7:1). */
export function CategoryBadge({ id, label }: { id: string; label: string }) {
  return <span className={`c-badge c-badge--cat-${id}`}>{label}</span>;
}

export function DemoBadge() {
  return (
    <Badge tone="neutral" icon="info">
      عرض تجريبي
    </Badge>
  );
}
