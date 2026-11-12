import { useEffect, useState } from 'react';
import logoUrl from '../../public/assets/brand/alkhayr-logo-480.png';
import { apiGet, type ApiResult } from './api/client.ts';
import type { HealthResponse } from './api/contracts.ts';
import { useHashPath } from './router.tsx';

const isHealth = (v: unknown): v is HealthResponse =>
  typeof v === 'object' && v !== null && (v as { status?: unknown }).status === 'ok';

function ServerStatus() {
  const [result, setResult] = useState<ApiResult<HealthResponse> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void apiGet('/healthz', isHealth, controller.signal).then((r) => {
      if (!controller.signal.aborted) setResult(r);
    });
    return () => controller.abort();
  }, []);

  if (result === null) return <p className="status status--loading" role="status">جارٍ فحص اتصال الخادم…</p>;
  if (result.ok) return <p className="status status--ok" role="status">الخادم يعمل.</p>;
  return (
    <p className="status status--error" role="alert">
      {result.message}
      {result.requestId ? <span className="status__ref"> (مرجع: {result.requestId})</span> : null}
    </p>
  );
}

function FoundationPage() {
  return (
    <section className="card" aria-labelledby="foundation-title">
      <h1 id="foundation-title">بوابة الخير للتجار</h1>
      <p>
        هذه نسخة التأسيس الفنية. تسجيل الدخول والكتالوج والطلبات <strong>لم تُفعَّل بعد</strong>، وستُضاف في المراحل
        التالية بعد اختبارها على الخادم.
      </p>
      <ServerStatus />
    </section>
  );
}

function NotFoundPage() {
  return (
    <section className="card" aria-labelledby="not-found-title">
      <h1 id="not-found-title">الصفحة غير موجودة</h1>
      <p>
        <a href="#/">العودة إلى الصفحة الرئيسية</a>
      </p>
    </section>
  );
}

export function App() {
  const path = useHashPath();
  return (
    <div className="shell">
      <header className="shell__header">
        <img className="shell__logo" src={logoUrl} alt="الخير" width={160} height={71} />
      </header>
      <main className="shell__main">{path === '/' ? <FoundationPage /> : <NotFoundPage />}</main>
    </div>
  );
}
