import { Button, Modal } from '../../components/ui-v2';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

/** The invite was saved but could not be sent (no provider set up, or it refused): the link shows once, to copy and send by hand. */
export function InviteLinkDialog({ name, reason, link, onClose }: { name: string; reason?: string; link: string; onClose: () => void }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <Modal
      open onClose={onClose} title="Invite saved, not sent"
      description={`${reason ?? 'The invite could not be sent.'} Copy this link and send it to ${name} yourself. It is shown only once.`}
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" onClick={() => void copy(link)}>{copied ? 'Copied' : 'Copy link'}</Button></>}
    >
      <input type="text" readOnly value={link} aria-label="Invite link" className="staff-link" onFocus={(e) => e.currentTarget.select()} />
    </Modal>
  );
}
