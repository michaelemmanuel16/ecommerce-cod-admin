import { useState } from 'react';
import { Button, Input, Modal, Select } from '../../components/ui-v2';
import { inventoryService, type DisputeReason, type Transfer } from '../../services/inventory.service';
import { apiErrorMessage } from '../../utils/apiError';
import { canReturnToSource, DISPUTE_REASONS, REASON_LABEL } from './model';
import { count } from '../deliveries/model';

interface DialogProps {
  /** The page mounts a dialog only while it has a transfer, and keys it by the transfer id, so the fields start fresh each time. */
  transfer: Transfer;
  onClose: () => void;
  /** Saved: the page shows `message` and refreshes. */
  onDone: (message: string) => void;
}

/**
 * "Confirm received" for a 3PL or own store (M4-T28, F-654). The count defaults to everything sent; a lower count asks for
 * a reason and leaves the missing units open as a dispute. More than was sent is refused by the API, and here by the field.
 */
export function ReceiveDialog({ transfer, onClose, onDone }: DialogProps) {
  const [counted, setCounted] = useState(String(transfer.quantity));
  const [reason, setReason] = useState<DisputeReason | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sent = transfer.quantity;
  const n = counted.trim() === '' ? null : Number(counted);
  const valid = n !== null && Number.isInteger(n) && n >= 0 && n <= sent;
  const short = valid && n < sent;
  const fieldError = n !== null && n > sent ? `Only ${count(sent)} were sent` : n !== null && (!Number.isInteger(n) || n < 0) ? 'Use a whole number, 0 or more' : undefined;
  const ready = valid && (!short || reason !== '');
  const where = transfer.toLocation?.name ?? 'the location';

  const save = async () => {
    if (!ready || n === null) return;
    setSaving(true);
    setError(null);
    try {
      await inventoryService.receive(transfer.id, { quantity: n, ...(short && reason !== '' && { reason }) });
      onDone(short
        ? `${where} received ${count(n)} of ${count(sent)} ${transfer.product.name}. ${count(sent - n)} short: resolve it when you know what happened.`
        : `${where} received ${count(sent)} ${transfer.product.name}.`);
    } catch (e) {
      setSaving(false);
      setError(apiErrorMessage(e, 'The receipt could not be saved.'));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Confirm received"
      description={`${transfer.product.name}, ${count(sent)} sent from ${transfer.fromLocation?.name ?? 'the source'} to ${where}.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ready || saving} onClick={() => void save()}>Confirm received</Button>
        </>
      }
    >
      <form noValidate className="stockform" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Input label="Counted on arrival" type="number" min={0} max={sent} value={counted} error={fieldError} hint={`${count(sent)} were sent.`} onChange={(e) => setCounted(e.target.value)} />
        {short && (
          <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value as DisputeReason)} hint="The missing units stay open until you resolve them.">
            <option value="">Pick a reason</option>
            {DISPUTE_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
          </Select>
        )}
        {error && <p className="err" role="alert">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/**
 * Resolve a dispute (M4-T28, F-654): put the short units back at the source, or write them off. A return that a 3PL says it
 * sent but that never arrived cannot go back to the 3PL, so only the write-off is offered for it.
 */
export function ResolveDialog({ transfer, onClose, onDone }: DialogProps) {
  const back = canReturnToSource(transfer);
  const [action, setAction] = useState<'return_to_source' | 'write_off'>(back ? 'return_to_source' : 'write_off');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const short = transfer.shortQuantity;
  const source = transfer.fromLocation?.name ?? 'the source';

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await inventoryService.resolve(transfer.id, { action, ...(note.trim() && { note: note.trim() }) });
      onDone(action === 'return_to_source'
        ? `${count(short)} ${transfer.product.name} went back to ${source}.`
        : `${count(short)} ${transfer.product.name} written off.`);
    } catch (e) {
      setSaving(false);
      setError(apiErrorMessage(e, 'The dispute could not be resolved.'));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Resolve the shortage"
      description={`${count(short)} of ${count(transfer.quantity)} ${transfer.product.name} did not arrive at ${transfer.toLocation?.name ?? 'the location'}.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>Resolve</Button>
        </>
      }
    >
      <form noValidate className="stockform" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <fieldset className="choices">
          <legend className="sr-only">What happens to the short units</legend>
          <label className={back ? undefined : 'off'}>
            <input type="radio" name="resolve" checked={action === 'return_to_source'} disabled={!back} onChange={() => setAction('return_to_source')} />
            <span><b>Return to source</b><small>{back ? `Put the ${count(short)} units back at ${source}.` : 'Not offered: units a 3PL says it sent back never arrived, so they are not there to put back.'}</small></span>
          </label>
          <label>
            <input type="radio" name="resolve" checked={action === 'write_off'} onChange={() => setAction('write_off')} />
            <span><b>Write off</b><small>Record the {count(short)} units as lost. The cost is logged as a finding.</small></span>
          </label>
        </fieldset>
        <Input label="Note" optional value={note} placeholder="What you found out" onChange={(e) => setNote(e.target.value)} />
        {error && <p className="err" role="alert">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
