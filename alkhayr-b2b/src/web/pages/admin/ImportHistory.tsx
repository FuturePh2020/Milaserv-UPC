import { getImport, listImports, type ImportHistoryItem } from '../../api/admin.ts';
import { DataTable, LoadMore } from '../../components/DataTable.tsx';
import { EmptyState, ErrorState, Notice, SkeletonLines, StateView } from '../../components/Feedback.tsx';
import { Ltr } from '../../components/Text.tsx';
import { formatDateTime, formatInteger } from '../../format.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { usePaged } from '../../hooks/usePaged.ts';
import { href } from '../../router.tsx';

const MODE_AR: Record<string, string> = {
  create_products: 'إنشاء منتجات',
  update_products: 'تعديل منتجات',
  receive_stock: 'استلام مخزون',
  set_stock_total: 'ضبط الرصيد الفعلي',
};

/**
 * Read-only history of COMMITTED import batches (stage 14), for reconciliation after an unclear
 * outcome. There is no "run again": importing the same file again with a new key is a NEW operation
 * and may add stock or create products a second time.
 */
export function ImportHistoryPage() {
  const list = usePaged<ImportHistoryItem>('imports', (cursor, signal) => listImports(cursor ? { cursor } : {}, signal));
  return (
    <section className="stack" aria-labelledby="ih-title">
      <p>
        <a href={href('/admin/imports')}>العودة إلى الاستيراد</a>
      </p>
      <h1 id="ih-title">عمليات الاستيراد المنفّذة</h1>
      <Notice tone="info">
        <p>
          تُعرض هنا العمليات التي نُفّذت فعلًا فقط (لا المعاينات). استخدمها للتحقق قبل استيراد ملف مرة أخرى: استيراد الملف نفسه بمفتاح جديد عملية جديدة وقد يضيف الرصيد أو ينشئ
          المنتجات مرة ثانية. لا يُحفظ محتوى الملفات.
        </p>
      </Notice>
      {list.status === 'loading' ? <SkeletonLines lines={5} label="جارٍ تحميل العمليات…" /> : null}
      {list.status === 'error' && list.failure ? <ErrorState failure={list.failure} onRetry={list.reload} /> : null}
      {list.status === 'ok' && list.items.length === 0 ? <EmptyState title="لا توجد عمليات استيراد منفّذة" /> : null}
      {list.status === 'ok' && list.items.length ? (
        <>
          <DataTable
            caption="عمليات الاستيراد المنفّذة"
            captionHidden
            rows={list.items}
            rowKey={(r) => r.id}
            columns={[
              { key: 't', header: 'الوقت', nowrap: true, rowHeader: true, cell: (r) => <a href={href(`/admin/imports/${r.id}`)}>{formatDateTime(r.createdAt)}</a> },
              { key: 'm', header: 'النوع', nowrap: true, cell: (r) => MODE_AR[r.mode] ?? r.mode },
              { key: 'n', header: 'السجلات', numeric: true, cell: (r) => formatInteger(r.recordCount) },
              { key: 'a', header: 'بواسطة', nowrap: true, cell: (r) => <Ltr>{r.actor}</Ltr> },
              { key: 'i', header: 'رقم العملية', cell: (r) => <Ltr mono>{r.id}</Ltr> },
            ]}
          />
          <LoadMore shown={list.items.length} hasMore={list.nextCursor !== null} busy={list.loadingMore} onLoadMore={list.loadMore} />
          {list.moreFailure ? <ErrorState failure={list.moreFailure} onRetry={list.loadMore} /> : null}
        </>
      ) : null}
    </section>
  );
}

export function ImportDetailPage({ id }: { id: string }) {
  const data = useLoad(`import:${id}`, (signal) => getImport(id, signal));
  if (data.status === 'loading') return <SkeletonLines lines={6} label="جارٍ تحميل العملية…" />;
  if (data.status === 'error') return data.failure.kind === 'not_found' ? <StateView icon="info" title="العملية غير موجودة" /> : <ErrorState failure={data.failure} onRetry={data.reload} />;
  const op = data.data;
  const stock = op.mode === 'receive_stock' || op.mode === 'set_stock_total';
  return (
    <section className="stack" aria-labelledby="id-title">
      <p>
        <a href={href('/admin/imports/history')}>العودة إلى العمليات</a>
      </p>
      <h1 id="id-title">عملية استيراد: {MODE_AR[op.mode] ?? op.mode}</h1>
      <p>
        رقم العملية <Ltr mono>{op.id}</Ltr> · {formatDateTime(op.createdAt)} · بواسطة <Ltr>{op.actor}</Ltr> · {formatInteger(op.recordCount)} سجل · {formatInteger(op.fileBytes)} بايت
      </p>
      <DataTable
        caption="السجلات المنفّذة"
        captionHidden
        rows={op.items}
        rowKey={(i) => String(i.recordNo)}
        columns={[
          { key: 'n', header: 'السجل', nowrap: true, rowHeader: true, cell: (i) => <>#{i.recordNo}<br /><span className="muted">سطر {i.line}</span></> },
          { key: 'p', header: 'المنتج (الاسم الحالي)', wide: true, cell: (i) => <a href={href(`/admin/products/${i.productId}`)}>{i.productName}</a> },
          { key: 'v', header: 'الإصدار بعدها', numeric: true, cell: (i) => formatInteger(i.productVersionAfter) },
          { key: 'l', header: stock ? 'حركة المخزون' : 'المخزون', nowrap: true, cell: (i) => <a href={href(`/admin/inventory/${i.productId}`)}>{i.ledgerId ? `حركة #${i.ledgerId}` : 'سجل الحركات'}</a> },
        ]}
      />
    </section>
  );
}
