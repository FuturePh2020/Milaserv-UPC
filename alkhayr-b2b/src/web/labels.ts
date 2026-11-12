import type { AllocationStatus, MerchantStatus, OrderState, StockStatus } from './api/contracts.ts';
import { STOCK_STATUS_LABEL_AR } from '../shared/stock-status.ts';

/** Arabic labels shared by badges, timelines and filters (single source). */
export const ORDER_STATE_LABEL: Record<OrderState, string> = {
  pending: 'قيد المراجعة',
  confirmed: 'مؤكد',
  preparing: 'قيد التجهيز',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};

/** Normal forward path of an order (cancelled is a terminal branch, not a step). */
export const ORDER_FLOW: readonly OrderState[] = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered'];

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = STOCK_STATUS_LABEL_AR;

export const MERCHANT_STATUS_LABEL: Record<MerchantStatus, string> = {
  pending: 'قيد المراجعة',
  approved: 'معتمد',
  suspended: 'موقوف',
};

export const ALLOCATION_STATUS_LABEL: Record<AllocationStatus, string> = {
  reserved: 'محجوز',
  released: 'أُلغي الحجز',
  consumed: 'خُصم بالشحن',
};
