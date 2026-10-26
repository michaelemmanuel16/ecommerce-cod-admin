import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { History, Wallet } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { usePermissions } from '../../hooks/usePermissions';
import { payoutsService, type CommissionKind, type OwedPreview, type PayoutRow } from '../../services/payouts.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency, formatDate, todayYmd } from '../../utils/format';

const KIND_LABEL: Record<CommissionKind, string> = { base: 'Commission', upsell: 'Upsell reward', reward: 'Target reward' };
const METHODS = ['Mobile Money', 'Bank Transfer', 'Cash'];

interface PayoutFormProps {
  /** The person to pay. Finance passes a rep; Staff (M6) passes any person, with no other change. */
  personId: number;
  personName?: string;
  isOpen: boolean;
  onClose: () => void;
  /** A payout was saved: the caller reloads its list. */
  onRecorded?: () => void;
}

const cents = (v: string | number): number => Math.round(Number(v) * 100);

/**
 * The one payout form (F-913, F-1164, M5-T38). It reads the person's open entries from GET /api/payouts/owed/:id and pays
 * the ticked ones: the amount follows the ticks and may be lowered (the oldest entries are paid first). It has no delivery fee
 * line: the partner keeps that from the cash. Save is blocked when nothing is owed or the amount is above what is ticked, and a
 * refusal from the server ("Owed is GH₵2,034", "Already paid") shows in the form. History of the person's payouts is below.
 */
export const PayoutForm: React.FC<PayoutFormProps> = ({ personId, personName, isOpen, onClose, onRecorded }) => {
  const { can } = usePermissions();
  const canCreate = can('payouts', 'create');

  const [preview, setPreview] = useState<OwedPreview | null>(null);
  const [history, setHistory] = useState<PayoutRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [amountEdit, setAmountEdit] = useState<string | null>(null);
  const [method, setMethod] = useState(METHODS[0]);
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
    if (isOpen) void load();
  }, [isOpen, load]);

  const tickedOwed = useMemo(
    () => (preview?.entries ?? []).filter((e) => ticked.has(e.id)).reduce((sum, e) => sum + cents(e.amount), 0),
    [preview, ticked],
  );
  const amountText = amountEdit ?? (tickedOwed / 100).toFixed(2);

  // Why Save is blocked, in the words the server uses where it has them
  const blocked = (() => {
    if (!preview) return 'Loading';
    if (cents(preview.owed) <= 0) return 'Nothing is owed to this person';
    if (ticked.size === 0) return 'Tick at least one entry';
    if (amountText.trim() === '' || !Number.isFinite(Number(amountText)) || cents(amountText) <= 0) return 'Enter an amount above zero';
    if (cents(amountText) > tickedOwed) return `Owed is ${formatCurrency(tickedOwed / 100)}`;
    if (method.trim() === '') return 'Pick a method';
    return null;
  })();

  const toggle = (id: number) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
      await load();
      onRecorded?.();
    } catch (e) {
      setSaveError(apiErrorMessage(e, 'The payout could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const name = personName ?? (preview ? `${preview.payee.firstName} ${preview.payee.lastName}` : 'this person');
  const agent = preview?.payee.kind === 'agent';
  const saveButton = (
    <Button type="button" onClick={() => void save()} disabled={!canCreate || !!blocked} isLoading={saving}>
      <Wallet className="w-4 h-4 mr-2" />
      Record payout
    </Button>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Record payout: ${name}`} size="xl">
      <div className="p-6 space-y-6 text-gray-900">
        {loadError ? (
          <p role="alert" className="text-sm text-red-600">{loadError}</p>
        ) : !preview ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              {([
                [agent ? 'Target reward' : 'Commission', agent ? preview.targetReward : preview.commission],
                ...(agent ? [] : [['Upsell reward', preview.upsellReward], ['Target reward', preview.targetReward]]),
                ['Earned', preview.earned],
                ['Already paid', preview.paid],
              ] as Array<[string, string]>).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-gray-200 p-3">
                  <dt className="text-xs text-gray-500">{label}</dt>
                  <dd className="font-semibold">{formatCurrency(value)}</dd>
                </div>
              ))}
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <dt className="text-xs text-blue-700">Owed now</dt>
                <dd className="font-semibold text-blue-900">{formatCurrency(preview.owed)}</dd>
              </div>
            </dl>

            <section aria-label="Owed entries">
              <h4 className="text-sm font-semibold mb-2">Owed entries</h4>
              {preview.entries.length === 0 ? (
                <p className="text-sm text-gray-500">Nothing is owed to {name}.</p>
              ) : (
                <div className="max-h-56 overflow-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="p-2 w-8" scope="col"><span className="sr-only">Pay</span></th>
                        <th className="p-2 text-left" scope="col">Entry</th>
                        <th className="p-2 text-left" scope="col">Order</th>
                        <th className="p-2 text-left" scope="col">Earned</th>
                        <th className="p-2 text-right" scope="col">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.entries.map((e) => (
                        <tr key={e.id} className="border-t border-gray-100">
                          <td className="p-2">
                            <input type="checkbox" checked={ticked.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Pay ${KIND_LABEL[e.kind]}${e.orderId ? ` of order ${e.orderId}` : ''}`} />
                          </td>
                          <td className="p-2">{KIND_LABEL[e.kind]}</td>
                          <td className="p-2">{e.orderId ? `#${e.orderId}` : '—'}</td>
                          <td className="p-2">{e.earnedAt ? formatDate(e.earnedAt) : '—'}</td>
                          <td className="p-2 text-right">{formatCurrency(e.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <form className="grid grid-cols-1 md:grid-cols-2 gap-4" noValidate onSubmit={(ev) => { ev.preventDefault(); void save(); }}>
              <label className="text-xs font-medium text-gray-500">
                Amount
                <input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded"
                  value={amountText}
                  onChange={(e) => { setAmountEdit(e.target.value); setSaveError(null); }}
                />
              </label>
              <label className="text-xs font-medium text-gray-500">
                Method
                <select className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {METHODS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-gray-500">
                Date
                <input type="date" className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="text-xs font-medium text-gray-500">
                Reference (optional)
                <input type="text" className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded" value={reference} onChange={(e) => { setReference(e.target.value); setSaveError(null); }} />
              </label>
              <label className="text-xs font-medium text-gray-500 md:col-span-2">
                Note (optional)
                <input type="text" className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
              <p className="text-xs text-gray-500 md:col-span-2">Posts to 2020 Commissions payable. A part payment pays the oldest entries first.</p>
              {(blocked && blocked !== 'Loading') && <p className="text-sm text-amber-700 md:col-span-2" data-testid="blocked-reason">{blocked}</p>}
              {saveError && <p role="alert" className="text-sm text-red-600 md:col-span-2">{saveError}</p>}
              <div className="md:col-span-2 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose}>Close</Button>
                {canCreate ? saveButton : <Tooltip content="You need the payouts permission to record a payout">{saveButton}</Tooltip>}
              </div>
            </form>

            <section aria-label="Payout history">
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><History className="w-4 h-4" />Payout history</h4>
              {history.length === 0 ? (
                <p className="text-sm text-gray-500">No payout recorded for {name} yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="p-2 text-left" scope="col">Date</th>
                        <th className="p-2 text-right" scope="col">Amount</th>
                        <th className="p-2 text-left" scope="col">Method</th>
                        <th className="p-2 text-left" scope="col">Reference</th>
                        <th className="p-2 text-left" scope="col">Note</th>
                        <th className="p-2 text-left" scope="col">Recorded by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((p) => (
                        <tr key={p.id} className="border-t border-gray-100">
                          <td className="p-2 whitespace-nowrap">{formatDate(p.payoutDate)}</td>
                          <td className="p-2 text-right whitespace-nowrap">{formatCurrency(p.amount)}</td>
                          <td className="p-2">{p.method}</td>
                          <td className="p-2">{p.reference ?? '—'}</td>
                          <td className="p-2">{p.notes ?? '—'}</td>
                          <td className="p-2 whitespace-nowrap">{p.recordedBy ? `${p.recordedBy.firstName} ${p.recordedBy.lastName}` : '—'}</td>
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
