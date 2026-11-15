import { useId, type TextareaHTMLAttributes } from 'react';

interface AreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

/** A labelled text area in the same .fl field as the Input and Select of the design system. */
export function Area({ label, hint, error, id, ...rest }: AreaProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className="fl">
      <label htmlFor={fieldId}>{label}</label>
      <textarea id={fieldId} aria-invalid={error ? true : undefined} rows={3} {...rest} />
      {error ? <p className="err">{error}</p> : hint && <p className="hint">{hint}</p>}
    </div>
  );
}
