import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { ApiFieldError } from '../../shared/errors.ts';
import { IconButton } from './Button.tsx';
import { Icon } from './Icon.tsx';

/**
 * Field wrapper: visible label, optional hint and error, all linked to the control with
 * aria-describedby / aria-invalid. The render prop receives the ids to apply.
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: (control: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true; required?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="c-field">
      <label className="c-field__label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children({ id, ...(describedBy ? { 'aria-describedby': describedBy } : {}), ...(error ? { 'aria-invalid': true as const } : {}), ...(required ? { required } : {}) })}
      {hint ? (
        <span id={hintId} className="c-field__hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="c-field__error">
          <Icon name="alert" />
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function TextInput({ ltr = false, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { ltr?: boolean }) {
  return <input {...rest} className={['c-input', ltr ? 'c-input--ltr' : '', className ?? ''].filter(Boolean).join(' ')} {...(ltr ? { dir: 'ltr' } : {})} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={['c-textarea', className ?? ''].filter(Boolean).join(' ')} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={['c-select', className ?? ''].filter(Boolean).join(' ')}>
      {children}
    </select>
  );
}

/**
 * Password input with a show/hide toggle. Values are never stored or logged; autocomplete
 * hints let password managers work ("current-password" / "new-password").
 */
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement> & { autoComplete: 'current-password' | 'new-password' }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="c-password">
      <input {...props} type={visible ? 'text' : 'password'} className="c-input c-input--ltr" dir="ltr" spellCheck={false} autoCapitalize="off" />
      <IconButton className="c-password__toggle" icon={visible ? 'eyeOff' : 'eye'} label={visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} aria-pressed={visible} onClick={() => setVisible((v) => !v)} />
    </div>
  );
}

/** Six-digit authenticator code (administrators). One field, numeric keyboard, OTP autofill. */
export function OtpInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode' | 'maxLength'>) {
  return <input {...props} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} dir="ltr" className="c-input c-input--otp" spellCheck={false} />;
}

/** Summary of server validation errors (role=alert so it is announced once when shown). */
export function FormErrors({ title = 'تعذّر حفظ البيانات. راجع الحقول التالية:', fields }: { title?: string; fields: ApiFieldError[] }) {
  if (fields.length === 0) return null;
  return (
    <div className="c-form-errors" role="alert">
      <strong>{title}</strong>
      <ul>
        {fields.map((f, i) => (
          <li key={`${f.path}-${i}`}>{f.message}</li>
        ))}
      </ul>
    </div>
  );
}
