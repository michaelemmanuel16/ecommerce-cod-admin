import { useId, useRef, type ReactNode } from 'react';
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
  /** The wide dialog (.dlg.wide, 1120px) of the transfer history. */
  wide?: boolean;
}

/** The dialog (.mveil / .dlg, 520px). Escape and a click on the veil close it; focus returns to the opener. */
export function Modal({ open, onClose, title, description, children, footer, wide }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useLayer(open, ref, onClose);
  if (!open) return null;

  return (
    <Portal>
      <div className="mveil" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} className={wide ? 'dlg wide' : 'dlg'} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <div className="mh">
            <div>
              <h3 id={titleId}>{title}</h3>
              {description && <p>{description}</p>}
            </div>
            <Button size="icon-sm" aria-label="Close" onClick={onClose}>
              <X />
            </Button>
          </div>
          <div className="mb">{children}</div>
          {footer && <div className="mf">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}
