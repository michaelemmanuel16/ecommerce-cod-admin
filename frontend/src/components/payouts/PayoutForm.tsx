import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { History, Wallet } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Table, TableBody, TableCell, TableHead, TableRow } from '../ui/Table';
import { Tooltip } from '../ui/Tooltip';
import { usePermissions } from '../../hooks/usePermissions';
import { payoutsService, type CommissionKind, type OwedPreview, type PayoutRow } from '../../services/payouts.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency, formatDate, todayYmd } from '../../utils/format';
import { toCents } from '../../utils/money';

const KIND_LABEL: Record<CommissionKind, string> = { base: 'Commission', upsell: 'Upsell reward', reward: 'Target reward' };
// The words the old payout modal wrote and the payouts already in the books hold (the server takes any text). Not the deposit
// methods of the mobile collections page: those are snake_case values with a Check option.
const PAYOUT_METHODS = ['Mobile Money', 'Bank Transfer', 'Cash'].map((m) => ({ value: m, label: m }));

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
  const { can } = usePermissions();
  const canCreate = can('payouts', 'create');

  const [preview, setPreview] = useState<OwedPreview | null>(null);
  const [history, setHistory] = useState<PayoutRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [amountEdit, setAmountEdit] = useState<string | null>(null);
  const [method, setMethod] = useState(PAYOUT_METHODS[0].value);
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
  const agent = preview?.payee.kind === 'agent';
  const tiles: Array<{ label: string; value: string }> = preview
    ? [
        ...(agent
          ? [{ label: 'Target reward', value: preview.targetReward }]
          : [
              { label: 'Commission', value: preview.commission },
              { label: 'Upsell reward', value: preview.upsellReward },
              { label: 'Target reward', value: preview.targetReward },
            ]),
        { label: 'Earned', value: preview.earned },
        { label: 'Already paid', value: preview.paid },
      ]
    : [];
  const saveButton = (
    <Button type="button" onClick={() => void save()} disabled={!canCreate || !!blocked} isLoading={saving}>
      <Wallet className="w-4 h-4 mr-2" />
      Record payout
    </Button>
  );

  return (
    <Modal isOpen onClose={onClose} title={`Record payout: ${name}`} size="xl">
      <div className="p-6 space-y-6 text-gray-900">
        {loadError ? (
          <p role="alert" className="text-sm text-red-600">{loadError}</p>
        ) : !preview ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              {tiles.map(({ label, value }) => (
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
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell isHeader className="w-8"><span className="sr-only">Pay</span></TableCell>
                        <TableCell isHeader>Entry</TableCell>
                        <TableCell isHeader>Order</TableCell>
                        <TableCell isHeader>Earned</TableCell>
                        <TableCell isHeader className="text-right">Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {preview.entries.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell>
                            <input type="checkbox" checked={ticked.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Pay ${KIND_LABEL[e.kind]}${e.orderId ? ` of order ${e.orderId}` : ''}`} />
                          </TableCell>
                          <TableCell>{KIND_LABEL[e.kind]}</TableCell>
                          <TableCell>{e.orderId ? `#${e.orderId}` : '—'}</TableCell>
                          <TableCell>{e.earnedAt ? formatDate(e.earnedAt) : '—'}</TableCell>
                          <TableCell className="text-right">{formatCurrency(e.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            <form className="grid grid-cols-1 md:grid-cols-2 gap-4" noValidate onSubmit={(ev) => { ev.preventDefault(); void save(); }}>
              <Input
                id="payout-amount" label="Amount" type="number" min="0" step="0.01" inputMode="decimal"
                value={amountText} onChange={(e) => { setAmountEdit(e.target.value); setSaveError(null); }}
              />
              <Select id="payout-method" label="Method" options={PAYOUT_METHODS} value={method} onChange={(e) => setMethod(e.target.value)} />
              <Input id="payout-date" label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <Input id="payout-reference" label="Reference (optional)" value={reference} onChange={(e) => { setReference(e.target.value); setSaveError(null); }} />
              <div className="md:col-span-2">
                <Input id="payout-note" label="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <p className="text-xs text-gray-500 md:col-span-2">Posts to 2020 Commissions payable. A part payment pays the oldest entries first.</p>
              {blocked && <p className="text-sm text-amber-700 md:col-span-2" data-testid="blocked-reason">{blocked}</p>}
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
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell isHeader>Date</TableCell>
                      <TableCell isHeader className="text-right">Amount</TableCell>
                      <TableCell isHeader>Method</TableCell>
                      <TableCell isHeader>Reference</TableCell>
                      <TableCell isHeader>Note</TableCell>
                      <TableCell isHeader>Recorded by</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {history.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{formatDate(p.payoutDate)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(p.amount)}</TableCell>
                        <TableCell>{p.method}</TableCell>
                        <TableCell>{p.reference ?? '—'}</TableCell>
                        <TableCell>{p.notes ?? '—'}</TableCell>
                        <TableCell>{p.recordedBy ? `${p.recordedBy.firstName} ${p.recordedBy.lastName}` : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
};
