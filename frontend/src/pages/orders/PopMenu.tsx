import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { FloatingMenu } from './FloatingMenu';

interface PopMenuProps {
  label: string;
  icon: ReactNode;
  className?: string;
  /** The menu body. Call `close` after an item is chosen. */
  children: (close: () => void) => ReactNode;
}

/**
 * A button with a menu under it, used by the bulk bar. The menu is a FloatingMenu: a long list (every call rep)
 * scrolls inside it and stays on the screen; it closes itself on an outside click, Escape, a scroll outside it and a resize.
 */
export function PopMenu({ label, icon, className, children }: PopMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="mwrap">
      <button ref={triggerRef} type="button" className={`btn${className ? ` ${className}` : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon}
        {label}
        <ChevronDown style={{ width: 15, height: 15 }} />
      </button>
      {open && triggerRef.current && (
        <FloatingMenu anchor={triggerRef.current} label={label} align="left" onClose={close}>
          {children(close)}
        </FloatingMenu>
      )}
    </div>
  );
}
