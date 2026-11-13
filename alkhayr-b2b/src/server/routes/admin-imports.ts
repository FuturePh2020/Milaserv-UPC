import type { Router } from '../http/router.ts';
import { commitImport, getImportTemplate, previewImport } from '../services/imports.ts';

/** Administrator CSV imports (stage 13). Preview writes nothing; commit is all-or-nothing and idempotent. */
export function registerAdminImportRoutes(router: Router): void {
  router.get('/api/v1/admin/imports/templates/:file', getImportTemplate);
  router.add('POST', '/api/v1/admin/imports/preview', previewImport);
  router.add('POST', '/api/v1/admin/imports/commit', commitImport);
}
