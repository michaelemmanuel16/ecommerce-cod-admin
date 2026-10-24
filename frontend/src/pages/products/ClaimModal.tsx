import { useState } from 'react';
import { Button, Input, Modal, useToast } from '../../components/ui-v2';
import { shipmentsService, type Shipment } from '../../services/shipments.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency } from '../../utils/format';
import { parseMoney } from '../../utils/money';

interface ClaimModalProps {
  /** The received shipment. The modal is mounted only while it is open, one per shipment. */
  shipment: Shipment;
  onClose: () => void;
  onChanged: (shipment: Shipment) => void;
}

/**
 * Supplier claim for the units that arrived short (M4-T24, F-608). Open: settle with the amount recovered (one ledger entry,
 * DR 1010 Cash in hand / CR 1200 Inventory) or write it off (no entry: the loss is already in the landed cost per unit).
 * Settled and written off claims are read only.
 */
export function ClaimModal({ shipment, onClose, onChanged }: ClaimModalProps) {
  const say = useToast();
  const [recovered, setRecovered] = useState(String(shipment.claimAmount));
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'settle' | 'write_off'>('settle');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cur = shipment.storeCurrency;
  const amount = Number(recovered);
  const claim = shipment.claimAmount;

  const run = async () => {
    setError(null);
    if (mode === 'settle' && !(amount > 0 && amount <= claim)) {
      setError(`Amount recovered must be above 0 and not above ${formatCurrency(claim, cur)}`);
      return;
    }
    setSaving(true);
    try {
      const done = await shipmentsService.claim(shipment.id, mode === 'settle' ? { action: 'settle', amountRecovered: amount } : { action: 'write_off', ...(note.trim() ? { note: note.trim() } : {}) });
      say(mode === 'settle' ? 'Claim settled' : 'Claim written off');
      onChanged(done);
    } catch (e) {
      setSaving(false);
      setError(apiErrorMessage(e, 'The claim could not be saved.'));
    }
  };

  const isOpen = shipment.claimStatus === 'open';
  return (
    <Modal
      open
      onClose={onClose}
      title="Supplier claim"
      description={`${shipment.product.name} · ${shipment.supplier ?? 'No supplier'}`}
      footer={
        isOpen ? (
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" disabled={saving} onClick={() => void run()}>{mode === 'settle' ? 'Settle claim' : 'Write off'}</Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="pform">
        <div className="claim">
          <div className="row">
            <span>{shipment.shortQuantity} short of {shipment.quantity} shipped</span>
            <b className="num" data-testid="claim-amount">{formatCurrency(claim, cur)}</b>
          </div>
          <p>The claim is the short units at the supplier&rsquo;s unit cost.</p>
        </div>

        {shipment.claimStatus === 'settled' && (
          <div className="claim">
            <p><b>Settled.</b> {formatCurrency(parseMoney(shipment.claimRecovered), cur)} recovered. Ledger entry #{shipment.claimJournalEntryId}: DR 1010 Cash in hand, CR 1200 Inventory.</p>
          </div>
        )}
        {shipment.claimStatus === 'written_off' && (
          <div className="claim">
            <p><b>Written off.</b> {shipment.claimNote ? `${shipment.claimNote}. ` : ''}No ledger entry was posted: the loss is already in the landed cost per unit.</p>
          </div>
        )}

        {isOpen && (
          <>
            <div className="seg" role="group" aria-label="What happened to the claim">
              <button type="button" className={mode === 'settle' ? 'on' : ''} aria-pressed={mode === 'settle'} onClick={() => setMode('settle')}>Supplier paid</button>
              <button type="button" className={mode === 'write_off' ? 'on' : ''} aria-pressed={mode === 'write_off'} onClick={() => setMode('write_off')}>Write off</button>
            </div>
            {mode === 'settle' ? (
              <>
                <Input label={`Amount recovered (${cur})`} type="number" step="0.01" min={0} value={recovered} onChange={(e) => { setRecovered(e.target.value); setError(null); }} />
                <div className="ledger" data-testid="ledger-preview">
                  Posts one ledger entry for {formatCurrency(Number.isFinite(amount) ? amount : 0, cur)}: DR 1010 Cash in hand, CR 1200 Inventory.
                </div>
              </>
            ) : (
              <>
                <div className="fl">
                  <label htmlFor="cl-note">Note <span className="opt">(optional)</span></label>
                  <textarea id="cl-note" placeholder="For example: supplier refused" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <div className="ledger" data-testid="ledger-preview">No ledger entry is posted. The loss is already in the landed cost per unit.</div>
              </>
            )}
          </>
        )}
        {error && <p className="err" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
