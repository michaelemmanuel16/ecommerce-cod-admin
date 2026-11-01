import { useState } from 'react';
import { Button, Modal, Select } from '../../components/ui-v2';
import type { StaffRow } from '../../services/staff.service';

interface DeactivateDialogProps {
  row: StaffRow;
  openOrders: number;
  /** Active people who can take the orders: the same kind of role, not the person. */
  takers: StaffRow[];
  busy: boolean;
  onClose: () => void;
  /** `takerId` null: leave the orders where they are. */
  onConfirm: (takerId: number | null) => void;
}

/** Deactivating a person who has open orders asks who takes them (F-1160). Without open orders the page uses the plain confirm. */
export function DeactivateDialog({ row, openOrders, takers, busy, onClose, onConfirm }: DeactivateDialogProps) {
  const [taker, setTaker] = useState('');
  return (
    <Modal
      open onClose={onClose} title={`Deactivate ${row.name}?`}
      description={`${row.name} has ${openOrders} open order${openOrders === 1 ? '' : 's'}. They are signed out at once and cannot sign in.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => onConfirm(taker ? Number(taker) : null)}>Deactivate</Button></>}
    >
      <Select label="Who takes their open orders?" value={taker} onChange={(e) => setTaker(e.target.value)} hint="Choose nobody to leave the orders with them for now.">
        <option value="">Nobody, leave them as they are</option>
        {takers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </Select>
    </Modal>
  );
}
