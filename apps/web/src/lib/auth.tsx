'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { clearTokens, getAccessToken, setTokens } from './tokens';
import type { EffectivePermissions, Me } from './types';

interface LoginResult {
  mustChangePassword: boolean;
}

interface AuthContextValue {
  status: 'loading' | 'authenticated' | 'anonymous';
  me: Me | null;
  permissions: EffectivePermissions['permissions'];
  hasPermission: (key: string) => boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [permissions, setPermissions] = useState<EffectivePermissions['permissions']>({});

  const reload = useCallback(async () => {
    if (!getAccessToken()) {
      setStatus('anonymous');
      setMe(null);
      setPermissions({});
      return;
    }
    try {
      const [meData, permData] = await Promise.all([
        api<Me>('/auth/me'),
        api<EffectivePermissions>('/me/permissions'),
      ]);
      setMe(meData);
      setPermissions(permData.permissions);
      setStatus('authenticated');
    } catch {
      setStatus('anonymous');
      setMe(null);
      setPermissions({});
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const res = await api<{
        accessToken: string;
        refreshToken: string;
        mustChangePassword: boolean;
      }>('/auth/login', { method: 'POST', body: { email, password }, retry: false });
      setTokens(res.accessToken, res.refreshToken);
      await reload();
      return { mustChangePassword: res.mustChangePassword };
    },
    [reload],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', retry: false });
    } catch {
      // Session may already be gone — local cleanup still applies.
    }
    clearTokens();
    setMe(null);
    setPermissions({});
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      me,
      permissions,
      hasPermission: (key: string) => key in permissions,
      login,
      logout,
      reload,
    }),
    [status, me, permissions, login, logout, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
