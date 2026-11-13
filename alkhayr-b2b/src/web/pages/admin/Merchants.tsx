import { useState } from 'react';
import type { ApiFailure, SessionCsrfToken } from '../../api/client.ts';
import type { MerchantStatus } from '../../api/contracts.ts';
import { changeMerchantStatus, getMerchant, listMerchants, type AdminMerchant } from '../../api/admin.ts';
import { MERCHANT_TRANSITIONS } from '../../admin/logic.ts';
import { MerchantStatusBadge } from '../../components/Badges.tsx';
import { Button, ButtonLink } from '../../components/Button.tsx';
import { DataTable, LoadMore } from '../../components/DataTable.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { EmptyState, ErrorState, Notice, SkeletonLines, StateView } from '../../components/Feedback.tsx';
import { FilterBar, SearchInput } from '../../components/Filters.tsx';
import { Field, Select, TextArea } from '../../components/Form.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Ltr, RequestRef } from '../../components/Text.tsx';
import { formatDateTime } from '../../format.ts';
import { useStickyLoad } from '../../hooks/useLoad.ts';
import { usePaged } from '../../hooks/usePaged.ts';
import { MERCHANT_STATUS_LABEL } from '../../labels.ts';
import { href, navigate } from '../../router.tsx';
import { useIdentity } from '../../session/identity.tsx';
import { ReauthPanel } from './Reauth.tsx';

const STATUSES: MerchantStatus[] = ['pending', 'approved', 'suspended'];

export function MerchantsPage({ query }: { query: URLSearchParams }) {
  const rawStatus = query.get('status');
  const status = STATUSES.includes(rawStatus as MerchantStatus) ? (rawStatus as MerchantStatus) : undefined;
  const q = (query.get('q') ?? '').slice(0, 80) || undefined;
  const sortRaw = query.get('sort');
  const sort = sortRaw === 'oldest' || sortRaw === 'name' ? sortRaw : undefined;
  const key = JSON.stringify([status, q, sort]);
  const list = usePaged<AdminMerchant>(key, (cursor, signal) => listMerchants({ ...(status ? { status } : {}), ...(q ? { q } : {}), ...(sort ? { sort } : {}), ...(cursor ? { cursor } : {}) }, signal));
  const [search, setSearch] = useState(q ?? '');
  const [statusSel, setStatusSel] = useState(status ?? '');
  const [sortSel, setSortSel] = useState(sort ?? 'newest');
  const apply = () => navigate('/admin/merchants', { status: statusSel || undefined, q: search.trim() || undefined, sort: sortSel === 'newest' ? undefined : sortSel });
  return (
    <section className="stack" aria-labelledby="merchants-title">
      <div className="c-page-header">
        <div>
          <h1 id="merchants-title">التجار</h1>
          <p className="c-page-header__desc">مراجعة طلبات التسجيل واعتماد الحسابات أو إيقافها.</p>
        </div>
      </div>
      <FilterBar label="بحث وتصفية التجار" onSubmit={apply} actions={<Button type="submit" variant="secondary" icon="search">تطبيق</Button>}>
        <div className="c-filter-bar__search">
          <SearchInput label="بحث بالاسم أو اسم المستخدم أو الهاتف" value={search} onChange={setSearch} />
        </div>
        <div className="c-filter-bar__filter">
          <Field label="الحالة">
            {(p) => (
              <Select {...p} value={statusSel} onChange={(e) => setStatusSel(e.target.value)}>
                <option value="">كل الحالات</option>
                {STATUSES.map((s) => <option key={s} value={s}>{MERCHANT_STATUS_LABEL[s]}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <div className="c-filter-bar__filter">
          <Field label="الترتيب">
            {(p) => (
              <Select {...p} value={sortSel} onChange={(e) => setSortSel(e.target.value as typeof sortSel)}>
                <option value="newest">الأحدث</option>
                <option value="oldest">الأقدم</option>
                <option value="name">الاسم</option>
              </Select>
            )}
          </Field>
        </div>
      </FilterBar>
      {list.status === 'loading' ? <SkeletonLines lines={5} label="جارٍ تحميل التجار…" /> : null}
      {list.status === 'error' && list.failure ? <ErrorState failure={list.failure} onRetry={list.reload} /> : null}
      {list.status === 'ok' && list.items.length === 0 ? <EmptyState title="لا توجد حسابات مطابقة" /> : null}
      {list.status === 'ok' && list.items.length > 0 ? (
        <>
          <DataTable
            caption="قائمة التجار"
            captionHidden
            rows={list.items}
            rowKey={(m) => m.id}
            columns={[
              { key: 'n', header: 'النشاط', wide: true, rowHeader: true, cell: (m) => <a href={href(`/admin/merchants/${m.id}`)}>{m.businessName}</a> },
              { key: 'u', header: 'اسم المستخدم', nowrap: true, cell: (m) => <Ltr>{m.username}</Ltr> },
              { key: 's', header: 'الحالة', nowrap: true, cell: (m) => <><MerchantStatusBadge status={m.status} />{m.role === 'admin' ? <span className="muted"> (مدير)</span> : null}</> },
              { key: 'p', header: 'الهاتف', nowrap: true, cell: (m) => <Ltr>{m.phone}</Ltr> },
              { key: 'g', header: 'المحافظة', cell: (m) => m.governorate },
              { key: 'd', header: 'تاريخ التسجيل', nowrap: true, cell: (m) => formatDateTime(m.createdAt) },
            ]}
          />
          <LoadMore shown={list.items.length} hasMore={list.nextCursor !== null} busy={list.loadingMore} onLoadMore={list.loadMore} />
          {list.moreFailure ? <ErrorState failure={list.moreFailure} onRetry={list.loadMore} /> : null}
        </>
      ) : null}
    </section>
  );
}

const CONSEQUENCE: Record<MerchantStatus, string> = {
  approved: 'سيتمكن التاجر من رؤية الأسعار والطلب عند تسجيل دخوله التالي. لا تُرسل أي رسالة بريد أو SMS.',
  pending: 'تنتهي كل جلسات التاجر فورًا ويعود الحساب للمراجعة. الطلبات والحجوزات القائمة لا تُلغى ولا يُفك حجزها تلقائيًا؛ التأكيد والتجهيز والشحن يتوقفون حتى الاعتماد.',
  suspended: 'تنتهي كل جلسات التاجر فورًا ولا يستطيع الدخول. الطلبات والحجوزات القائمة لا تُلغى ولا يُفك حجزها تلقائيًا؛ يمكنك إلغاؤها يدويًا مع ذكر السبب، ويبقى تسليم ما شُحن ممكنًا.',
};

function StatusChange({ merchant, csrf, onChanged }: { merchant: AdminMerchant; csrf: SessionCsrfToken; onChanged: () => void }) {
  const { handleAuthFailure } = useIdentity();
  const toast = useToast();
  const options = MERCHANT_TRANSITIONS[merchant.status];
  const [chosen, setTo] = useState<MerchantStatus>(options[0]!.to);
  // If the record changed (conflict / another administrator), only currently valid targets are offered.
  const to = options.some((o) => o.to === chosen) ? chosen : options[0]!.to;
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [reauth, setReauth] = useState(false);
  const [unknown, setUnknown] = useState(false);
  // Version submitted when the server answered VERSION_CONFLICT. Until the CURRENT record (a different version) has
  // been loaded, the displayed record and its choices are stale: the controls stay disabled (stage 18 fix).
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const awaitingCurrent = conflictVersion !== null && merchant.version === conflictVersion;
  const rule = options.find((o) => o.to === to) ?? options[0]!;
  const reasonText = reason.trim();
  const reasonError = rule.reasonRequired && reasonText.length < 3 ? 'السبب مطلوب (3 إلى 200 حرف).' : reasonText.length > 200 ? 'السبب حتى 200 حرف.' : null;

  const submit = async () => {
    setBusy(true);
    setFailure(null);
    setUnknown(false);
    const r = await changeMerchantStatus(csrf, merchant.id, { status: to, expectedVersion: merchant.version, ...(reasonText ? { reason: reasonText } : {}) });
    setBusy(false);
    setConfirming(false);
    if (r.ok) {
      toast(`تم تغيير الحالة إلى «${MERCHANT_STATUS_LABEL[r.data.merchant.status]}»${r.data.sessionsRevoked ? `، وأُنهيت ${r.data.sessionsRevoked} جلسة` : ''}.`, 'success');
      onChanged();
      return;
    }
    if (r.kind === 'reauth_required') return setReauth(true);
    if (r.kind === 'network' || r.kind === 'server' || r.kind === 'unavailable' || r.kind === 'invalid_response') {
      // Not idempotency-keyed: never resent automatically. The current record decides.
      setUnknown(true);
      setFailure(r);
      return;
    }
    if (handleAuthFailure(r)) return;
    setFailure(r);
    if (r.code === 'VERSION_CONFLICT') {
      setConflictVersion(merchant.version);
      onChanged(); // show the CURRENT record; the draft must be reviewed again
    }
  };

  if (merchant.role === 'admin') {
    return <Notice tone="info"><p>حسابات المديرين محمية: لا يمكن تغيير حالتها أو دورها من هذه الشاشة.</p></Notice>;
  }
  return (
    <div className="c-card stack">
      <h2 className="c-card__title">تغيير حالة الحساب</h2>
      {reauth ? (
        <ReauthPanel
          onDone={() => {
            setReauth(false);
            onChanged(); // re-fetch; the chosen status and reason stay as an unsent draft
          }}
        />
      ) : null}
      {unknown ? (
        <Notice tone="warning" title="لم تتأكد نتيجة التغيير">
          <p>لم يصل رد مؤكد. لا يُعاد الإرسال تلقائيًا: حدّث بيانات التاجر لترى حالته الحالية قبل أي محاولة أخرى.</p>
          <Button size="small" variant="secondary" icon="refresh" onClick={onChanged}>
            عرض الحالة الحالية
          </Button>
          {failure ? <RequestRef requestId={failure.requestId} /> : null}
        </Notice>
      ) : null}
      {failure && !unknown ? (
        <Notice tone="danger" title="لم يُنفذ التغيير">
          <p>{failure.message}</p>
          {failure.code === 'VERSION_CONFLICT' ? (
            awaitingCurrent ? (
              <p role="status">جارٍ تحميل البيانات الحالية للتاجر… لا يمكن تغيير الحالة حتى تظهر.</p>
            ) : (
              <p>عُرضت البيانات الحالية للتاجر. راجعها ثم أكّد قرارك من جديد إن كان ما زال مناسبًا.</p>
            )
          ) : null}
          <RequestRef requestId={failure.requestId} />
        </Notice>
      ) : null}
      <Field id="merchant-to" label="الحالة الجديدة">
        {(p) => (
          <Select {...p} value={to} disabled={awaitingCurrent} onChange={(e) => setTo(e.target.value as MerchantStatus)}>
            {options.map((o) => <option key={o.to} value={o.to}>{MERCHANT_STATUS_LABEL[o.to]}</option>)}
          </Select>
        )}
      </Field>
      <Field id="merchant-reason" label={rule.reasonRequired ? 'السبب (مطلوب)' : 'السبب (اختياري)'} hint="يظهر في سجل حالة الحساب للإدارة." error={reason && reasonError ? reasonError : null}>
        {(p) => <TextArea {...p} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <Notice tone="info"><p>{CONSEQUENCE[to]}</p></Notice>
      <Button variant={to === 'approved' ? 'primary' : 'danger'} disabled={Boolean(reasonError) || busy || awaitingCurrent} onClick={() => setConfirming(true)}>
        {to === 'approved' ? 'اعتماد الحساب…' : to === 'suspended' ? 'إيقاف الحساب…' : 'إعادة للمراجعة…'}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={`تغيير حالة «${merchant.businessName}» إلى «${MERCHANT_STATUS_LABEL[to]}»؟`}
        confirmLabel="تأكيد التغيير"
        tone={to === 'approved' ? 'primary' : 'danger'}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void submit()}
      >
        <p>{CONSEQUENCE[to]}</p>
        {reasonText ? <p>السبب: {reasonText}</p> : null}
        <p className="muted">يُطبّق على النسخة المعروضة من البيانات (الإصدار {merchant.version}). إذا تغيّرت في الأثناء سيُرفض التغيير وتُعرض البيانات الحالية.</p>
      </ConfirmDialog>
    </div>
  );
}

export function MerchantDetailPage({ id, csrf }: { id: string; csrf: SessionCsrfToken }) {
  const [gen, setGen] = useState(0);
  const data = useStickyLoad(`merchant:${id}`, gen, (signal) => getMerchant(id, signal));
  if (data.initialLoading) return <SkeletonLines lines={6} label="جارٍ تحميل بيانات التاجر…" />;
  if (!data.data) {
    if (data.failure?.kind === 'not_found') return <StateView icon="info" title="الحساب غير موجود" actions={<ButtonLink href={href('/admin/merchants')}>التجار</ButtonLink>} />;
    return data.failure ? <ErrorState failure={data.failure} onRetry={data.reload} /> : null;
  }
  const { merchant: m, statusHistory } = data.data;
  const refreshNote = data.refreshing ? <p className="muted" role="status">جارٍ تحديث البيانات…</p> : data.failure ? <ErrorState failure={data.failure} onRetry={data.reload} /> : null;
  return (
    <section className="stack" aria-labelledby="merchant-title">
      <p>
        <a href={href('/admin/merchants')}>العودة إلى التجار</a>
      </p>
      {refreshNote}
      <div className="c-page-header">
        <div>
          <h1 id="merchant-title">{m.businessName}</h1>
          <p className="c-page-header__desc">
            اسم المستخدم: <Ltr>{m.username}</Ltr>
          </p>
        </div>
        <MerchantStatusBadge status={m.status} />
      </div>
      <div className="c-card">
        <dl className="c-summary">
          <div className="c-summary__row"><dt>المسؤول</dt><dd>{m.contactName}</dd></div>
          <div className="c-summary__row"><dt>الهاتف</dt><dd><Ltr>{m.phone}</Ltr></dd></div>
          <div className="c-summary__row"><dt>البريد</dt><dd>{m.email ? <Ltr>{m.email}</Ltr> : '—'}</dd></div>
          <div className="c-summary__row"><dt>العنوان</dt><dd>{m.governorate} — {m.address}</dd></div>
          <div className="c-summary__row"><dt>تاريخ التسجيل</dt><dd>{formatDateTime(m.createdAt)}</dd></div>
          <div className="c-summary__row"><dt>إصدار البيانات</dt><dd className="num">{m.version}</dd></div>
        </dl>
      </div>
      <StatusChange key={m.id} merchant={m} csrf={csrf} onChanged={() => setGen((g) => g + 1)} />
      <div className="c-card">
        <h2 className="c-card__title">سجل الحالة</h2>
        {statusHistory.length === 0 ? (
          <p className="muted">لا توجد تغييرات حالة مسجلة.</p>
        ) : (
          <ul className="c-cart">
            {statusHistory.map((h, i) => (
              <li key={i} className="c-review-line">
                <span>
                  {h.from ? MERCHANT_STATUS_LABEL[h.from] : '—'} ← {h.to ? MERCHANT_STATUS_LABEL[h.to] : '—'}
                  {h.reason ? <span className="muted"> — {h.reason}</span> : null}
                </span>
                <span className="muted">
                  {formatDateTime(h.at)}
                  {h.actor ? <> · <Ltr>{h.actor}</Ltr></> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
