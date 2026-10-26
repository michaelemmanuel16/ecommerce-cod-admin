import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { Portal } from './Portal';
import { useLayer } from './useLayer';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Footer row (.mf), usually buttons. */
  footer?: ReactNode;
  /** Width: md 520px (default), lg 640px, xl 820px, wide 1120px (the transfer history). */
  size?: 'md' | 'lg' | 'xl' | 'wide';
}

/** The first field or control of the body, so a dialog opens with focus there and not on the Close button. */
const FIELD = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])';

/** The dialog (.mveil / .dlg). Escape and a click on the veil close it; focus returns to the opener. */
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLElement | null>(null);
  const titleId = useId();
  // Runs before useLayer's effect, which focuses `first` when there is one
  useLayoutEffect(() => {
    first.current = open ? bodyRef.current?.querySelector<HTMLElement>(FIELD) ?? null : null;
  }, [open]);
  useLayer(open, ref, onClose, first);
  if (!open) return null;

  return (
    <Portal>
      <div className="mveil" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} className={size === 'md' ? 'dlg' : `dlg ${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <div className="mh">
            <div>
              <h3 id={titleId}>{title}</h3>
              {description && <p>{description}</p>}
            </div>
            <Button size="icon-sm" aria-label="Close" onClick={onClose}>
              <X />
            </Button>
          </div>
          <div className="mb" ref={bodyRef}>{children}</div>
          {footer && <div className="mf">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}
