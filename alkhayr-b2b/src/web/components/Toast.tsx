import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './Button.tsx';
import { Icon } from './Icon.tsx';

type Tone = 'info' | 'success' | 'danger';
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<((message: string, tone?: Tone) => void) | null>(null);

/**
 * Brief status announcements. Info/success are polite; danger is assertive. Toasts are for
 * confirmations of REAL server results only — never for unfinished features.
 * Errors that block a task are shown inline as well (a toast alone is easy to miss).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (message: string, tone: Tone = 'info') => {
      const id = next.current++;
      setItems((list) => [...list.slice(-1), { id, tone, message }]); // at most two visible
      if (tone !== 'danger') window.setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="c-toasts" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <div key={t.id} className={`c-toast c-toast--${t.tone}`} role={t.tone === 'danger' ? 'alert' : 'status'}>
            <Icon name={t.tone === 'danger' ? 'alert' : t.tone === 'success' ? 'check' : 'info'} />
            <div className="c-toast__body">{t.message}</div>
            <IconButton icon="close" label="إغلاق التنبيه" onClick={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string, tone?: Tone) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
