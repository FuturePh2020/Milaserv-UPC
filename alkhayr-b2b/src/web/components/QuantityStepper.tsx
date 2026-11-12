import { useId } from 'react';
import { formatCartons } from '../format.ts';
import { IconButton } from './Button.tsx';

/**
 * Whole-carton quantity control. Typing is allowed (digits only); +/- step by one carton.
 * `value` is null while the field is empty or invalid, so the caller cannot submit it.
 * Minimum/maximum are presentation hints; the server re-validates every quantity.
 */
export function QuantityStepper({
  label = 'عدد الكراتين',
  labelSuffix,
  value,
  text,
  onChange,
  min,
  max = 100_000,
  disabled = false,
  error,
}: {
  label?: string;
  /** Extra label text for assistive technology only (e.g. the product name in a cart line). */
  labelSuffix?: string;
  value: number | null;
  /** Raw text as typed (so partially typed input is not lost). */
  text: string;
  onChange: (next: { value: number | null; text: string }) => void;
  min: number;
  max?: number;
  disabled?: boolean;
  error?: string | null;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const set = (n: number) => {
    const clamped = Math.min(max, Math.max(min, n));
    onChange({ value: clamped, text: String(clamped) });
  };
  const parse = (raw: string) => {
    const digits = raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).trim();
    const n = /^\d{1,6}$/.test(digits) ? Number(digits) : NaN;
    onChange({ value: Number.isSafeInteger(n) && n >= min && n <= max ? n : null, text: raw });
  };
  const invalid = Boolean(error) || (text !== '' && value === null);
  return (
    <div className="c-field">
      <label className="c-field__label" htmlFor={id}>
        {label}
        {labelSuffix ? <span className="visually-hidden"> — {labelSuffix}</span> : null}
      </label>
      <div className="c-qty" data-invalid={invalid || undefined}>
        <IconButton icon="minus" label="إنقاص كرتونة" disabled={disabled || value === null || value <= min} onClick={() => value !== null && set(value - 1)} />
        <input
          id={id}
          className="c-qty__input"
          inputMode="numeric"
          dir="ltr"
          value={text}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={`${hintId}${invalid ? ` ${errorId}` : ''}`}
          onChange={(e) => parse(e.target.value)}
        />
        <IconButton icon="plus" label="زيادة كرتونة" disabled={disabled || (value !== null && value >= max)} onClick={() => set(value === null ? min : value + 1)} />
      </div>
      <span id={hintId} className="c-field__hint">
        أقل كمية: {formatCartons(min)}
      </span>
      {invalid ? (
        <span id={errorId} className="c-field__error">
          {error ?? `أدخل عددًا صحيحًا من الكراتين لا يقل عن ${min}.`}
        </span>
      ) : null}
    </div>
  );
}
