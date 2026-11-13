import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { ApiFailure } from '../api/client.ts';
import { OperationCoordinator } from './coordinator.ts';

export type { OperationEntry, OperationStatus } from './coordinator.ts';

const Ctx = createContext<OperationCoordinator | null>(null);

/** Mount once inside the administrator shell (keyed by identity). */
export function OperationsProvider({ onAuthFailure, children }: { onAuthFailure: (f: ApiFailure) => void; children: ReactNode }) {
  const coordinator = useMemo(() => new OperationCoordinator(onAuthFailure), []); // eslint-disable-line react-hooks/exhaustive-deps
  const version = useSyncExternalStore(coordinator.subscribe, coordinator.version);
  const pending = coordinator.unresolved().length > 0;
  useEffect(() => () => coordinator.clear(), [coordinator]); // identity change / sign-out: drop everything
  useEffect(() => {
    if (!pending) return;
    // Supported, but NOT guaranteed (browsers may suppress or not show it): the notice explains the limits.
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending, version]);
  return <Ctx.Provider value={coordinator}>{children}</Ctx.Provider>;
}

export function useCoordinator(): OperationCoordinator {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCoordinator outside OperationsProvider');
  return c;
}

/** Re-renders when any entry changes; returns the coordinator. */
export function useOperations(): OperationCoordinator {
  const c = useCoordinator();
  useSyncExternalStore(c.subscribe, c.version);
  return c;
}
