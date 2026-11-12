import type { Router } from '../http/router.ts';
import { getAdminOrder, listAdminOrders, transitionOrder } from '../services/fulfillment.ts';

/** Administrator order handling. No update/delete routes: orders change only through transitions. */
export function registerAdminOrderRoutes(router: Router): void {
  router.get('/api/v1/admin/orders', listAdminOrders);
  router.get('/api/v1/admin/orders/:id', getAdminOrder);
  router.add('POST', '/api/v1/admin/orders/:id/transitions', transitionOrder);
}
