import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: Variant;
  size?: 'normal' | 'small';
  block?: boolean;
  icon?: IconName;
  /**
   * While true the button is disabled and announces "busy". This only prevents accidental
   * double clicks; the server's idempotency keys and version checks remain the real guard.
   */
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}

export function Button({ variant = 'primary', size = 'normal', block = false, icon, busy = false, busyLabel, children, className, disabled, type = 'button', ...rest }: ButtonProps) {
  const classes = ['c-button', `c-button--${variant}`, size === 'small' ? 'c-button--small' : '', block ? 'c-button--block' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button {...rest} type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? <span className="c-spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      <span>{busy && busyLabel ? busyLabel : children}</span>
    </button>
  );
}

/** Icon-only button: the accessible name is mandatory. */
export function IconButton({ icon, label, directional, className, type = 'button', ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & { icon: IconName; label: string; directional?: boolean }) {
  return (
    <button {...rest} type={type} className={['c-icon-button', className ?? ''].filter(Boolean).join(' ')} aria-label={label} title={label}>
      <Icon name={icon} {...(directional ? { directional } : {})} />
    </button>
  );
}

/** Navigation styled as a button (a real link: middle-click, copy link and keyboard work). */
export function ButtonLink({ href, variant = 'secondary', icon, children }: { href: string; variant?: Variant; icon?: IconName; children: ReactNode }) {
  return (
    <a href={href} className={`c-button c-button--${variant}`}>
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </a>
  );
}
