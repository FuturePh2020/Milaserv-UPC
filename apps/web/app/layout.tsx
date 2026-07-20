import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
  title: "Milaserv 360",
  description: "Milaserv 360 — CRM, order management, and telesales performance platform",
  icons: { icon: "/branding/milaserv-logo.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-brand-surface text-brand-text-dark antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
