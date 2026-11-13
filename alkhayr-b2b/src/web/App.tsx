import { SystemNotice } from './pages/SystemNotice.tsx';
import { useState, type ReactNode } from 'react';
import type { SessionCsrfToken } from './api/client.ts';
import type { MeResponse } from './api/contracts.ts';
import { CartProvider, useCart } from './cart/CartContext.tsx';
import { ToastProvider, useToast } from './components/Toast.tsx';
import { AdminLayout, AuthLayout, MerchantLayout, type AccountView } from './layouts/Shells.tsx';
import { OperationsProvider } from './admin/operations.tsx';
import { hasUnresolved } from './admin/unresolved.ts';
import { ImportPage } from './pages/admin/Imports.tsx';
import { ImportDetailPage, ImportHistoryPage } from './pages/admin/ImportHistory.tsx';
import { ReportsPage } from './pages/admin/Reports.tsx';
import { SettingsPage } from './pages/admin/Settings.tsx';
import { OrderSummaryPrintPage } from './pages/OrderSummaryPrint.tsx';
import { UnresolvedBanner } from './pages/admin/UnresolvedBanner.tsx';
import { ForbiddenView, IdentityLoadingScreen, NetworkFailureView, NotFoundView, PendingApprovalView } from './layouts/States.tsx';
import { AdminHomePage } from './pages/admin/AdminHome.tsx';
import { AdminOrderDetailPage, AdminOrdersPage } from './pages/admin/AdminOrders.tsx';
import { InventoryDetailPage, InventoryPage } from './pages/admin/Inventory.tsx';
import { MerchantDetailPage, MerchantsPage } from './pages/admin/Merchants.tsx';
import { ProductCreatePage, ProductEditPage, ProductsPage } from './pages/admin/Products.tsx';
import { AccountPage } from './pages/Account.tsx';
import { LoginPage } from './pages/auth/Login.tsx';
import { PasswordChangePage } from './pages/auth/PasswordChange.tsx';
import { RegisterPage } from './pages/auth/Register.tsx';
import { CartPage } from './pages/cart/CartPage.tsx';
import { CheckoutPage } from './pages/cart/Checkout.tsx';
import { LegacySubmissionNotice } from './pages/cart/LegacySubmissionNotice.tsx';
import { CatalogPage } from './pages/catalog/Catalog.tsx';
import { ProductDetailPage } from './pages/catalog/ProductDetail.tsx';
import { OrderDetailPage, OrdersPage } from './pages/orders/Orders.tsx';
import { navigate, useRoute, type Route } from './router.tsx';
import { IdentityProvider, shellKind, useIdentity } from './session/identity.tsx';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Screens of the approved purchasing experience (traders, and administrators for their own company). */
function purchasingScreen(route: Route, me: MeResponse, csrf: SessionCsrfToken, home: string): ReactNode | null {
  const { path, query } = route;
  if (path === '/catalog') return <CatalogPage query={query} />;
  const product = /^\/catalog\/([^/]+)$/.exec(path);
  if (product) return UUID.test(product[1]!) ? <ProductDetailPage key={product[1]} id={product[1]!} backQuery={query} /> : <NotFoundView home={home} />;
  if (path === '/cart') return <CartPage />;
  if (path === '/checkout') return <CheckoutPage csrf={csrf} />;
  if (path === '/orders') return <OrdersPage query={query} />;
  const order = /^\/orders\/([^/]+)$/.exec(path);
  if (order) return UUID.test(order[1]!) ? <OrderDetailPage key={order[1]} id={order[1]!} received={query.get('received')} /> : <NotFoundView home={home} />;
  if (path === '/account') return <AccountPage me={me} csrf={csrf} now={Date.now()} />;
  if (path === '/account/password') return <PasswordChangePage csrf={csrf} isAdmin={me.user.role === 'admin'} />;
  return null;
}

/**
 * Administration screens. Mounted ONLY inside the administrator shell (after /auth/me reported an
 * administrator), so a trader never requests an administration endpoint; the server authorizes
 * every call regardless.
 */
function adminScreen(route: Route, csrf: SessionCsrfToken): ReactNode {
  const { path, query } = route;
  const home = '#/admin';
  const id = (re: RegExp) => {
    const m = re.exec(path);
    return m && UUID.test(m[1]!) ? m[1]! : m ? '' : null;
  };
  if (path === '/admin') return <AdminHomePage />;
  if (path === '/admin/merchants') return <MerchantsPage query={query} />;
  if (path === '/admin/products') return <ProductsPage query={query} csrf={csrf} />;
  if (path === '/admin/products/new') return <ProductCreatePage csrf={csrf} />;
  if (path === '/admin/inventory') return <InventoryPage query={query} />;
  if (path === '/admin/orders') return <AdminOrdersPage query={query} />;
  if (path === '/admin/imports') return <ImportPage csrf={csrf} />;
  if (path === '/admin/imports/history') return <ImportHistoryPage />;
  if (path === '/admin/settings') return <SettingsPage csrf={csrf} />;
  if (path === '/admin/reports') return <ReportsPage query={query} csrf={csrf} />;
  const importOp = id(/^\/admin\/imports\/([^/]+)$/);
  if (importOp) return <ImportDetailPage key={importOp} id={importOp} />;
  const merchant = id(/^\/admin\/merchants\/([^/]+)$/);
  if (merchant) return <MerchantDetailPage key={merchant} id={merchant} csrf={csrf} />;
  const product = id(/^\/admin\/products\/([^/]+)$/);
  if (product) return <ProductEditPage key={product} id={product} csrf={csrf} created={query.get('created') === '1'} />;
  const inventory = id(/^\/admin\/inventory\/([^/]+)$/);
  if (inventory) return <InventoryDetailPage key={inventory} id={inventory} csrf={csrf} />;
  const order = id(/^\/admin\/orders\/([^/]+)$/);
  if (order) return <AdminOrderDetailPage key={order} id={order} csrf={csrf} />;
  return <NotFoundView home={home} />;
}

/** Shell for one verified identity. Everything inside is remounted for another identity (key). */
function SignedInShell({ me, csrf, route, onLogout, logoutBusy }: { me: MeResponse; csrf: SessionCsrfToken; route: Route; onLogout: () => void; logoutBusy: boolean }) {
  const cart = useCart();
  const { handleAuthFailure } = useIdentity();
  const kind = shellKind(me);
  const account: AccountView = { businessName: me.merchant.businessName, username: me.user.username };
  if (kind === 'admin') {
    const r = route.path === '/' ? { ...route, path: '/admin' } : route;
    const screen = purchasingScreen(r, me, csrf, '#/admin') ?? adminScreen(r, csrf);
    const recentExpired = me.session.recentAuthUntil !== null && me.session.recentAuthUntil <= Date.now();
    return (
      <OperationsProvider onAuthFailure={handleAuthFailure}>
        <AdminLayout
          account={account}
          path={r.path}
          onLogout={onLogout}
          logoutBusy={logoutBusy}
          cartCount={cart.cart.lines.length}
          banner={
            <>
              <SystemNotice me={me} />
              {recentExpired ? <p className="l-banner l-banner--warning">مضت أكثر من 15 دقيقة على آخر تحقق؛ ستحتاج لتسجيل الدخول من جديد قبل أي إجراء إداري.</p> : null}
              <UnresolvedBanner path={r.path} />
            </>
          }
        >
          {screen}
        </AdminLayout>
      </OperationsProvider>
    );
  }
  const home = '#/catalog';
  const r = route.path === '/' ? { ...route, path: '/catalog' } : route;
  const screen = r.path.startsWith('/admin') ? <ForbiddenView home={home} /> : (purchasingScreen(r, me, csrf, home) ?? <NotFoundView home={home} />);
  return (
    <MerchantLayout kind="merchant" account={account} path={r.path} onLogout={onLogout} logoutBusy={logoutBusy} cartCount={cart.cart.lines.length} banner={
        <>
          <SystemNotice me={me} />
          <LegacySubmissionNotice />
        </>
      }
    >
      {screen}
    </MerchantLayout>
  );
}

/** Pending traders: account, profile and password only. Catalog and orders are NOT fetched. */
function PendingShell({ me, csrf, route, onLogout, logoutBusy }: { me: MeResponse; csrf: SessionCsrfToken; route: Route; onLogout: () => void; logoutBusy: boolean }) {
  const account: AccountView = { businessName: me.merchant.businessName, username: me.user.username };
  const path = route.path === '/' ? '/account' : route.path;
  let screen: ReactNode;
  if (path === '/account') screen = <AccountPage me={me} csrf={csrf} now={Date.now()} />;
  else if (path === '/account/password') screen = <PasswordChangePage csrf={csrf} isAdmin={false} />;
  else if (path.startsWith('/admin')) screen = <ForbiddenView home="#/account" />;
  else screen = <PendingApprovalView businessName={me.merchant.businessName} />;
  return (
    <MerchantLayout kind="pending" account={account} path={path} onLogout={onLogout} logoutBusy={logoutBusy} banner={<SystemNotice me={me} />}>
      {screen}
    </MerchantLayout>
  );
}

function Routes() {
  const route = useRoute();
  const { state, reload, logout } = useIdentity();
  const toast = useToast();
  const [logoutBusy, setLogoutBusy] = useState(false);

  if (state.status === 'loading') return <IdentityLoadingScreen />;
  if (state.status === 'network_error') {
    // A failed identity request is NOT a confirmed sign-out.
    return (
      <AuthLayout>
        <NetworkFailureView failure={state.failure} onRetry={reload} />
      </AuthLayout>
    );
  }
  if (state.status !== 'authenticated') {
    return <AuthLayout>{route.path === '/register' ? <RegisterPage /> : <LoginPage reason={state.status === 'expired' ? 'expired' : route.query.get('reason')} adminPreset={route.query.get('admin') === '1'} />}</AuthLayout>;
  }
  if (route.path === '/login') {
    // Re-authentication or switching account while signed in (always with a fresh pre-login token).
    return (
      <AuthLayout>
        <LoginPage reason={route.query.get('reason')} adminPreset={route.query.get('admin') === '1'} />
      </AuthLayout>
    );
  }
  const { me, csrf } = state;
  // Printable order summaries render WITHOUT the application shell (no navigation, buttons only on screen).
  const printOwn = /^\/orders\/([0-9a-f-]{36})\/print$/.exec(route.path);
  const printAdmin = /^\/admin\/orders\/([0-9a-f-]{36})\/print$/.exec(route.path);
  if (printAdmin && shellKind(me) === 'admin') return <OrderSummaryPrintPage key={`a${printAdmin[1]}`} id={printAdmin[1]!} admin />;
  if (printOwn && shellKind(me) !== 'pending') return <OrderSummaryPrintPage key={`m${printOwn[1]}`} id={printOwn[1]!} admin={false} />;
  const onLogout = async () => {
    // Signing out discards the in-memory key/payload of an operation whose outcome is unknown.
    if (hasUnresolved() && !window.confirm('توجد عملية إدارية لم تتأكد نتيجتها. تسجيل الخروج يفقد إمكانية إعادة إرسالها بنفس المفتاح. تحقق من السجل أولًا. هل تريد تسجيل الخروج؟')) return;
    setLogoutBusy(true);
    const failure = await logout();
    setLogoutBusy(false);
    // A failed logout leaves the session valid: say so, never pretend it succeeded.
    if (failure) toast(`لم يتم تسجيل الخروج: ${failure.message}${failure.requestId ? ` (مرجع: ${failure.requestId})` : ''}`, 'danger');
    else navigate('/login', { reason: 'logged-out' }, { replace: true });
  };
  const scopeKey = `${me.user.id}:${me.merchant.id}`;
  if (shellKind(me) === 'pending') return <PendingShell key={scopeKey} me={me} csrf={csrf} route={route} onLogout={onLogout} logoutBusy={logoutBusy} />;
  return (
    <CartProvider key={scopeKey} scope={{ userId: me.user.id, merchantId: me.merchant.id }}>
      <SignedInShell me={me} csrf={csrf} route={route} onLogout={onLogout} logoutBusy={logoutBusy} />
    </CartProvider>
  );
}

/**
 * `devRoutes` is supplied ONLY by the development entry (main.dev.tsx) for the component
 * gallery. The production entry passes nothing, so no preview code exists in the release.
 */
export function App({ devRoutes }: { devRoutes?: (path: string) => ReactNode | null }) {
  const route = useRoute();
  const dev = devRoutes?.(route.path) ?? null;
  if (dev) return <ToastProvider>{dev}</ToastProvider>;
  return (
    <ToastProvider>
      <IdentityProvider>
        <Routes />
      </IdentityProvider>
    </ToastProvider>
  );
}
