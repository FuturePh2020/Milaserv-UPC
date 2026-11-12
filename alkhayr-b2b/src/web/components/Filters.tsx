import { useId, type FormEvent, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';

/** Search box: a labelled search input (Enter submits). Search runs on the server. */
export function SearchInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  const id = useId();
  return (
    <div className="c-field">
      <label className="c-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="c-search">
        <span className="c-search__icon">
          <Icon name="search" />
        </span>
        <input id={id} type="search" className="c-input" value={value} maxLength={80} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

/** Filter bar: a real <form role="search">; applying filters is an explicit action. */
export function FilterBar({ label, onSubmit, children, actions }: { label: string; onSubmit: () => void; children: ReactNode; actions?: ReactNode }) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form className="c-filter-bar" role="search" aria-label={label} onSubmit={submit}>
      {children}
      <div className="cluster">{actions}</div>
    </form>
  );
}
