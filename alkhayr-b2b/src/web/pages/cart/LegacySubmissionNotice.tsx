import { useCart } from '../../cart/CartContext.tsx';
import { Button } from '../../components/Button.tsx';
import { formatDateTime } from '../../format.ts';
import { href } from '../../router.tsx';

/**
 * Upgrade notice (stage 15): a submission saved by an older version could not be confirmed and cannot
 * be resent safely. It is NOT reported as failed: the order may exist. Nothing is resubmitted.
 */
export function LegacySubmissionNotice() {
  const { legacyNotice, dismissLegacyNotice } = useCart();
  if (!legacyNotice) return null;
  return (
    <div className="l-banner l-banner--warning" role="status">
      <p>
        <strong>طلب أُرسل قبل تحديث النظام ولم تتأكد نتيجته</strong> (حُفظ في {formatDateTime(legacyNotice.createdAt)}، {legacyNotice.lines} صنف). قد يكون الطلب قد وصل بالفعل.
        راجع <a href={href('/orders')}>طلباتي</a> قبل إرسال طلب بديل حتى لا يتكرر. لن يُعاد إرساله تلقائيًا.
      </p>
      <Button size="small" variant="secondary" onClick={dismissLegacyNotice}>
        راجعت طلباتي — إخفاء التنبيه
      </Button>
    </div>
  );
}
