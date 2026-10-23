import { cloneElement, useEffect, useId, useState, type ReactElement } from 'react';

interface TooltipProps {
  label: string;
  /** One focusable element. It gets aria-describedby. */
  children: ReactElement;
}

/** Shows on hover and on keyboard focus; Escape hides it. No mockup counterpart: the ink pill of .agentbtn / .sample. */
export function Tooltip({ label, children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span
      className="tip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <span id={id} role="tooltip" className="tip-bubble" hidden={!open}>
        {label}
      </span>
    </span>
  );
}
