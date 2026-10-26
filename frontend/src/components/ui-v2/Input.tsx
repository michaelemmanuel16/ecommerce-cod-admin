import { useId, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** A bare input for a table cell: no field wrapper, the label becomes the aria-label (like Select `compact`). */
  compact?: boolean;
  /** Shows "(optional)" after the label. */
  optional?: boolean;
  hint?: string;
  /** Error text under the field. Sets aria-invalid. */
  error?: string;
}

/** .fl field: label, input, hint or error. */
export function Input({ label, compact, optional, hint, error, id, className, ...rest }: InputProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const noteId = `${fieldId}-note`;
  if (compact) return <input id={fieldId} aria-label={label} className={clsx('tcell', className)} {...rest} />;
  return (
    <div className={clsx('fl', className)}>
      <label htmlFor={fieldId}>
        {label} {optional && <span className="opt">(optional)</span>}
      </label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? noteId : undefined}
        {...rest}
      />
      {error ? (
        <p id={noteId} className="err">
          {error}
        </p>
      ) : (
        hint && (
          <p id={noteId} className="hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
