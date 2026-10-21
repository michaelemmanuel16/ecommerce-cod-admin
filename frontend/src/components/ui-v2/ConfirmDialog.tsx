import { useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { Portal } from './Portal';
import { useLayer } from './useLayer';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** The verb on the danger button and in the title, for example "Delete". */
  action: string;
  count: number;
  /** What is acted on, singular ("order"). */
  noun: string;
  /** Plural form; defaults to noun + "s". */
  plural?: string;
  /** One plain sentence under the title. */
  children?: ReactNode;
}

/**
 * The one confirm dialog (F-111, F-328): title "Delete 3 orders?", a plain sentence, Cancel and a red action button.
 * Look = the confirm dialog in docs/mockups/v2/shell.js (.sx-veil / .sx-modal). Escape and a click on the veil cancel.
 * Focus starts on Cancel so a stray Enter never deletes; it returns to the opener on close.
 */
export function ConfirmDialog({ open, onClose, onConfirm, action, count, noun, plural, children }: ConfirmDialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useLayer(open, ref, onClose, cancel);
  if (!open) return null;

  const what = count === 1 ? noun : (plural ?? `${noun}s`);
  return (
    <Portal>
      <div className="sx-veil" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} className="sx-modal" role="alertdialog" aria-modal="true" aria-label="Confirm" tabIndex={-1}>
          <h3>{`${action} ${count.toLocaleString('en-GB')} ${what}?`}</h3>
          <p>{children ?? 'You cannot undo this.'}</p>
          <div className="sx-act">
            <button ref={cancel} type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <Button variant="danger" onClick={onConfirm}>
              {action}
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
