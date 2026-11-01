import { useState } from 'react';
import { Button, Input, Modal } from '../../components/ui-v2';
import type { StaffRow } from '../../services/staff.service';

interface PermanentDeleteModalProps {
  row: StaffRow;
  busy: boolean;
  onClose: () => void;
  onConfirm: (typed: string) => void;
}

/** Permanent delete (F-1160): lists what goes and what stays, and needs the person's email typed. */
export function PermanentDeleteModal({ row, busy, onClose, onConfirm }: PermanentDeleteModalProps) {
  const [typed, setTyped] = useState('');
  const match = typed.trim().toLowerCase() === row.email.toLowerCase();
  return (
    <Modal
      open onClose={onClose} title="Delete 1 person for good?"
      description={`${row.name} will be erased. This cannot be undone.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!match || busy} onClick={() => onConfirm(typed)}>Delete for good</Button></>}
    >
      <ul className="staff-erase">
        <li>Removed: the account, the sign-ins and their notifications.</li>
        <li>Unlinked: their orders, deliveries and expenses stay, with no owner. Order history keeps the name.</li>
        <li>Kept: anyone with payouts or ledger records cannot be erased. They stay in the Deleted tab.</li>
      </ul>
      <Input label={`Type ${row.email} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
    </Modal>
  );
}
