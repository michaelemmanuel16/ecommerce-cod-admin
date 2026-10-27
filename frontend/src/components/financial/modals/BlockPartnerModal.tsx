import { useState } from 'react';
import { Button, Input, Modal, useToast } from '../../ui-v2';
import { collectionsService } from '../../../services/collections.service';
import { apiErrorMessage } from '../../../utils/apiError';

interface Props {
  partnerId: number;
  partnerName: string;
  onClose: () => void;
  onBlocked: () => void;
}

/** Block a partner (F-911): a reason is required. The partner gets no new orders; the deliveries it already has stay with it. */
export function BlockPartnerModal({ partnerId, partnerName, onClose, onBlocked }: Props) {
  const say = useToast();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = reason.trim() === '';

  const save = async () => {
    if (missing || saving) return;
    setSaving(true);
    setError(null);
    try {
      await collectionsService.block(partnerId, reason.trim());
      say(`${partnerName} blocked. Open deliveries stay with them.`);
      onBlocked();
      onClose();
    } catch (e) {
      setSaving(false);
      setError(apiErrorMessage(e, 'The partner could not be blocked.'));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Block ${partnerName}`}
      description="They get no new orders. Deliveries they already have stay with them."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={missing || saving} onClick={() => void save()}>Block partner</Button>
        </>
      }
    >
      <form noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Input label="Reason" value={reason} autoComplete="off" hint="Shown to the partner." onChange={(e) => { setReason(e.target.value); setError(null); }} />
        <button type="submit" hidden />
      </form>
      {error && <p className="err" role="alert">{error}</p>}
    </Modal>
  );
}
