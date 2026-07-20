'use client';

/**
 * Client-side token store. Access tokens are short-lived (15 min default);
 * refresh tokens rotate on every use. Upgrading to an httpOnly-cookie BFF
 * later only changes this file + api.ts.
 */
const ACCESS_KEY = 'milaserv.access';
const REFRESH_KEY = 'milaserv.refresh';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string): void {
  window.localStorage.setItem(ACCESS_KEY, access);
  window.localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}
