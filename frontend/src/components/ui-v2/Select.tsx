import { useId, type SelectHTMLAttributes } from 'react';
import clsx from 'clsx';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Field label. With `compact` it becomes the aria-label. */
  label: string;
  /** The small filter select (.psel) used in toolbars, with no visible label. */
  compact?: boolean;
  hint?: string;
  error?: string;
}

/** Native select in the .fl field style, or the compact .psel filter. Children are <option>s. */
export function Select({ label, compact, hint, error, id, className, children, ...rest }: SelectProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const noteId = `${fieldId}-note`;

  if (compact) {
    return (
      <select id={fieldId} aria-label={label} className={clsx('psel', className)} {...rest}>
        {children}
      </select>
    );
  }
  return (
    <div className={clsx('fl', className)}>
      <label htmlFor={fieldId}>{label}</label>
      <select
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? noteId : undefined}
        {...rest}
      >
        {children}
      </select>
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
