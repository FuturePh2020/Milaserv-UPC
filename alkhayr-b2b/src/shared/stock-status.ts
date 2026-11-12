import { BUSINESS_SETTING_DEFAULTS } from './constants.ts';

/** available = on_hand - reserved (cartons). Never accepted from a client. */
export type StockStatus = 'out_of_stock' | 'low_stock' | 'normal';

/**
 * Owner decision (stage 01): status is based on AVAILABLE stock.
 *   available = 0              -> out_of_stock
 *   1 <= available <= threshold -> low_stock
 *   available > threshold      -> normal
 */
export function stockStatus(
  available: number,
  thresholdCartons: number = BUSINESS_SETTING_DEFAULTS.lowStockThresholdCartons,
): StockStatus {
  if (!Number.isSafeInteger(available) || available < 0) {
    throw new RangeError('available must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(thresholdCartons) || thresholdCartons < 0) {
    throw new RangeError('threshold must be a non-negative safe integer');
  }
  if (available === 0) return 'out_of_stock';
  if (available <= thresholdCartons) return 'low_stock';
  return 'normal';
}

export const STOCK_STATUS_LABEL_AR: Record<StockStatus, string> = {
  out_of_stock: 'غير متوفر',
  low_stock: 'كمية محدودة',
  normal: 'متوفر',
};
