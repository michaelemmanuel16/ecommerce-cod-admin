import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Input, Modal, Select } from '../ui-v2';
import { GuardedButtonV2 } from '../financial/GuardedButtonV2';
import { payoutsService, type CommissionKind, type OwedPreview, type PayoutRow } from '../../services/payouts.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency, formatDate, todayYmd } from '../../utils/format';
import { toCents } from '../../utils/money';

const KIND_LABEL: Record<CommissionKind, string> = { base: 'Commission', upsell: 'Upsell reward', reward: 'Target reward' };
// The mockup's words (the server takes any text). Not the deposit methods of the mobile collections page: those are snake_case values.
const PAYOUT_METHODS = ['MoMo', 'Bank transfer', 'Cash'];
/** The currency sign of the store ("GH₵"), for the Amount label. */
const currencySign = (): string => formatCurrency(0).replace(/[\d.,\s]/g, '');

interface PayoutFormProps {
  /** The person to pay. Finance passes a rep; Staff (M6) passes any person, with no other change. */
  personId: number;
  personName?: string;
  onClose: () => void;
  /** A payout was saved: the caller reloads its list. */
  onRecorded?: () => void;
}

/** Why Save is blocked, in the words the server uses where it has them; null when the form may be sent. The server still decides. */
function blockedReason(preview: OwedPreview, ticked: Set<number>, tickedCents: number, amount: string, method: string): string | null {
  if (toCents(preview.owed) <= 0) return 'Nothing is owed to this person';
  if (ticked.size === 0) return 'Tick at least one entry';
  if (toCents(amount) <= 0) return 'Enter an amount above zero';
  if (toCents(amount) > tickedCents) return `Owed is ${formatCurrency(tickedCents / 100)}`;
  if (method.trim() === '') return 'Pick a method';
  return null;
}

/**
 * The one payout form (F-913, F-1164, M5-T38). It reads the person's open entries from GET /api/payouts/owed/:id and pays
 * the ticked ones: the amount follows the ticks and may be lowered (the oldest entries are paid first). It has no delivery fee
 * line: the partner keeps that from the cash. Save is blocked when nothing is owed or the amount is above what is ticked, and a
 * refusal from the server ("Owed is GH₵2,034", "Already paid") shows in the form. History of the person's payouts is below.
 */
export const PayoutForm: React.FC<PayoutFormProps> = ({ personId, personName, onClose, onRecorded }) => {
  const [preview, setPreview] = useState<OwedPreview | null>(null);
  const [history, setHistory] = useState<PayoutRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [amountEdit, setAmountEdit] = useState<string | null>(null);
  const [method, setMethod] = useState(PAYOUT_METHODS[0]);
  const [date, setDate] = useState(todayYmd());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [owed, past] = await Promise.all([payoutsService.owed(personId), payoutsService.history(personId)]);
      setPreview(owed);
      setHistory(past);
      setTicked(new Set(owed.entries.map((e) => e.id)));
      setAmountEdit(null);
      setLoadError(null);
    } catch (e) {
      setLoadError(apiErrorMessage(e, 'The payout details could not load.'));
    }
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tickedCents = useMemo(
    () => (preview?.entries ?? []).filter((e) => ticked.has(e.id)).reduce((sum, e) => sum + toCents(e.amount), 0),
    [preview, ticked],
  );
  const amountText = amountEdit ?? (tickedCents / 100).toFixed(2);
  const blocked = preview ? blockedReason(preview, ticked, tickedCents, amountText, method) : null;

  const toggle = (id: number) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    setAmountEdit(null);
    setSaveError(null);
  };

  const save = async () => {
    if (!preview || blocked) return;
    setSaving(true);
    setSaveError(null);
    try {
      await payoutsService.record({
        payeeId: personId,
        amount: amountText.trim(),
        method,
        payoutDate: date,
        ...(reference.trim() && { reference: reference.trim() }),
        ...(notes.trim() && { notes: notes.trim() }),
        entryIds: [...ticked],
      });
      toast.success('Payout recorded');
      setReference('');
      setNotes('');
      await Promise.all([load(), onRecorded?.()]);
    } catch (e) {
      setSaveError(apiErrorMessage(e, 'The payout could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const name = personName ?? (preview ? `${preview.payee.firstName} ${preview.payee.lastName}` : 'this person');

  return (
    <Modal
      open
      onClose={onClose}
      title={`Record payout for ${name}`}
      description={preview ? `Pending commission ${formatCurrency(preview.owed)}` : undefined}
      footer={
        <>
          <span className="mfnote">Posts to 2020 Commissions payable.</span>
          <Button onClick={onClose}>Cancel</Button>
          <GuardedButtonV2 perm="recordPayout" variant="primary" disabled={!!blocked || saving} onClick={() => void save()}>Record payout</GuardedButtonV2>
        </>
      }
    >
      <div className="payform">
        {loadError ? (
          <p role="alert" className="err">{loadError}</p>
        ) : !preview ? (
          <p className="hint">Loading…</p>
        ) : (
          <>
            <form className="payfields" noValidate onSubmit={(ev) => { ev.preventDefault(); void save(); }}>
              <div className="row2">
                <Input
                  id="payout-amount" label={`Amount (${currencySign()})`} type="number" min="0" step="0.01" inputMode="decimal"
                  hint={`Pending: ${formatCurrency(preview.owed)}. Pay less to part-pay; the oldest entries are paid first.`}
                  value={amountText} onChange={(e) => { setAmountEdit(e.target.value); setSaveError(null); }}
                />
                <Select id="payout-method" label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {PAYOUT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              </div>
              <div className="row2">
                <Input id="payout-date" label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                <Input id="payout-reference" label="Reference" optional placeholder="MoMo ref" value={reference} onChange={(e) => { setReference(e.target.value); setSaveError(null); }} />
              </div>
              <Input id="payout-note" label="Note" optional placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </form>
            {blocked && <p className="warnline" data-testid="blocked-reason">{blocked}</p>}
            {saveError && <p role="alert" className="err">{saveError}</p>}

            <section aria-label="Owed entries" className="payentries">
              <h4>Owed entries</h4>
              {preview.entries.length === 0 ? (
                <p className="hint">Nothing is owed to {name}.</p>
              ) : (
                <div className="tablewrap">
                  <table className="dt">
                    <thead>
                      <tr><th style={{ width: 32 }}><span className="sr-only">Pay</span></th><th>Entry</th><th>Order</th><th>Earned</th><th className="r">Amount</th></tr>
                    </thead>
                    <tbody>
                      {preview.entries.map((e) => (
                        <tr key={e.id}>
                          <td><input type="checkbox" checked={ticked.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Pay ${KIND_LABEL[e.kind]}${e.orderId ? ` of order ${e.orderId}` : ''}`} /></td>
                          <td>{KIND_LABEL[e.kind]}</td>
                          <td>{e.orderId ? `#${e.orderId}` : '—'}</td>
                          <td>{e.earnedAt ? formatDate(e.earnedAt, 'd MMM') : '—'}</td>
                          <td className="r num">{formatCurrency(e.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section aria-label="Payout history" className="payentries">
              <h4>Payout history</h4>
              {history.length === 0 ? (
                <p className="hint">No payout recorded for {name} yet.</p>
              ) : (
                <div className="tablewrap">
                  <table className="dt">
                    <thead>
                      <tr><th>Date</th><th className="r">Amount</th><th>Method</th><th>Reference</th><th>Note</th><th>Recorded by</th></tr>
                    </thead>
                    <tbody>
                      {history.map((p) => (
                        <tr key={p.id}>
                          <td>{formatDate(p.payoutDate, 'd MMM')}</td>
                          <td className="r num">{formatCurrency(p.amount)}</td>
                          <td>{p.method}</td>
                          <td>{p.reference ?? '—'}</td>
                          <td>{p.notes ?? '—'}</td>
                          <td>{p.recordedBy ? `${p.recordedBy.firstName} ${p.recordedBy.lastName}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
};
