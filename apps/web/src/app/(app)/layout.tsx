'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';

/** Authenticated shell: sidebar + topbar. Redirects anonymous users to login
 *  and forces the change-password flow when required. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status, me } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    else if (status === 'authenticated' && me?.mustChangePassword) {
      router.replace('/change-password');
    }
  }, [status, me, router]);

  if (status !== 'authenticated' || me?.mustChangePassword) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
