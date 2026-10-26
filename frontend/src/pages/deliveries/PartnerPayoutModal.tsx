import { useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, Select, Table, useToast, type Column } from '../../components/ui-v2';
import { partnerSettlementsService, type ManualPayoutPreview, type ManualPreviewOrder } from '../../services/partner-settlements.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency, todayYmd } from '../../utils/format';
import { toCents } from '../../utils/money';

// The server keeps no method column for a manual payout: the choice is written into the notes of the settlement.
const METHODS = ['Mobile Money', 'Bank Transfer', 'Cash'];
const PREVIEW_DELAY_MS = 300;

interface PartnerPayoutModalProps {
  partnerId: number;
  partnerName: string;
  onClose: () => void;
  /** A payout was saved: the page reloads the data it shows. */
  onRecorded: () => void;
}

const COLUMNS: Column<ManualPreviewOrder>[] = [
  { key: 'order', header: 'Order', render: (o) => `#${o.orderId}` },
  { key: 'applied', header: 'Paid now', right: true, render: (o) => formatCurrency(o.applied) },
  { key: 'result', header: 'Result', render: (o) => (o.clearsOrder ? 'Cleared' : 'Part paid') },
];

/**
 * "Record partner payout" (F-908, M5-T37). Money from a partner with no paid-order list: the amount clears the partner's
 * oldest unpaid orders first (FIFO). The order list is the server's own plan (POST .../manual/preview, asked again 300 ms
 * after the amount stops changing), so it is what Save does. An amount above the unpaid total says so before Save: the
 * excess is held as unapplied. A refusal from the server ("This reference was used on ...") shows in the form.
 * The page mounts it only for a user who holds payouts:create, and it is keyed by partner, so each opening starts clean.
 */
export function PartnerPayoutModal({ partnerId, partnerName, onClose, onRecorded }: PartnerPayoutModalProps) {
  const say = useToast();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(METHODS[0]);
  const [date, setDate] = useState(todayYmd());
  const [reference, setReference] = useState('');
  const [preview, setPreview] = useState<ManualPayoutPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const latest = useRef(0);

  const amountCents = toCents(amount);

  useEffect(() => {
    const ticket = ++latest.current;
    if (amountCents <= 0) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const plan = await partnerSettlementsService.previewManual(partnerId, amount.trim());
        if (ticket !== latest.current) return;
        setPreview(plan);
        setPreviewError(null);
      } catch (e) {
        if (ticket !== latest.current) return;
        setPreview(null);
        setPreviewError(apiErrorMessage(e, 'The preview could not load.'));
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [partnerId, amount, amountCents]);

  const blocked = amountCents <= 0 ? 'Enter an amount above zero' : reference.trim() === '' ? 'Enter the reference or receipt number' : null;
  const unapplied = preview && toCents(preview.unappliedAmount) > 0 ? preview.unappliedAmount : null;

  const save = async () => {
    if (blocked || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await partnerSettlementsService.recordManual({
        partnerId,
        amount: amount.trim(),
        reference: reference.trim(),
        payoutDate: date,
        notes: `Paid by ${method}`,
      });
      const held = toCents(saved.unappliedAmount) > 0 ? ` ${formatCurrency(saved.unappliedAmount)} is held as unapplied.` : '';
      say(`Payout recorded.${held}`);
      onRecorded();
      onClose();
    } catch (e) {
      setSaving(false);
      setSaveError(apiErrorMessage(e, 'The payout could not be saved.'));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Record partner payout: ${partnerName}`}
      description="Matched to the oldest unpaid orders first."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!!blocked || saving} onClick={() => void save()}>Record payout</Button>
        </>
      }
    >
      <form className="cform" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Input label="Amount" type="number" min="0" step="0.01" inputMode="decimal" value={amount} autoComplete="off" onChange={(e) => { setAmount(e.target.value); setSaveError(null); }} />
        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
        <Input label="Reference or receipt" value={reference} autoComplete="off" onChange={(e) => { setReference(e.target.value); setSaveError(null); }} />
        <button type="submit" hidden />
      </form>

      {previewError && <p role="alert" className="ppay-err">{previewError}</p>}
      {preview && (
        <section className="ppay-plan" aria-label="Orders this payout pays">
          <p className="mut">
            Unpaid now {formatCurrency(preview.unpaidTotal)}. This pays {formatCurrency(preview.appliedAmount)}. Left unpaid {formatCurrency(preview.leftUnpaid)}.
          </p>
          {unapplied !== null && <p role="status" className="ppay-warn" data-testid="unapplied-warning">{formatCurrency(unapplied)} will be held as unapplied</p>}
          {preview.orders.length === 0 ? (
            <p className="mut">{partnerName} has no unpaid orders to clear.</p>
          ) : (
            <Table label="Orders this payout pays" columns={COLUMNS} rows={preview.orders} rowKey={(o) => o.orderId} />
          )}
        </section>
      )}
      {blocked && <p className="mut ppay-gap" data-testid="blocked-reason">{blocked}</p>}
      {saveError && <p role="alert" className="ppay-err">{saveError}</p>}
    </Modal>
  );
}
