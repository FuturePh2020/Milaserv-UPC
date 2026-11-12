import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiGet, apiMutate, sessionCsrf, type ApiFailure, type SessionCsrfToken } from '../api/client.ts';
import { isLogoutResponse, isMeResponse, type MeResponse } from '../api/contracts.ts';
import { clearAllDrafts } from '../cart/storage.ts';

/**
 * Identity for PRESENTATION decisions only (which shell and navigation to show). Every API
 * request is still authorized by the server; hiding a link is never a security control.
 * The session CSRF token from /auth/me is held in React state (memory) only.
 */
export type IdentityState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  /** A session that existed in this page has ended (401 after sign-in, idle/absolute expiry). */
  | { status: 'expired' }
  | { status: 'network_error'; failure: ApiFailure }
  | { status: 'authenticated'; me: MeResponse; csrf: SessionCsrfToken };

/** Presentation role derived from /auth/me (admin > approved merchant > pending). */
export type ShellKind = 'admin' | 'merchant' | 'pending';

export function shellKind(me: MeResponse): ShellKind {
  if (me.user.role === 'admin') return 'admin';
  return me.merchant.status === 'approved' ? 'merchant' : 'pending';
}

interface IdentityApi {
  state: IdentityState;
  reload: () => void;
  /** Called when any request returns 401 while signed in. */
  markExpired: () => void;
  /** The server ended every session (password change): show the signed-out state, not "expired". */
  signedOut: () => void;
  /**
   * Re-reads /auth/me WITHOUT passing through "loading" (screens and their unsent drafts stay
   * mounted). Used after administrator re-authentication to pick up the new session and CSRF token.
   * Resolves false if the identity could not be confirmed (state is then updated accordingly).
   */
  refresh: () => Promise<boolean>;
  /** Real POST /api/v1/auth/logout. On failure the session is still valid (API contract). */
  logout: () => Promise<ApiFailure | null>;
  /**
   * Central reaction to a failed protected request. 401 -> session ended (protected UI is
   * removed); 403 ACCOUNT_PENDING / ACCESS_CHANGED -> the account's status changed, so identity
   * is re-read from the server. Other failures are left to the screen. Returns true if handled.
   */
  handleAuthFailure: (failure: ApiFailure) => boolean;
}

const IdentityContext = createContext<IdentityApi | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<IdentityState>({ status: 'loading' });
  const [generation, setGeneration] = useState(0);
  const wasAuthenticated = useRef(false);

  // A page restored from the back/forward cache may show a previous identity: re-check it.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setGeneration((g) => g + 1);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    apiGet('/api/v1/auth/me', isMeResponse, controller.signal).then(
      (r) => {
        if (controller.signal.aborted) return;
        if (r.ok) {
          wasAuthenticated.current = true;
          setState({ status: 'authenticated', me: r.data, csrf: sessionCsrf(r.data.csrfToken) });
        } else if (r.kind === 'unauthenticated') {
          setState(wasAuthenticated.current ? { status: 'expired' } : { status: 'signed_out' });
        } else {
          setState({ status: 'network_error', failure: r });
        }
      },
      () => undefined, // aborted
    );
    return () => controller.abort();
  }, [generation]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  const markExpired = useCallback(() => setState((s) => (s.status === 'authenticated' ? { status: 'expired' } : s)), []);
  const signedOut = useCallback(() => {
    wasAuthenticated.current = false;
    setState({ status: 'signed_out' });
  }, []);
  const logout = useCallback(async () => {
    if (state.status !== 'authenticated') return null;
    const r = await apiMutate({ method: 'POST', path: '/api/v1/auth/logout', csrf: state.csrf, validate: isLogoutResponse });
    if (r.ok) {
      wasAuthenticated.current = false;
      clearAllDrafts(); // explicit logout removes this browser's order drafts (docs/FRONTEND_API.md)
      setState({ status: 'signed_out' });
      return null;
    }
    if (r.kind === 'unauthenticated') {
      setState({ status: 'expired' });
      return null;
    }
    return r;
  }, [state]);

  const handleAuthFailure = useCallback(
    (failure: ApiFailure) => {
      if (failure.kind === 'unauthenticated') {
        markExpired();
        return true;
      }
      if (failure.code === 'ACCOUNT_PENDING' || failure.code === 'ACCESS_CHANGED') {
        reload();
        return true;
      }
      return false;
    },
    [markExpired, reload],
  );

  const refresh = useCallback(async () => {
    const r = await apiGet('/api/v1/auth/me', isMeResponse);
    if (r.ok) {
      wasAuthenticated.current = true;
      setState({ status: 'authenticated', me: r.data, csrf: sessionCsrf(r.data.csrfToken) });
      return true;
    }
    if (r.kind === 'unauthenticated') setState({ status: 'expired' });
    return false;
  }, []);

  const api = useMemo(() => ({ state, reload, markExpired, signedOut, refresh, logout, handleAuthFailure }), [state, reload, markExpired, signedOut, refresh, logout, handleAuthFailure]);
  return <IdentityContext.Provider value={api}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityApi {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity must be used inside <IdentityProvider>');
  return ctx;
}
