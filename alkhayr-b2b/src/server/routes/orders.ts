import type { Router } from '../http/router.ts';
import { createOrder, getOwnOrder, listOwnOrders, quoteOrder } from '../services/orders.ts';

/** Own orders of the signed-in approved merchant. No update/delete routes; administrator order routes arrive in stage 09. */
export function registerOrderRoutes(router: Router): void {
  router.get('/api/v1/orders', listOwnOrders);
  router.add('POST', '/api/v1/orders', createOrder);
  router.add('POST', '/api/v1/orders/quote', quoteOrder);
  router.get('/api/v1/orders/:id', getOwnOrder);
}
