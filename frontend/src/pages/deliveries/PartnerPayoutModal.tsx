import { useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, Select, Table, useToast, type Column } from '../../components/ui-v2';
import { partnerSettlementsService, type ManualPayoutPreview, type ManualPreviewOrder } from '../../services/partner-settlements.service';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency, todayYmd } from '../../utils/format';
import { toCents } from '../../utils/money';

interface PartnerPayoutModalProps {
  /** The partner of the drawer. Leave out, with `partners`, to open from the Finance header with a "Paid by" select. */
  partnerId?: number;
  partnerName?: string;
  /** The "Paid by" choices of the Finance header. */
  partners?: Array<{ id: number; name: string }>;
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
 * "Record partner payout" (F-908, M5-T37): the amount clears the partner's oldest unpaid orders first; the order list is the server's own plan.
 * From the partner drawer the partner is fixed. From the Finance header (M5 Finance mockup) the person picks who paid.
 */
export function PartnerPayoutModal({ partnerId: fixedId, partnerName: fixedName, partners, onClose, onRecorded }: PartnerPayoutModalProps) {
  const say = useToast();
  const picking = fixedId === undefined;
  const [chosen, setChosen] = useState<number | null>(null);
  const partnerId = fixedId ?? chosen ?? 0;
  const partnerName = fixedName ?? partners?.find((p) => p.id === chosen)?.name ?? 'This partner';
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayYmd);
  const [reference, setReference] = useState('');
  const [preview, setPreview] = useState<ManualPayoutPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const latest = useRef(0);

  const amountCents = toCents(amount);
  // Keyed on whole cents, so "300", "300." and "300.0" send one request.
  const previewCents = useDebouncedValue(amountCents);

  useEffect(() => {
    const ticket = ++latest.current;
    if (previewCents <= 0 || partnerId <= 0) {
      setPreview(null);
      return;
    }
    partnerSettlementsService.previewManual(partnerId, (previewCents / 100).toFixed(2)).then(
      (plan) => {
        if (ticket !== latest.current) return;
        setPreview(plan);
        setError(null);
      },
      (e) => {
        if (ticket !== latest.current) return;
        setPreview(null);
        setError(apiErrorMessage(e, 'The preview could not load.'));
      },
    );
  }, [partnerId, previewCents]);

  const blocked = partnerId <= 0 ? 'Choose who paid' : amountCents <= 0 ? 'Enter an amount above zero' : reference.trim() === '' ? 'Enter the reference or receipt number' : null;
  const unapplied = preview && preview.unappliedAmount > 0 ? preview.unappliedAmount : null;

  const save = async () => {
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await partnerSettlementsService.recordManual({
        partnerId,
        amount: amount.trim(),
        reference: reference.trim(),
        payoutDate: date,
      });
      const held = saved.unappliedAmount > 0 ? ` ${formatCurrency(saved.unappliedAmount)} is held as unapplied.` : '';
      say(`Payout recorded.${held}`);
      onRecorded();
      onClose();
    } catch (e) {
      setSaving(false);
      setError(apiErrorMessage(e, 'The payout could not be saved.'));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={picking ? 'Record a payout from a partner' : `Record partner payout: ${partnerName}`}
      description={picking ? 'Money a delivery agent or 3PL paid you.' : 'Matched to the oldest unpaid orders first.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!!blocked || saving} onClick={() => void save()}>Record payout</Button>
        </>
      }
    >
      <form className="cform" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {picking && (
          <Select label="Paid by" value={chosen ?? ''} onChange={(e) => { setChosen(e.target.value ? Number(e.target.value) : null); setError(null); }}>
            <option value="">Choose a partner</option>
            {(partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
        <Input label="Amount" type="number" min="0" step="0.01" inputMode="decimal" value={amount} autoComplete="off" onChange={(e) => { setAmount(e.target.value); setError(null); }} />
        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label="Reference or receipt" value={reference} autoComplete="off" onChange={(e) => { setReference(e.target.value); setError(null); }} />
        <button type="submit" hidden />
      </form>
      <p className="ink3" style={{ fontSize: 12.5, marginTop: 12 }}>
        Expected cash is the cash collected minus the partner's fees. The amount you enter is matched to the oldest unpaid orders for this partner, net of their fees. Any gap opens a finding.
      </p>

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
      {error && <p className="err" role="alert">{error}</p>}
    </Modal>
  );
}
