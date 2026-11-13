import type { Router } from '../http/router.ts';
import { createExport } from '../services/exports.ts';
import { getInventoryReport, getMovementsReport, getOrdersReport, getProductsReport } from '../services/reports.ts';
import { getSettings, updateSettings } from '../services/settings.ts';

/** Business settings, operational reports and exports (stage 14). Administrator only. */
export function registerAdminBusinessRoutes(router: Router): void {
  router.get('/api/v1/admin/settings', getSettings);
  router.add('PATCH', '/api/v1/admin/settings', updateSettings);
  router.get('/api/v1/admin/reports/orders', getOrdersReport);
  router.get('/api/v1/admin/reports/products', getProductsReport);
  router.get('/api/v1/admin/reports/inventory', getInventoryReport);
  router.get('/api/v1/admin/reports/movements', getMovementsReport);
  router.add('POST', '/api/v1/admin/exports', createExport);
}
