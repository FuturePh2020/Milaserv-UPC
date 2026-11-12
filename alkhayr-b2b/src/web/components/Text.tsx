import type { ReactNode } from 'react';
import { formatCartons, formatMoney } from '../format.ts';

/** Left-to-right isolated run for barcodes, order numbers, request ids, phones and keys. */
export function Ltr({ children, mono = false, className }: { children: ReactNode; mono?: boolean; className?: string }) {
  return (
    <bdi dir="ltr" className={['ltr', mono ? 'mono' : '', className ?? ''].filter(Boolean).join(' ')}>
      {children}
    </bdi>
  );
}

/** Egyptian-pound amount from integer piasters; the number itself is an isolated LTR run. */
export function Money({ cents, className }: { cents: number; className?: string }) {
  return (
    <span className={['num', className ?? ''].filter(Boolean).join(' ')}>
      <bdi dir="ltr" className="ltr">
        {formatMoney(cents, { currency: false })}
      </bdi>{' '}
      ج.م
    </span>
  );
}

export function Cartons({ count }: { count: number }) {
  return <span className="num">{formatCartons(count)}</span>;
}

/** Safe support reference: shows the server request id (never tokens or bodies). */
export function RequestRef({ requestId }: { requestId: string | null }) {
  if (!requestId) return null;
  return (
    <p className="c-request-ref">
      رقم مرجعي للدعم: <Ltr mono>{requestId}</Ltr>
    </p>
  );
}
