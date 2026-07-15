import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Milaserv360',
  description: 'Enterprise Healthcare Operations Platform',
};

// Locale-aware <html lang/dir> handling arrives with the i18n shell in Step 7.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
