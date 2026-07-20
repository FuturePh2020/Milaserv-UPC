"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  LayoutDashboard,
  Building2,
  ListChecks,
  Upload,
  Users,
  Coffee,
  Clock,
  Settings,
  FileBarChart,
  ShieldCheck,
  LogOut,
  Phone,
  ShoppingCart,
  PackagePlus,
  Repeat,
  Boxes,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { BrandLogo, BrandLoadingScreen } from "@/components/brand-logo";

const NAV = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/partners", label: "Partners", icon: Building2 },
  { href: "/admin/tasks", label: "Tasks", icon: ListChecks },
  { href: "/admin/lead-imports", label: "Lead Imports", icon: Upload },
  { href: "/admin/leads", label: "Leads", icon: FileBarChart },
  { href: "/admin/orders/create", label: "Create Order", icon: PackagePlus },
  { href: "/admin/team-orders", label: "Team Orders", icon: ShoppingCart },
  { href: "/admin/retention", label: "Retention", icon: Repeat },
  { href: "/admin/products", label: "Products & Items", icon: Boxes },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/sessions", label: "Sessions", icon: Clock },
  { href: "/admin/breaks", label: "Live Break Monitor", icon: Coffee },
  { href: "/admin/voip", label: "VoIP", icon: Phone },
  { href: "/admin/reports", label: "Reports", icon: FileBarChart },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/audit-logs", label: "Audit Logs", icon: ShieldCheck },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || user.role !== "ADMIN")) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return <BrandLoadingScreen />;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col bg-brand-navy-dark">
        <div className="border-b border-white/10 px-4 py-4">
          <BrandLogo size={32} showWordmark />
          <p className="mt-1 text-xs text-white/50">Admin Console</p>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-brand-teal text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-3">
          <p className="truncate text-xs text-white/50">{user.fullName}</p>
          <button
            onClick={logout}
            className="mt-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-brand-surface p-6">{children}</main>
    </div>
  );
}
