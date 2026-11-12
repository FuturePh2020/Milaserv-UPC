import type { ReactNode } from 'react';
import { Button } from './Button.tsx';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Right-aligned tabular numbers (amounts, quantities). */
  numeric?: boolean;
  nowrap?: boolean;
  /** Use the cell as the row header (<th scope="row">), e.g. the order number. */
  rowHeader?: boolean;
  /** Long free text (names, addresses): reserve a readable column width instead of squeezing. */
  wide?: boolean;
}

/**
 * Accessible data table. Wide tables scroll horizontally INSIDE a focusable region
 * (keyboard users can scroll it), so the page itself never overflows.
 */
export function DataTable<T>({ caption, columns, rows, rowKey, captionHidden = false }: { caption: string; columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; captionHidden?: boolean }) {
  return (
    <div className="c-table-region" role="region" aria-label={caption} tabIndex={0}>
      <table className="c-table">
        <caption className={captionHidden ? 'visually-hidden' : undefined}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={[c.numeric ? 'c-table__num' : '', c.wide ? 'c-table__wide' : ''].filter(Boolean).join(' ') || undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => {
                const className = [c.numeric ? 'c-table__num' : '', c.nowrap ? 'c-table__nowrap' : ''].filter(Boolean).join(' ') || undefined;
                return c.rowHeader ? (
                  <th key={c.key} scope="row" className={className}>
                    {c.cell(row)}
                  </th>
                ) : (
                  <td key={c.key} className={className}>
                    {c.cell(row)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Keyset ("load more") pagination matching the API's signed cursors: there are no page
 * numbers or totals, because the API does not provide them (no invented counts).
 */
export function LoadMore({ shown, hasMore, busy, onLoadMore }: { shown: number; hasMore: boolean; busy: boolean; onLoadMore: () => void }) {
  return (
    <div className="c-pagination">
      <span role="status">{hasMore ? `معروض ${shown} — توجد نتائج أخرى` : `معروض ${shown} — نهاية النتائج`}</span>
      {hasMore ? (
        <Button variant="secondary" size="small" busy={busy} busyLabel="جارٍ التحميل…" onClick={onLoadMore}>
          عرض المزيد
        </Button>
      ) : null}
    </div>
  );
}
