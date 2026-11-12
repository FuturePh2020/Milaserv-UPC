import type { Router } from '../http/router.ts';
import { catalogFilters, getCatalogProduct, listCatalog } from '../services/products.ts';

/** Approved-trader catalog (approved merchants and administrators). */
export function registerCatalogRoutes(router: Router): void {
  router.get('/api/v1/products', listCatalog);
  router.get('/api/v1/products/:id', getCatalogProduct);
  router.get('/api/v1/catalog/filters', catalogFilters);
}
