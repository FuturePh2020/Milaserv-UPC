"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";

const HEARTBEAT_INTERVAL_MS = 30_000;

export function AgentShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
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
    return <div className="flex h-screen items-center justify-center text-slate-500">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Leads Distributor CRM</p>
          <p className="text-xs text-slate-500">Welcome, {user.fullName}</p>
        </div>
        <button onClick={logout} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
          <LogOut size={16} /> Sign out
        </button>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
