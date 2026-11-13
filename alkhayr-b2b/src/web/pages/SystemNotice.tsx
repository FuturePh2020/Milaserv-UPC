import { restoreDetected } from '../api/client.ts';
import type { MeResponse } from '../api/contracts.ts';
import { Button } from '../components/Button.tsx';

/**
 * Stage 16: explains a temporary write suspension without claiming that anything failed.
 * - recovery: data was restored from a backup; staff are reconciling; reading works, new operations wait.
 * - maintenance: the server found an inconsistency and stopped accepting new operations until checked.
 * - restored while this page was open: operations prepared on this page belong to the old data;
 *   reload so that nothing prepared before the restore is sent as new.
 */
export function SystemNotice({ me }: { me: MeResponse }) {
  const status = me.system;
  const restored = restoreDetected();
  if (!restored && (!status || status.writes === 'open')) return null;
  if (restored) {
    return (
      <div className="l-banner l-banner--warning" role="alert">
        <p>
          <strong>استُعيدت بيانات البوابة من نسخة احتياطية أثناء فتح هذه الصفحة.</strong> العمليات التي جُهّزت هنا قبل الاستعادة لن تُرسل كعمليات جديدة. أعد تحميل الصفحة، ثم راجع طلباتك وسجلاتك قبل أي عملية جديدة.
        </p>
        <Button size="small" variant="secondary" onClick={() => window.location.reload()}>
          إعادة تحميل الصفحة
        </Button>
      </div>
    );
  }
  return (
    <p className="l-banner l-banner--warning" role="status">
      {status?.reason === 'recovery' ? (
        <>
          <strong>البوابة في وضع الاستعادة:</strong> استُعيدت البيانات من نسخة احتياطية وتجري مراجعتها. يمكنك التصفح ومراجعة طلباتك، لكن لا تُقبل طلبات أو تعديلات جديدة مؤقتًا. هذا لا يعني أن طلباتك السابقة فشلت.
        </>
      ) : (
        <>
          <strong>البوابة في وضع الصيانة:</strong> لا تُقبل طلبات أو تعديلات جديدة مؤقتًا أثناء مراجعة فنية. يمكنك التصفح ومراجعة طلباتك. هذا لا يعني أن طلباتك السابقة فشلت.
        </>
      )}
    </p>
  );
}
