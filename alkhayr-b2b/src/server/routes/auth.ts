import type { Router } from '../http/router.ts';
import { changePassword, getCsrf, login, logout, me, register } from '../services/authentication.ts';

export function registerAuthRoutes(router: Router): void {
  router.get('/api/v1/auth/csrf', getCsrf);
  router.add('POST', '/api/v1/auth/register', register);
  router.add('POST', '/api/v1/auth/login', login);
  router.add('POST', '/api/v1/auth/logout', logout);
  router.get('/api/v1/auth/me', me);
  router.add('POST', '/api/v1/auth/password', changePassword);
}
