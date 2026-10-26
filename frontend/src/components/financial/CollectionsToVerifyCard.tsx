import { useState } from 'react';
import { CheckCheck, Paperclip } from 'lucide-react';
import { Button, Card, EmptyState, Tag, useToast } from '../ui-v2';
import { GuardedButtonV2 } from './GuardedButtonV2';
import { collectionsService, type PartnerDeposit } from '../../services/collections.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency, formatDate } from '../../utils/format';
import { isSafeReceiptUrl } from '../../utils/expenseRules';
import { DEPOSIT_TONE, depositLabel, ordersCovered, partnerName, receiptKind } from '../../pages/financial/collections/model';

/** How many already-decided pay-ins show under the pending ones. */
const RECENT = 10;

interface Props {
  deposits: PartnerDeposit[];
  onReview: (d: PartnerDeposit) => void;
  /** Some pay-ins were verified: the page reloads its figures. */
  onChanged: () => void;
}

/**
 * "Collections to verify" (F-912, M5-T36): money a partner says they paid in, pending first. Tick pending rows and
 * "Reconcile selected" verifies them one after the other (each is matched to that partner's oldest unpaid orders); "Review"
 * opens the receipt and the facts for one.
 */
export function CollectionsToVerifyCard({ deposits, onReview, onChanged }: Props) {
  const say = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const pending = deposits.filter((d) => d.status === 'pending');
  const rows = [...pending, ...deposits.filter((d) => d.status !== 'pending').slice(0, RECENT)];
  const allTicked = pending.length > 0 && pending.every((d) => selected.has(d.id));
  const toggle = (ids: number[], on: boolean) => setSelected((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });

  const reconcile = async () => {
    setBusy(true);
    let done = 0;
    try {
      for (const id of selected) {
        await collectionsService.verifyDeposit(id);
        done += 1;
      }
      say(`${done} ${done === 1 ? 'collection' : 'collections'} reconciled`);
    } catch (e) {
      say(apiErrorMessage(e, `Stopped after ${done}. The next one could not be reconciled.`));
    } finally {
      setSelected(new Set());
      setBusy(false);
      if (done > 0) onChanged();
    }
  };

  return (
    <Card title="Collections to verify" aside="Money a partner says they paid in" className="verifywrap">
      <div className="agtools">
        <b className="mut" style={{ fontWeight: 600 }}>{selected.size > 0 ? `${selected.size} selected` : 'Select collections to reconcile in bulk'}</b>
        <GuardedButtonV2 perm="verifyCollection" variant="primary" disabled={selected.size === 0 || busy} onClick={() => void reconcile()}>
          <CheckCheck />Reconcile selected
        </GuardedButtonV2>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<CheckCheck />} title="Nothing to verify" text="When a partner pays cash in, it shows here with its receipt." />
      ) : (
        <div className="tablewrap">
          <table className="dt" aria-label="Collections to verify">
            <thead>
              <tr>
                <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all pending" checked={allTicked} disabled={pending.length === 0} onChange={(e) => toggle(pending.map((d) => d.id), e.target.checked)} /></th>
                <th>Date</th><th>From</th><th className="r">Orders</th><th className="r">Amount</th><th>Receipt</th><th>Status</th><th className="r">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const orders = ordersCovered(d.allocations);
                const name = partnerName(d);
                return (
                  <tr key={d.id} className={selected.has(d.id) ? 'sel' : undefined}>
                    <td>{d.status === 'pending' && <input type="checkbox" aria-label={`Select ${name} ${formatDate(d.depositDate, 'd MMM')}`} checked={selected.has(d.id)} onChange={(e) => toggle([d.id], e.target.checked)} />}</td>
                    <td>{formatDate(d.depositDate, 'd MMM')}</td>
                    <td><b>{name}</b></td>
                    <td className="r num">{orders ?? '—'}</td>
                    <td className="r num"><b>{formatCurrency(d.amount)}</b></td>
                    <td>{isSafeReceiptUrl(d.receiptUrl) ? <span className="rcpt"><Paperclip />{receiptKind(d.receiptUrl)}</span> : <Tag tone="warn">No receipt</Tag>}</td>
                    <td><Tag tone={DEPOSIT_TONE[d.status]}>{depositLabel(d.status)}</Tag></td>
                    <td className="r">
                      {d.status === 'pending'
                        ? <GuardedButtonV2 perm="verifyCollection" size="mini" variant="primary" aria-label={`Review ${name} ${formatDate(d.depositDate, 'd MMM')}`} onClick={() => onReview(d)}>Review</GuardedButtonV2>
                        : <Button size="mini" aria-label={`View ${name} ${formatDate(d.depositDate, 'd MMM')}`} onClick={() => onReview(d)}>View</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
