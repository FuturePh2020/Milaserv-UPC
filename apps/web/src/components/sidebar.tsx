'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth';

interface NavItem {
  href: string;
  labelKey: string;
  icon: string;
  /** Menu item renders only when the user holds this permission (null = always). */
  permission: string | null;
}

/**
 * Dynamic sidebar (blueprint §7 backbone): items appear strictly according to
 * the effective permissions resolved by the API — the same keys that guard
 * the endpoints. Later phases append items here with their own keys.
 */
const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard', icon: '▦', permission: null },
  { href: '/tickets', labelKey: 'tickets', icon: '🎫', permission: 'ticket.view' },
  { href: '/kb', labelKey: 'kb', icon: '📚', permission: 'kb.view' },
  { href: '/breaks', labelKey: 'breaks', icon: '⏱', permission: 'break.track' },
  { href: '/performance', labelKey: 'performance', icon: '📈', permission: 'performance.view' },
  { href: '/crm', labelKey: 'crm', icon: '📞', permission: 'crm.view' },
  { href: '/online', labelKey: 'online', icon: '🛒', permission: 'online.view' },
  { href: '/locator', labelKey: 'locator', icon: '📍', permission: 'branch.view' },
  { href: '/dic', labelKey: 'dic', icon: '💊', permission: 'dic.view' },
  { href: '/ocr', labelKey: 'ocr', icon: '🧾', permission: 'ocr.view' },
  {
    href: '/prescriptions',
    labelKey: 'prescriptionsIntake',
    icon: '📥',
    permission: 'ocr.view',
  },
  { href: '/notifications', labelKey: 'notifications', icon: '🔔', permission: null },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: '/admin/users', labelKey: 'users', icon: '👤', permission: 'user.view' },
  {
    href: '/admin/departments',
    labelKey: 'departments',
    icon: '🏢',
    permission: 'department.view',
  },
  { href: '/admin/teams', labelKey: 'teams', icon: '👥', permission: 'team.view' },
  { href: '/admin/branches', labelKey: 'branches', icon: '🏪', permission: 'branch.view' },
  { href: '/admin/kb', labelKey: 'kbAdmin', icon: '🗂', permission: 'kb.manage' },
  { href: '/admin/roles', labelKey: 'roles', icon: '🛡', permission: 'role.view' },
  { href: '/admin/settings', labelKey: 'settings', icon: '⚙', permission: 'setting.view' },
  { href: '/admin/audit', labelKey: 'audit', icon: '📜', permission: 'audit.view' },
  {
    href: '/admin/integrations',
    labelKey: 'integrations',
    icon: '🔌',
    permission: 'integration.monitor',
  },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const t = useTranslations('nav');
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
        active ? 'bg-white/15 font-medium text-white' : 'text-blue-100 hover:bg-white/10'
      }`}
    >
      <span aria-hidden>{item.icon}</span>
      {t(item.labelKey)}
    </Link>
  );
}

export function Sidebar() {
  const { hasPermission } = useAuth();
  const pathname = usePathname();
  const t = useTranslations();

  const navItems = NAV_ITEMS.filter((i) => !i.permission || hasPermission(i.permission));
  const adminItems = ADMIN_ITEMS.filter((i) => !i.permission || hasPermission(i.permission));

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-[#0b2545] p-4">
      <div className="mb-6 px-2">
        <div className="text-lg font-bold text-white">{t('app.name')}</div>
        <div className="text-xs text-blue-200">{t('app.tagline')}</div>
      </div>
      <nav className="flex flex-col gap-1">
        {navItems.map((item) => (
          <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
        ))}
        {adminItems.length > 0 && (
          <>
            <div className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-blue-300">
              {t('nav.administration')}
            </div>
            {adminItems.map((item) => (
              <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
            ))}
          </>
        )}
      </nav>
    </aside>
  );
}
