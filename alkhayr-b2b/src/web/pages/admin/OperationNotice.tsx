import type { ApiFailure } from '../../api/client.ts';
import { Button } from '../../components/Button.tsx';
import { ErrorState, Notice } from '../../components/Feedback.tsx';
import { Ltr, RequestRef } from '../../components/Text.tsx';
import type { OperationState } from '../../hooks/useOperation.ts';
import { ReauthPanel } from './Reauth.tsx';

/**
 * Renders the non-success states of an idempotent administrator operation. Success is rendered by
 * the screen itself (it knows what the result means).
 */
export function OperationNotice<P extends { operationKey: string }, R>({
  state,
  onRetry,
  onDiscard,
  onReauthenticated,
  historyHint,
}: {
  state: OperationState<P, R>;
  onRetry: () => void;
  onDiscard: () => void;
  /** Called after re-authentication: re-fetch the record; the draft stays unsent. */
  onReauthenticated: () => void;
  /** Where to check whether an unclear operation was applied (e.g. "سجل الحركات"). */
  historyHint: string;
}) {
  if (state.status === 'sending') {
    return (
      <p className="cluster muted" role="status">
        <span className="c-spinner" aria-hidden="true" /> جارٍ التنفيذ… لا تغلق الصفحة.
      </p>
    );
  }
  if (state.status === 'unknown') {
    return (
      <Notice tone="warning" title="لم تتأكد نتيجة العملية">
        <p>انقطع الاتصال أو حدث خطأ قبل وصول الرد. قد تكون العملية نُفذت أو لم تُنفذ.</p>
        <p>
          «إعادة إرسال نفس العملية» ترسلها <strong>بنفس المفتاح ونفس البيانات</strong>: إن كانت قد نُفذت فسيعيد الخادم نتيجتها الأصلية ولن تتكرر. لا يمكن تعديل
          النموذج حتى تُحسم هذه العملية. يمكنك أيضًا مراجعة {historyHint}.
        </p>
        <p className="c-request-ref">
          مفتاح العملية: <Ltr mono>{state.payload.operationKey}</Ltr>
        </p>
        <div className="cluster">
          <Button icon="refresh" onClick={onRetry}>
            إعادة إرسال نفس العملية
          </Button>
          <Button variant="ghost" onClick={onDiscard}>
            تجاهل (بعد التحقق من {historyHint})
          </Button>
        </div>
        <RequestRef requestId={state.failure.requestId} />
      </Notice>
    );
  }
  if (state.status === 'reauth') return <ReauthPanel onDone={onReauthenticated} />;
  if (state.status === 'rejected') return <RejectedNotice failure={state.failure} />;
  return null;
}

export function RejectedNotice({ failure }: { failure: ApiFailure }) {
  if (failure.kind === 'conflict' || failure.kind === 'validation') {
    return (
      <Notice tone="danger" title="لم تُنفذ العملية">
        <p>{failure.message}</p>
        {failure.fields.length ? (
          <ul>
            {failure.fields.map((f, i) => (
              <li key={i}>{f.message}</li>
            ))}
          </ul>
        ) : null}
        <RequestRef requestId={failure.requestId} />
      </Notice>
    );
  }
  return <ErrorState failure={failure} />;
}
