import { useOperations } from '../../admin/operations.tsx';
import { href } from '../../router.tsx';

/**
 * Shell-wide notice of administrator operations that are being sent or whose outcome is unknown,
 * with a link back to the owning screen (where the same-key retry or the explicit discard is).
 * Renders nothing when there are none.
 */
export function UnresolvedBanner({ path }: { path: string }) {
  const ops = useOperations().unresolved();
  if (ops.length === 0) return null;
  return (
    <div className="l-banner l-banner--warning" role="status">
      <p>
        <strong>{ops.length === 1 ? 'عملية إدارية لم تتأكد نتيجتها بعد:' : `${ops.length} عمليات إدارية لم تتأكد نتيجتها بعد:`}</strong>
      </p>
      <ul className="c-unresolved-list">
        {ops.map((o) => (
          <li key={o.slot}>
            {o.status === 'sending' ? 'جارٍ الإرسال — ' : 'النتيجة غير معروفة — '}
            {o.label}
            {o.href !== path ? (
              <>
                {' '}
                — <a href={href(o.href)}>العودة إلى العملية</a>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="muted">لا تُكرر العملية بنفسك: أعد إرسالها من شاشتها بنفس المفتاح، أو تجاهلها بعد مراجعة السجل. تُفقد من الذاكرة عند تحديث الصفحة أو إغلاقها أو انتهاء الجلسة.</p>
    </div>
  );
}
