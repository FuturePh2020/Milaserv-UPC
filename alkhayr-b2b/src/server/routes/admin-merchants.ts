import type { Router } from '../http/router.ts';
import { changeMerchantStatus, getMerchant, listMerchants } from '../services/merchants.ts';

export function registerAdminMerchantRoutes(router: Router): void {
  router.get('/api/v1/admin/merchants', listMerchants);
  router.get('/api/v1/admin/merchants/:id', getMerchant);
  router.add('PATCH', '/api/v1/admin/merchants/:id', changeMerchantStatus);
}
