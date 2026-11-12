import type { Router } from '../http/router.ts';
import { createAdjustment, getLedger, listInventory } from '../services/inventory.ts';

/** Inventory administration. Ledger history has no update/delete routes (append-only). */
export function registerAdminInventoryRoutes(router: Router): void {
  router.get('/api/v1/admin/inventory', listInventory);
  router.get('/api/v1/admin/inventory/:id/ledger', getLedger);
  router.add('POST', '/api/v1/admin/inventory/:id/adjustments', createAdjustment);
}
