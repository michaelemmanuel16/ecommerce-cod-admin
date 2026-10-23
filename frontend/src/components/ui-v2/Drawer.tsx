import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { Portal } from './Portal';
import { useLayer } from './useLayer';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Footer row (.sf), usually buttons. */
  footer?: ReactNode;
  /** Sits between the title and the Close button (the order drawer's payment tag and Edit button). */
  headerExtra?: ReactNode;
  /** The wider sheet (640px) of the order details drawer. */
  wide?: boolean;
}

/**
 * The right-hand sheet (.sheet, 560px, full width under 760px) with its scrim.
 * It stays mounted so the slide transition runs; while closed it is aria-hidden and visibility:hidden.
 * Escape and the scrim close it; focus moves in on open and returns to the opener on close.
 */
export function Drawer({ open, onClose, title, description, children, footer, headerExtra, wide }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Closed content must not be reachable by Tab. Declared before useLayer so inert is gone when focus moves in.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open) node.removeAttribute('inert');
    else node.setAttribute('inert', '');
  }, [open]);
  useLayer(open, ref, onClose);

  return (
    <Portal>
      <div className={open ? 'scrim on' : 'scrim'} onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        className={['sheet', wide && 'wide', open && 'on'].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!open}
        tabIndex={-1}
      >
        <div className="sh">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {headerExtra}
          <Button size="icon-sm" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="sb">{children}</div>
        {footer && <div className="sf">{footer}</div>}
      </div>
    </Portal>
  );
}
