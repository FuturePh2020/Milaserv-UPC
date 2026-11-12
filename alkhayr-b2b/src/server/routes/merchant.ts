import type { Router } from '../http/router.ts';
import { getOwnProfile, patchOwnProfile } from '../services/merchants.ts';

/** Self-service: the merchant is always the one bound to the session (no id in the path). */
export function registerMerchantRoutes(router: Router): void {
  router.get('/api/v1/merchant/profile', getOwnProfile);
  router.add('PATCH', '/api/v1/merchant/profile', patchOwnProfile);
}
