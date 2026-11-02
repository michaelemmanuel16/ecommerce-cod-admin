import { useState } from 'react';
import { Button, Input, Modal, Select } from '../../components/ui-v2';
import { rolesService, type RoleCard } from '../../services/roles.service';
import { apiMessage } from '../orders/importText';

interface NewRoleModalProps {
  /** The roles to copy the tools from. */
  roles: RoleCard[];
  onClose: () => void;
  onCreated: (role: RoleCard) => void;
}

/** New role (F-1156), from the New role modal of docs/mockups/v2/staff.html: a name, one line on what it does, and the role whose tools it starts with. */
export function NewRoleModal({ roles, onClose, onCreated }: NewRoleModalProps) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [from, setFrom] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) { setError('Enter a name for the role'); return; }
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await rolesService.create({ name: name.trim(), ...(purpose.trim() && { purpose: purpose.trim() }), ...(from && { copyToolsFromRoleId: Number(from) }) }));
    } catch (err) {
      setError(await apiMessage(err, 'The role could not be created.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open onClose={onClose} title="New role"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => void create()}>Create role</Button></>}
    >
      <Input label="Role name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Customer support" error={error} />
      <Input label="What the role does" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="One line" optional />
      <Select label="Start with the tools of" value={from} onChange={(e) => setFrom(e.target.value)} hint="You can switch each tool on or off after the role is created.">
        <option value="">No tools</option>
        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </Select>
    </Modal>
  );
}
