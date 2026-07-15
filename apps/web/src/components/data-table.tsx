'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, Spinner } from './ui';

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[] | undefined;
  isLoading: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
}

/** Server-paginated table (blueprint §22: pagination for large datasets). */
export function DataTable<T>({
  columns,
  data,
  isLoading,
  total = 0,
  page = 1,
  pageSize = 20,
  onPageChange,
}: DataTableProps<T>) {
  const t = useTranslations('common');
  const table = useReactTable({
    data: data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <EmptyState message={t('empty')} />;

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-start text-xs uppercase tracking-wide text-gray-500">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-4 py-3 text-start font-medium">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-gray-100">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onPageChange && (
        <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
          <span>{t('total', { count: total })}</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              {t('previous')}
            </Button>
            <span>{t('page', { page, pages })}</span>
            <Button
              variant="secondary"
              disabled={page >= pages}
              onClick={() => onPageChange(page + 1)}
            >
              {t('next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
