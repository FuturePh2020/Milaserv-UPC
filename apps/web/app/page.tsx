"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
    } else if (user.role === "ADMIN") {
      router.replace("/admin/dashboard");
    } else {
      router.replace("/agent/dashboard");
    }
  }, [user, loading, router]);

  return (
    <div className="flex h-screen items-center justify-center text-slate-500">
      Loading...
    </div>
  );
}
