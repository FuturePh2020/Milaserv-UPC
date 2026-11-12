import type { CartError } from '../../cart/model.ts';
import { MAX_CARTONS, MAX_LINES } from '../../cart/model.ts';

export function cartErrorMessage(error: CartError): string {
  switch (error) {
    case 'too_many_lines':
      return `لا يمكن أن يحتوي الطلب على أكثر من ${MAX_LINES} صنف مختلف.`;
    case 'below_minimum':
      return 'الكمية أقل من الحد الأدنى لهذا المنتج.';
    case 'above_maximum':
      return `الحد الأقصى ${MAX_CARTONS.toLocaleString('en-US')} كرتونة للصنف الواحد.`;
    case 'not_integer':
      return 'أدخل عددًا صحيحًا من الكراتين.';
    case 'unavailable':
      return 'المنتج غير متوفر حاليًا.';
  }
}
