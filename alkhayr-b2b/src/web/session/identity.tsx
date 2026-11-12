import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiGet, apiMutate, sessionCsrf, type ApiFailure, type SessionCsrfToken } from '../api/client.ts';
import { isLogoutResponse, isMeResponse, type MeResponse } from '../api/contracts.ts';

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
  /** Real POST /api/v1/auth/logout. On failure the session is still valid (API contract). */
  logout: () => Promise<ApiFailure | null>;
}

const IdentityContext = createContext<IdentityApi | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<IdentityState>({ status: 'loading' });
  const [generation, setGeneration] = useState(0);
  const wasAuthenticated = useRef(false);

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
  const logout = useCallback(async () => {
    if (state.status !== 'authenticated') return null;
    const r = await apiMutate({ method: 'POST', path: '/api/v1/auth/logout', csrf: state.csrf, validate: isLogoutResponse });
    if (r.ok) {
      wasAuthenticated.current = false;
      setState({ status: 'signed_out' });
      return null;
    }
    if (r.kind === 'unauthenticated') {
      setState({ status: 'expired' });
      return null;
    }
    return r;
  }, [state]);

  const api = useMemo(() => ({ state, reload, markExpired, logout }), [state, reload, markExpired, logout]);
  return <IdentityContext.Provider value={api}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityApi {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity must be used inside <IdentityProvider>');
  return ctx;
}
