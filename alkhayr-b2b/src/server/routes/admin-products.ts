import type { Router } from '../http/router.ts';
import { createProduct, getAdminProduct, listAdminProducts, updateProduct } from '../services/products.ts';

/** Product administration. No DELETE: products are deactivated, never erased. */
export function registerAdminProductRoutes(router: Router): void {
  router.get('/api/v1/admin/products', listAdminProducts);
  router.add('POST', '/api/v1/admin/products', createProduct);
  router.get('/api/v1/admin/products/:id', getAdminProduct);
  router.add('PATCH', '/api/v1/admin/products/:id', updateProduct);
}
