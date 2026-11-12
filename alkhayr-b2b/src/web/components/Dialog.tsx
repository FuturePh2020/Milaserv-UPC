import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button, IconButton } from './Button.tsx';

/**
 * Modal dialog on the native <dialog> element (showModal): the rest of the page becomes inert,
 * Tab stays inside, Escape closes (unless `busy`), and focus returns to the element that
 * opened it. Initial focus goes to the element marked `data-autofocus`, else the first control.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  busy = false,
  variant = 'dialog',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** While an action is running, Escape/close is blocked so the result is not lost. */
  busy?: boolean;
  variant?: 'dialog' | 'drawer';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
      const target = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      target?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Restore focus to the opener whenever the dialog closes (any reason).
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onClosed = () => {
      const el = opener.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    };
    dialog.addEventListener('close', onClosed);
    return () => dialog.removeEventListener('close', onClosed);
  }, []);

  return (
    <dialog
      ref={ref}
      className={variant === 'drawer' ? 'c-dialog c-drawer' : 'c-dialog'}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault(); // keep React state the source of truth
        if (!busy) onClose();
      }}
      onKeyDown={(e) => {
        // Native modal dialogs let Tab leave to the browser UI; keep focus cycling inside.
        if (e.key !== 'Tab') return;
        const focusable = Array.from(
          e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="c-dialog__header">
        <h2 id={titleId} className="c-dialog__title">
          {title}
        </h2>
        <IconButton icon="close" label="إغلاق" onClick={onClose} disabled={busy} />
      </div>
      <div className="c-dialog__body">{children}</div>
      {footer ? <div className="c-dialog__footer">{footer}</div> : null}
    </dialog>
  );
}

/**
 * Confirmation before a consequential action. The confirm button shows a busy state while the
 * request runs; the server still decides (idempotency key, version check).
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'تراجع',
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy} data-autofocus>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} busy={busy} busyLabel="جارٍ التنفيذ…">
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
