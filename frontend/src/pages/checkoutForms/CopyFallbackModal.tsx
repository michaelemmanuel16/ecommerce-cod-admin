import { useEffect, useRef } from 'react';
import { Button, Modal } from '../../components/ui-v2';

/** Shown when the browser refuses to write to the clipboard: the text sits in a selectable box to copy by hand. */
export function CopyFallbackModal({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    box.current?.focus();
    box.current?.select();
  }, []);

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description="Your browser did not allow copying. Select the text below and copy it."
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
    >
      <div className="fl">
        <textarea ref={box} readOnly rows={4} aria-label="Text to copy" value={text} onFocus={(e) => e.currentTarget.select()} />
      </div>
    </Modal>
  );
}
