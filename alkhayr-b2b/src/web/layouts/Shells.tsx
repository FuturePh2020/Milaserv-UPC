import { useState, type ReactNode } from 'react';
import logoUrl from '../../../public/assets/brand/alkhayr-logo-480.png';
import { Button, IconButton } from '../components/Button.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { Icon, type IconName } from '../components/Icon.tsx';

/**
 * Application shells (presentation only). Which navigation is shown depends on the identity
 * returned by /auth/me, but every API call is still authorized by the server: hiding a link
 * is not an access control.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export const MERCHANT_NAV: readonly NavItem[] = [
  { href: '#/catalog', label: 'الكتالوج', icon: 'store' },
  { href: '#/cart', label: 'السلة', icon: 'cart' },
  { href: '#/orders', label: 'طلباتي', icon: 'orders' },
  { href: '#/account', label: 'حسابي', icon: 'user' },
];
/** Pending merchants see no catalog or order navigation. */
export const PENDING_NAV: readonly NavItem[] = [{ href: '#/account', label: 'حسابي', icon: 'user' }];

export const ADMIN_NAV: ReadonlyArray<{ heading: string; items: readonly NavItem[] }> = [
  {
    heading: 'العمليات',
    items: [
      { href: '#/admin', label: 'الرئيسية', icon: 'shield' },
      { href: '#/admin/orders', label: 'الطلبات', icon: 'orders' },
    ],
  },
  {
    heading: 'الكتالوج والمخزون',
    items: [
      { href: '#/admin/products', label: 'المنتجات', icon: 'box' },
      { href: '#/admin/inventory', label: 'المخزون', icon: 'inventory' },
      { href: '#/admin/imports', label: 'استيراد CSV', icon: 'upload' },
    ],
  },
  { heading: 'الحسابات', items: [{ href: '#/admin/merchants', label: 'التجار', icon: 'users' }] },
  {
    heading: 'التقارير والإعدادات',
    items: [
      { href: '#/admin/reports', label: 'التقارير', icon: 'chart' },
      { href: '#/admin/settings', label: 'الإعدادات', icon: 'settings' },
    ],
  },
  {
    // The administrator's OWN approved company profile ordering (own-order routes, not admin views).
    heading: 'مشتريات الشركة',
    items: [
      { href: '#/catalog', label: 'الكتالوج', icon: 'store' },
      { href: '#/cart', label: 'السلة', icon: 'cart' },
      { href: '#/orders', label: 'طلبات الشركة', icon: 'orders' },
    ],
  },
];

const isCurrent = (path: string, href: string) => {
  const target = href.replace(/^#/, '');
  if (target === '/admin') return path === '/admin'; // the landing page is not a section
  return path === target || path.startsWith(`${target}/`) || (target === '/cart' && path === '/checkout');
};

function NavLink({ item, path, onNavigate, count }: { item: NavItem; path: string; onNavigate?: () => void; count?: number }) {
  return (
    <a className="l-navlink" href={item.href} {...(isCurrent(path, item.href) ? { 'aria-current': 'page' as const } : {})} onClick={onNavigate}>
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {count ? <span className="l-count">({count})</span> : null}
    </a>
  );
}

function Brand({ portal, href }: { portal: string; href: string }) {
  return (
    <a className="l-header__brand" href={href}>
      {/* Authentic supplied logo (D-011), optimized derivative. */}
      <img className="l-header__logo" src={logoUrl} alt="الخير" width={72} height={32} />
      <span className="l-header__portal">{portal}</span>
    </a>
  );
}

export interface AccountView {
  /** Company name (may be long; truncated visually, full text in the title). */
  businessName: string;
  username: string;
}

function LogoutButton({ onLogout, busy, compact = false }: { onLogout: () => void; busy: boolean; compact?: boolean }) {
  return compact ? (
    <IconButton icon="logout" label="تسجيل الخروج" onClick={onLogout} disabled={busy} directional />
  ) : (
    <Button variant="secondary" size="small" icon="logout" onClick={onLogout} busy={busy} busyLabel="جارٍ الخروج…">
      تسجيل الخروج
    </Button>
  );
}

function AccountArea({ account, onLogout, logoutBusy }: { account: AccountView; onLogout: () => void; logoutBusy: boolean }) {
  return (
    <div className="l-account">
      <a className="l-account__name" href="#/account" title={account.businessName}>
        {account.businessName}
      </a>
      <LogoutButton onLogout={onLogout} busy={logoutBusy} compact />
    </div>
  );
}

function SkipLink() {
  return (
    <a className="skip-link" href="#main" onClick={(e) => {
      // Hash routing: move focus without changing the route.
      e.preventDefault();
      document.getElementById('main')?.focus();
    }}>
      تخطَّ إلى المحتوى
    </a>
  );
}

// ------------------------------------------------------------------ AuthLayout

/** Signed-out pages (sign in, registration, status screens before a session exists). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="l-auth">
      <main id="main" tabIndex={-1} className="l-auth__panel">
        <div className="l-auth__brand">
          <img className="l-auth__logo" src={logoUrl} alt="الخير" width={176} height={78} />
          <p className="l-auth__tagline">بوابة طلبات الجملة للتجار</p>
        </div>
        {children}
        <p className="l-auth__footer">للاستفسار عن الحسابات تواصل مع إدارة الخير.</p>
      </main>
    </div>
  );
}

// ------------------------------------------------------------------ MerchantLayout

/**
 * Trader shell. Desktop: links in the header. Mobile: a bottom tab bar with the primary tasks
 * (catalog, orders, account); logout stays in the header on every width.
 */
export function MerchantLayout({
  kind,
  account,
  path,
  onLogout,
  logoutBusy = false,
  banner,
  cartCount = 0,
  children,
}: {
  kind: 'merchant' | 'pending';
  account: AccountView;
  path: string;
  onLogout: () => void;
  logoutBusy?: boolean;
  banner?: ReactNode;
  /** Number of cart lines (shown on the cart link). */
  cartCount?: number;
  children: ReactNode;
}) {
  const nav = kind === 'merchant' ? MERCHANT_NAV : PENDING_NAV;
  return (
    <div className="l-merchant">
      <SkipLink />
      <header className="l-header">
        <Brand portal="بوابة التجار" href={kind === 'merchant' ? '#/catalog' : '#/account'} />
        <nav className="l-merchant__nav" aria-label="التنقل الرئيسي">
          {nav.map((item) => (
            <NavLink key={item.href} item={item} path={path} {...(item.href === '#/cart' ? { count: cartCount } : {})} />
          ))}
        </nav>
        <span className="l-header__spacer" />
        <AccountArea account={account} onLogout={onLogout} logoutBusy={logoutBusy} />
      </header>
      {banner}
      <main id="main" tabIndex={-1} className="l-main">
        {children}
      </main>
      {nav.length > 1 ? (
        <nav className="l-tabbar" aria-label="التنقل السريع">
          {nav.map((item) => (
            <a key={item.href} href={item.href} {...(isCurrent(path, item.href) ? { 'aria-current': 'page' as const } : {})}>
              <Icon name={item.icon} />
              <span>
                {item.label}
                {item.href === '#/cart' && cartCount ? ` (${cartCount})` : ''}
              </span>
            </a>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ AdminLayout

/**
 * Administrator shell. Desktop: a grouped sidebar. Mobile/tablet: a menu button opens a
 * focus-managed drawer with the same navigation plus account and logout (no tiny bottom tabs).
 */
export function AdminLayout({
  account,
  path,
  onLogout,
  logoutBusy = false,
  banner,
  cartCount = 0,
  children,
}: {
  account: AccountView;
  path: string;
  onLogout: () => void;
  logoutBusy?: boolean;
  banner?: ReactNode;
  cartCount?: number;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const groups = (onNavigate?: () => void) =>
    ADMIN_NAV.map((group) => (
      <div key={group.heading}>
        <p className="l-sidenav__heading">{group.heading}</p>
        {group.items.map((item) => (
          <NavLink key={item.href} item={item} path={path} {...(onNavigate ? { onNavigate } : {})} {...(item.href === '#/cart' ? { count: cartCount } : {})} />
        ))}
      </div>
    ));
  return (
    <div className="l-admin">
      <SkipLink />
      <header className="l-header">
        <IconButton className="l-admin__menu-button" icon="menu" label="فتح قائمة الإدارة" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)} />
        <Brand portal="لوحة الإدارة" href="#/admin/orders" />
        <span className="l-header__spacer" />
        <AccountArea account={account} onLogout={onLogout} logoutBusy={logoutBusy} />
      </header>
      <aside className="l-admin__sidebar">
        <nav className="l-sidenav" aria-label="قائمة الإدارة">
          {groups()}
          <p className="l-sidenav__heading">الحساب</p>
          <NavLink item={{ href: '#/account', label: 'حسابي والأمان', icon: 'shield' }} path={path} />
        </nav>
      </aside>
      <div className="l-admin__content">
        {banner}
        <main id="main" tabIndex={-1} className="l-main">
          {children}
        </main>
      </div>
      <Dialog open={drawerOpen} onClose={() => setDrawerOpen(false)} title="قائمة الإدارة" variant="drawer">
        <nav className="l-sidenav" aria-label="قائمة الإدارة (الجوال)">
          {groups(() => setDrawerOpen(false))}
          <p className="l-sidenav__heading">الحساب</p>
          <NavLink item={{ href: '#/account', label: 'حسابي والأمان', icon: 'shield' }} path={path} onNavigate={() => setDrawerOpen(false)} />
        </nav>
        <div className="l-drawer__footer">
          <span className="muted">{account.businessName}</span>
          <LogoutButton onLogout={onLogout} busy={logoutBusy} />
        </div>
      </Dialog>
    </div>
  );
}
