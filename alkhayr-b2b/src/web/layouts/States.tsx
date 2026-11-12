import type { ApiFailure } from '../api/client.ts';
import { Button, ButtonLink } from '../components/Button.tsx';
import { ErrorState, Spinner, StateView } from '../components/Feedback.tsx';
import { RequestRef } from '../components/Text.tsx';

/**
 * Identity-level screens. Copy is factual: features that do not exist yet are described as
 * such, and no button pretends to perform an action that is not implemented.
 */

export function IdentityLoadingScreen() {
  return (
    <div className="c-state">
      <Spinner label="جارٍ التحقق من الجلسة…" />
    </div>
  );
}

/** Signed out. Sign-in and registration screens are delivered in stage 11. */
export function SignedOutView() {
  return (
    <section className="c-card stack" aria-labelledby="signed-out-title">
      <h1 id="signed-out-title" className="c-card__title">
        مرحبًا بك في بوابة الخير للتجار
      </h1>
      <p>أنت غير مسجّل الدخول حاليًا.</p>
      <p className="muted">شاشات تسجيل الدخول وإنشاء الحساب قيد الإنشاء ولم تُتح في هذه النسخة بعد.</p>
    </section>
  );
}

export function SessionExpiredView({ onContinue }: { onContinue: () => void }) {
  return (
    <StateView
      icon="clock"
      tone="warning"
      title="انتهت الجلسة"
      message="انتهت جلستك بسبب عدم النشاط أو تسجيل الخروج من جهاز آخر. لم يُحفظ أي إجراء لم يكتمل قبل انتهاء الجلسة."
      live
      actions={<Button onClick={onContinue}>متابعة</Button>}
    />
  );
}

/** Pending approval: no prices, catalog or orders until an administrator approves the account. */
export function PendingApprovalView({ businessName }: { businessName: string }) {
  return (
    <StateView
      icon="clock"
      tone="warning"
      title="حسابك قيد المراجعة"
      message={`تم استلام بيانات «${businessName}». ستتمكن من رؤية الأسعار والطلب بعد اعتماد الحساب من الإدارة.`}
    >
      <p className="muted">لا تُرسل أي رسائل تلقائية عند الاعتماد؛ يمكنك العودة إلى هذه الصفحة لاحقًا.</p>
    </StateView>
  );
}

/** 428: administrative actions need a fresh password + authenticator sign-in. */
export function ReauthRequiredView({ onSignInAgain, requestId = null }: { onSignInAgain?: () => void; requestId?: string | null }) {
  return (
    <StateView
      icon="lock"
      tone="warning"
      title="يلزم تأكيد الهوية من جديد"
      message="لأمان العمليات الإدارية، يلزم تسجيل الدخول بكلمة المرور ورمز التحقق إذا مرّت أكثر من 15 دقيقة على آخر تحقق. لم يُنفَّذ الإجراء المطلوب."
      live
      actions={onSignInAgain ? <Button onClick={onSignInAgain} icon="lock">تسجيل الدخول من جديد</Button> : null}
    >
      <RequestRef requestId={requestId} />
    </StateView>
  );
}

export function ForbiddenView({ home }: { home: string }) {
  return (
    <StateView
      icon="shield"
      tone="warning"
      title="غير مسموح"
      message="ليست لديك صلاحية لعرض هذه الصفحة."
      actions={<ButtonLink href={home}>العودة إلى الصفحة الرئيسية</ButtonLink>}
    />
  );
}

export function NotFoundView({ home }: { home: string }) {
  return <StateView icon="info" title="الصفحة غير موجودة" actions={<ButtonLink href={home}>العودة إلى الصفحة الرئيسية</ButtonLink>} />;
}

export function NetworkFailureView({ failure, onRetry }: { failure: ApiFailure; onRetry: () => void }) {
  return <ErrorState failure={failure} onRetry={onRetry} />;
}

/** Honest placeholder for areas whose screens are built in a later stage. */
export function UpcomingScreen({ title, stage, description }: { title: string; stage: number; description: string }) {
  return (
    <section aria-labelledby="upcoming-title">
      <div className="c-page-header">
        <div>
          <h1 id="upcoming-title">{title}</h1>
          <p className="c-page-header__desc">{description}</p>
        </div>
      </div>
      <StateView icon="info" title="هذه الشاشة قيد الإنشاء" message={`تُضاف هذه الشاشة في المرحلة ${stage}. لا يمكن تنفيذ أي عملية من هنا حاليًا.`} />
    </section>
  );
}
