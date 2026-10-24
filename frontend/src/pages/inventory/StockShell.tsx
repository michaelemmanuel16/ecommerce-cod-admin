import type { ReactNode } from 'react';
import { Button, Modal } from '../../components/ui-v2';
import { ACTION_META, type ModalKind } from './model';

interface StockShellProps {
  kind: ModalKind;
  description: string;
  ready: boolean;
  saving: boolean;
  error: string | null;
  note: string;
  onNote: (note: string) => void;
  notePlaceholder: string;
  /** "Needed for Other": the note label says so. */
  noteRequired?: boolean;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
}

/** What the four stock modals share: the dialog, the note box, the error line and the Cancel / save footer. */
export function StockShell({ kind, description, ready, saving, error, note, onNote, notePlaceholder, noteRequired, onClose, onSave, children }: StockShellProps) {
  const { label, Icon } = ACTION_META[kind];
  return (
    <Modal
      open
      onClose={onClose}
      title={label}
      description={description}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ready || saving} onClick={onSave}><Icon />{label}</Button>
        </>
      }
    >
      <form noValidate className="stockform" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
        {children}
        <div className="fl">
          <label htmlFor="stock-note">Note <span className="opt">{noteRequired ? '(required for Other)' : '(optional)'}</span></label>
          <textarea id="stock-note" value={note} placeholder={notePlaceholder} onChange={(e) => onNote(e.target.value)} />
        </div>
        {error && <p className="err" role="alert">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
