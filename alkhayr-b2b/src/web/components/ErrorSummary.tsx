import { useEffect, useRef } from 'react';

export interface SummaryItem {
  /** id of the field to focus when the item is activated */
  fieldId?: string;
  message: string;
}

/**
 * Error summary shown above a form after a failed submission. It receives focus when it appears
 * (so keyboard and screen-reader users land on it) and each item links to its field.
 * `version` changes on every submission so a repeated error is focused again.
 */
export function ErrorSummary({ title, items, version }: { title: string; items: SummaryItem[]; version: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (items.length > 0) ref.current?.focus();
  }, [version, items.length]);
  if (items.length === 0) return null;
  return (
    <div ref={ref} className="c-form-errors" role="alert" tabIndex={-1}>
      <strong>{title}</strong>
      <ul>
        {items.map((item, i) => (
          <li key={i}>
            {item.fieldId ? (
              <a
                href={`#${item.fieldId}`}
                onClick={(e) => {
                  e.preventDefault(); // hash routing: focus the field without changing the route
                  document.getElementById(item.fieldId!)?.focus();
                }}
              >
                {item.message}
              </a>
            ) : (
              item.message
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
