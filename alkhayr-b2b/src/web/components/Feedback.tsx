import type { ReactNode } from 'react';
import type { ApiFailure, ApiFailureKind } from '../api/client.ts';
import { Button } from './Button.tsx';
import { Icon, type IconName } from './Icon.tsx';
import { RequestRef } from './Text.tsx';

export function Spinner({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <span className="cluster muted" role="status">
      <span className="c-spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

/** Placeholder blocks while data loads; hidden from assistive technology (a status is announced instead). */
export function Skeleton({ width = '100%', height = '1rem' }: { width?: string; height?: string }) {
  // Sizes are applied through the CSSOM (allowed by the CSP), never as an inline style attribute.
  const size = (el: HTMLSpanElement | null) => {
    if (el) {
      el.style.inlineSize = width;
      el.style.blockSize = height;
    }
  };
  return <span className="c-skeleton" aria-hidden="true" ref={size} />;
}

export function SkeletonLines({ lines = 3, label = 'جارٍ تحميل البيانات…' }: { lines?: number; label?: string }) {
  return (
    <div className="stack" aria-busy="true">
      <span className="visually-hidden" role="status">
        {label}
      </span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

export function Notice({ tone, title, children, icon }: { tone: 'info' | 'warning' | 'danger' | 'success'; title?: string; children: ReactNode; icon?: IconName }) {
  const defaultIcon: Record<typeof tone, IconName> = { info: 'info', warning: 'alert', danger: 'alert', success: 'check' };
  return (
    <div className={`c-notice c-notice--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={icon ?? defaultIcon[tone]} />
      <div className="c-notice__body">
        {title ? <p className="c-notice__title">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

export function StateView({
  icon,
  title,
  message,
  tone = 'neutral',
  actions,
  children,
  live = false,
}: {
  icon: IconName;
  title: string;
  message?: ReactNode;
  tone?: 'neutral' | 'danger' | 'warning';
  actions?: ReactNode;
  children?: ReactNode;
  /** Announce the state (errors that replace content). */
  live?: boolean;
}) {
  return (
    <section className={`c-state c-state--${tone}`} {...(live ? { role: 'alert' } : {})}>
      <span className="c-state__icon">
        <Icon name={icon} />
      </span>
      <h2 className="c-state__title">{title}</h2>
      {message ? <p className="c-state__message">{message}</p> : null}
      {children}
      {actions ? <div className="c-state__actions">{actions}</div> : null}
    </section>
  );
}

/** Empty results — only rendered for a SUCCESSFUL response with no items. */
export function EmptyState({ title, message, actions }: { title: string; message?: ReactNode; actions?: ReactNode }) {
  return <StateView icon="box" title={title} message={message} actions={actions} />;
}

const FAILURE_VIEW: Record<ApiFailureKind, { icon: IconName; title: string; tone: 'danger' | 'warning' | 'neutral' }> = {
  network: { icon: 'wifiOff', title: 'تعذّر الاتصال بالخادم', tone: 'danger' },
  unauthenticated: { icon: 'lock', title: 'انتهت الجلسة', tone: 'warning' },
  forbidden: { icon: 'shield', title: 'غير مسموح', tone: 'warning' },
  not_found: { icon: 'info', title: 'غير موجود', tone: 'neutral' },
  conflict: { icon: 'alert', title: 'تعارض في البيانات', tone: 'warning' },
  reauth_required: { icon: 'lock', title: 'يلزم تأكيد الهوية من جديد', tone: 'warning' },
  validation: { icon: 'alert', title: 'بيانات غير صالحة', tone: 'danger' },
  payload_too_large: { icon: 'alert', title: 'البيانات أكبر من المسموح', tone: 'danger' },
  rate_limited: { icon: 'clock', title: 'محاولات كثيرة', tone: 'warning' },
  unavailable: { icon: 'clock', title: 'الخدمة مشغولة مؤقتًا', tone: 'warning' },
  server: { icon: 'alert', title: 'خطأ في الخادم', tone: 'danger' },
  invalid_response: { icon: 'alert', title: 'استجابة غير متوقعة', tone: 'danger' },
};

/**
 * Error state for a failed request. `onRetry` should only be offered for reads, or for a
 * mutation retried with the SAME idempotency key (the caller decides).
 */
export function ErrorState({ failure, onRetry, onSignIn }: { failure: ApiFailure; onRetry?: () => void; onSignIn?: () => void }) {
  const view = FAILURE_VIEW[failure.kind];
  const wait = failure.kind === 'rate_limited' && failure.retryAfterSeconds ? ` حاول بعد ${Math.ceil(failure.retryAfterSeconds / 60)} دقيقة تقريبًا.` : '';
  return (
    <StateView
      icon={view.icon}
      title={view.title}
      tone={view.tone}
      message={failure.message + wait}
      live
      actions={
        <>
          {(failure.kind === 'unauthenticated' || failure.kind === 'reauth_required') && onSignIn ? (
            <Button onClick={onSignIn} icon="lock">
              تسجيل الدخول
            </Button>
          ) : null}
          {onRetry && failure.kind !== 'unauthenticated' && failure.kind !== 'forbidden' ? (
            <Button variant="secondary" icon="refresh" onClick={onRetry}>
              إعادة المحاولة
            </Button>
          ) : null}
        </>
      }
    >
      <RequestRef requestId={failure.requestId} />
    </StateView>
  );
}

/**
 * Conflict (409): the record changed on the server. The user's draft is kept; nothing is
 * overwritten automatically. `onReview` reloads the current server data for comparison.
 */
export function ConflictNotice({ failure, onReview, draftKept = true }: { failure: ApiFailure; onReview?: () => void; draftKept?: boolean }) {
  return (
    <Notice tone="warning" title="لم يُحفظ التغيير بسبب تعارض">
      <p>{failure.message}</p>
      {draftKept ? <p>ما أدخلته ما زال محفوظًا في هذه الصفحة. راجع البيانات الحالية ثم قرّر من جديد.</p> : null}
      {onReview ? (
        <Button variant="secondary" size="small" icon="refresh" onClick={onReview}>
          عرض البيانات الحالية
        </Button>
      ) : null}
      <RequestRef requestId={failure.requestId} />
    </Notice>
  );
}
