"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, LayoutDashboard, ShoppingCart } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { BrandLogo, BrandLoadingScreen } from "@/components/brand-logo";

const HEARTBEAT_INTERVAL_MS = 30_000;

const NAV = [
  { href: "/agent/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agent/my-orders", label: "My Orders", icon: ShoppingCart },
];

export function AgentShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== "AGENT")) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    api.post("/sessions/heartbeat").catch(() => undefined);
    heartbeatRef.current = setInterval(() => {
      api.post("/sessions/heartbeat").catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [user]);

  if (loading || !user) {
    return <BrandLoadingScreen />;
  }

  return (
    <div className="min-h-screen bg-brand-surface">
      <header className="flex items-center justify-between bg-brand-navy px-6 py-3">
        <div className="flex items-center gap-6">
          <BrandLogo size={30} showWordmark />
          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active ? "bg-brand-teal text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon size={15} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-sm text-white/70">Welcome, {user.fullName}</p>
          <button onClick={logout} className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
