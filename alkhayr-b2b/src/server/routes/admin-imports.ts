import type { Router } from '../http/router.ts';
import { createPrefilledTemplate } from '../services/exports.ts';
import { commitImport, getImport, getImportTemplate, listImports, previewImport } from '../services/imports.ts';

/** Administrator CSV imports (stage 13) and their read-only history and pre-filled templates (stage 14). */
export function registerAdminImportRoutes(router: Router): void {
  router.get('/api/v1/admin/imports', listImports);
  router.get('/api/v1/admin/imports/:id', getImport);
  router.get('/api/v1/admin/imports/templates/:file', getImportTemplate);
  router.add('POST', '/api/v1/admin/imports/templates/prefilled', createPrefilledTemplate);
  router.add('POST', '/api/v1/admin/imports/preview', previewImport);
  router.add('POST', '/api/v1/admin/imports/commit', commitImport);
}
