'use client';

/** Small shadcn-style primitives on Tailwind 4 — enough for Phase 1 screens. */
import { useEffect } from 'react';

function cx(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  const styles = {
    primary: 'bg-[#0b2545] text-white hover:bg-[#13315c] disabled:bg-gray-300',
    secondary: 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
    ghost: 'text-gray-600 hover:bg-gray-100',
  }[variant];
  return (
    <button
      className={cx(
        'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        styles,
        className,
      )}
      {...props}
    />
  );
}

export function Input({
  label,
  error,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>}
      <input
        className={cx(
          'w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#0b2545] focus:ring-2 focus:ring-[#0b2545]/20',
          error && 'border-red-500',
          className,
        )}
        {...props}
      />
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Select({
  label,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>}
      <select
        className={cx(
          'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#0b2545]',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Badge({
  tone = 'gray',
  children,
}: {
  tone?: 'gray' | 'green' | 'red' | 'blue' | 'amber';
  children: React.ReactNode;
}) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    blue: 'bg-blue-100 text-blue-800',
    amber: 'bg-amber-100 text-amber-800',
  }[tone];
  return (
    <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-medium', tones)}>
      {children}
    </span>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'max-h-[85vh] w-full overflow-y-auto rounded-lg bg-white p-5 shadow-xl',
          wide ? 'max-w-3xl' : 'max-w-md',
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center p-8" role="status" aria-live="polite">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-[#0b2545]" />
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="p-8 text-center text-sm text-gray-500">{message}</div>;
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="m-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {message}
    </div>
  );
}
