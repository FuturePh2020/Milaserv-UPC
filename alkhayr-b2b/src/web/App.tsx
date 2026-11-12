import { useState, type ReactNode } from 'react';
import { ToastProvider, useToast } from './components/Toast.tsx';
import { AdminLayout, AuthLayout, MerchantLayout, type AccountView } from './layouts/Shells.tsx';
import { ForbiddenView, IdentityLoadingScreen, NetworkFailureView, NotFoundView, PendingApprovalView, SessionExpiredView, SignedOutView, UpcomingScreen } from './layouts/States.tsx';
import { AccountPage } from './pages/Account.tsx';
import { useHashPath } from './router.tsx';
import { IdentityProvider, shellKind, useIdentity } from './session/identity.tsx';

/**
 * Production application. Order of decisions: identity (GET /auth/me) -> shell -> screen.
 * No administrator data is requested before /auth/me says the user is an administrator, and
 * the server authorizes every request regardless of what is shown here.
 */
function Routes() {
  const path = useHashPath();
  const { state, reload, logout } = useIdentity();
  const toast = useToast();
  const [logoutBusy, setLogoutBusy] = useState(false);

  if (state.status === 'loading') return <IdentityLoadingScreen />;
  if (state.status === 'signed_out')
    return (
      <AuthLayout>
        <SignedOutView />
      </AuthLayout>
    );
  if (state.status === 'expired')
    return (
      <AuthLayout>
        <SessionExpiredView onContinue={reload} />
      </AuthLayout>
    );
  if (state.status === 'network_error')
    return (
      <AuthLayout>
        <NetworkFailureView failure={state.failure} onRetry={reload} />
      </AuthLayout>
    );

  const { me } = state;
  const kind = shellKind(me);
  const account: AccountView = { businessName: me.merchant.businessName, username: me.user.username };
  const onLogout = async () => {
    setLogoutBusy(true);
    const failure = await logout();
    setLogoutBusy(false);
    // Per the API contract a failed logout leaves the session valid: say so, do not pretend.
    if (failure) toast(`لم يتم تسجيل الخروج: ${failure.message}${failure.requestId ? ` (مرجع: ${failure.requestId})` : ''}`, 'danger');
  };
  const now = Date.now();

  if (kind === 'admin') {
    const route = path === '/' ? '/admin/orders' : path;
    let screen: ReactNode;
    if (route === '/account') screen = <AccountPage me={me} now={now} />;
    else if (route === '/admin/orders') screen = <UpcomingScreen title="الطلبات" stage={12} description="مراجعة الطلبات وتأكيدها وتجهيزها وشحنها." />;
    else if (route === '/admin/products') screen = <UpcomingScreen title="المنتجات" stage={12} description="إضافة المنتجات وتعديل بياناتها وأسعارها." />;
    else if (route === '/admin/inventory') screen = <UpcomingScreen title="المخزون" stage={12} description="أرصدة المخزون وحركاته." />;
    else if (route === '/admin/merchants') screen = <UpcomingScreen title="التجار" stage={12} description="مراجعة حسابات التجار واعتمادها." />;
    else screen = <NotFoundView home="#/admin/orders" />;
    const recentExpired = me.session.recentAuthUntil !== null && me.session.recentAuthUntil <= now;
    return (
      <AdminLayout account={account} path={route} onLogout={onLogout} logoutBusy={logoutBusy} banner={recentExpired ? <p className="l-banner l-banner--warning">مضت أكثر من 15 دقيقة على آخر تحقق؛ ستحتاج لتسجيل الدخول من جديد قبل أي إجراء إداري.</p> : undefined}>
        {screen}
      </AdminLayout>
    );
  }

  const home = kind === 'merchant' ? '/catalog' : '/account';
  const route = path === '/' ? home : path;
  let screen: ReactNode;
  if (route.startsWith('/admin')) screen = <ForbiddenView home={`#${home}`} />;
  else if (route === '/account') screen = kind === 'pending' ? <><PendingApprovalView businessName={me.merchant.businessName} /><AccountPage me={me} now={now} /></> : <AccountPage me={me} now={now} />;
  else if (kind === 'pending' && (route === '/catalog' || route === '/orders')) screen = <PendingApprovalView businessName={me.merchant.businessName} />;
  else if (route === '/catalog') screen = <UpcomingScreen title="الكتالوج" stage={11} description="تصفح المنتجات المتاحة وإضافتها إلى الطلب." />;
  else if (route === '/orders') screen = <UpcomingScreen title="طلباتي" stage={11} description="متابعة طلباتك وحالتها." />;
  else screen = <NotFoundView home={`#${home}`} />;
  return (
    <MerchantLayout kind={kind} account={account} path={route} onLogout={onLogout} logoutBusy={logoutBusy}>
      {screen}
    </MerchantLayout>
  );
}

/**
 * `devRoutes` is supplied ONLY by the development entry (main.dev.tsx) for the component
 * gallery. The production entry passes nothing, so no preview code exists in the release.
 */
export function App({ devRoutes }: { devRoutes?: (path: string) => ReactNode | null }) {
  const path = useHashPath();
  const dev = devRoutes?.(path) ?? null;
  if (dev) return <ToastProvider>{dev}</ToastProvider>;
  return (
    <ToastProvider>
      <IdentityProvider>
        <Routes />
      </IdentityProvider>
    </ToastProvider>
  );
}
