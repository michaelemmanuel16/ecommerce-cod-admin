import React, { useState } from 'react';
import { Modal, Button } from '../../ui-v2';
import { MetaPickAccount } from '../../../services/metaAds.service';

interface MetaAdsPickerModalProps {
  accounts: MetaPickAccount[];
  onSave: (accountIds: string[]) => void;
  onClose: () => void;
  saving?: boolean;
}

export const MetaAdsPickerModal: React.FC<MetaAdsPickerModalProps> = ({ accounts, onSave, onClose, saving = false }) => {
  // Accounts that are already connected start ticked (saving them again is how Reconnect gives them a new token).
  const [selected, setSelected] = useState<string[]>(() =>
    accounts.length === 1 ? [accounts[0].id] : accounts.filter((a) => a.alreadyConnected).map((a) => a.id),
  );

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Modal
      open
      onClose={onClose}
      title="Choose ad accounts"
      description="CodAdmin will read the spend of the accounts you tick."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(selected)} disabled={saving || selected.length === 0}>
            {saving ? 'Saving...' : 'Save accounts'}
          </Button>
        </>
      }
    >
      {accounts.length === 0 ? (
        <p style={{ color: 'var(--ink-2)', fontSize: 13 }}>No ad accounts found on this Meta login.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
          {accounts.map((a) => (
            <label
              key={a.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: 12, cursor: 'pointer',
                border: `1px solid ${selected.includes(a.id) ? 'var(--pine)' : 'var(--line)'}`,
                borderRadius: 12, background: selected.includes(a.id) ? 'var(--pine-soft)' : 'transparent',
              }}
            >
              <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: 'block', fontSize: 14 }}>{a.name}</b>
                <small style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                  act_{a.id.replace(/^act_/, '')} · {a.currency}
                  {a.alreadyConnected && ' · Already connected'}
                </small>
              </span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
};
