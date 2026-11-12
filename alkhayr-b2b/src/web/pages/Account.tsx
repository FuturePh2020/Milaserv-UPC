import type { MeResponse } from '../api/contracts.ts';
import { MerchantStatusBadge } from '../components/Badges.tsx';
import { Ltr } from '../components/Text.tsx';
import { formatDateTime } from '../format.ts';

/** Read-only account summary from GET /auth/me (real data). Editing and password change: stage 11. */
export function AccountPage({ me, now }: { me: MeResponse; now: number }) {
  const m = me.merchant;
  const recent = me.session.recentAuthUntil;
  return (
    <section aria-labelledby="account-title" className="stack">
      <div className="c-page-header">
        <div>
          <h1 id="account-title">حسابي</h1>
          <p className="c-page-header__desc">بيانات الحساب كما هي مسجّلة لدى الإدارة.</p>
        </div>
        <MerchantStatusBadge status={m.status} />
      </div>
      <div className="c-card">
        <dl className="c-summary">
          <div className="c-summary__row">
            <dt>اسم النشاط</dt>
            <dd>{m.businessName}</dd>
          </div>
          <div className="c-summary__row">
            <dt>اسم المستخدم</dt>
            <dd>
              <Ltr>{me.user.username}</Ltr>
            </dd>
          </div>
          <div className="c-summary__row">
            <dt>المسؤول</dt>
            <dd>{m.contactName}</dd>
          </div>
          <div className="c-summary__row">
            <dt>الهاتف</dt>
            <dd>
              <Ltr>{m.phone}</Ltr>
            </dd>
          </div>
          <div className="c-summary__row">
            <dt>العنوان</dt>
            <dd>
              {m.governorate} — {m.address}
            </dd>
          </div>
          <div className="c-summary__row">
            <dt>تنتهي الجلسة في موعد أقصاه</dt>
            <dd>{formatDateTime(me.session.absoluteExpiresAt)}</dd>
          </div>
          {recent !== null ? (
            <div className="c-summary__row">
              <dt>صلاحية الإجراءات الإدارية</dt>
              <dd>{recent > now ? `حتى ${formatDateTime(recent)}` : 'انتهت — يلزم تسجيل الدخول من جديد قبل أي إجراء'}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      <p className="muted">تعديل البيانات وتغيير كلمة المرور من هذه الشاشة يُضافان في المرحلة 11.</p>
    </section>
  );
}
