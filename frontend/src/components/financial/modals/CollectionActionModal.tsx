import { useState } from 'react';
import { Check, FileX, Image as ImageIcon, XCircle } from 'lucide-react';
import { Button, Input, Modal, Select, Tag, useToast } from '../../ui-v2';
import { GuardedButtonV2 } from '../GuardedButtonV2';
import { collectionsService, type PartnerDeposit } from '../../../services/collections.service';
import { apiErrorMessage } from '../../../utils/apiError';
import { formatCurrency, formatDate } from '../../../utils/format';
import { isPdfUrl, isSafeReceiptUrl } from '../../../utils/expenseRules';
import { DEPOSIT_TONE, REJECT_REASONS, depositLabel, ordersCovered, ordersText, partnerName, receiptName, rejectText } from '../../../pages/financial/collections/model';

interface Props {
  deposit: PartnerDeposit;
  /** What the partner holds now, from the aging report; null when it is not in the report. */
  cashHeld: number | null;
  onClose: () => void;
  /** Something changed (a verify or a reject): the page reloads its figures. */
  onChanged?: () => void;
}

/**
 * Review one collection a partner says they paid in (F-912, M5-T36). Receipt and facts sit side by side. "Verify and reconcile"
 * matches it to the partner's oldest unpaid orders in one step; there is no approve step. "Reject" asks for a reason from the
 * list and an optional note. A pay-in that is already verified or rejected opens read-only.
 */
export function CollectionActionModal({ deposit, cashHeld, onClose, onChanged }: Props) {
  const say = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<string>(REJECT_REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = partnerName(deposit);
  const pending = deposit.status === 'pending';
  const receipt = isSafeReceiptUrl(deposit.receiptUrl) ? deposit.receiptUrl : null;
  const orders = ordersCovered(deposit.allocations);

  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      say(done);
      onChanged?.();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, 'That did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const footer = pending ? (
    <>
      <GuardedButtonV2 perm="verifyCollection" variant="danger" className="start" disabled={busy} onClick={() => (rejecting ? void run(() => collectionsService.rejectDeposit(deposit.id, rejectText(reason, note)), `Pay-in ${deposit.referenceNumber} rejected`) : setRejecting(true))}>
        <XCircle />{rejecting ? 'Confirm reject' : 'Reject'}
      </GuardedButtonV2>
      <Button onClick={onClose}>Close</Button>
      <GuardedButtonV2 perm="verifyCollection" variant="primary" disabled={busy || rejecting} onClick={() => void run(() => collectionsService.verifyDeposit(deposit.id), `${name}'s pay-in reconciled`)}>
        <Check />Verify and reconcile
      </GuardedButtonV2>
    </>
  ) : (
    <Button onClick={onClose}>Close</Button>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`Review collection from ${name}`}
      size="lg"
      description={`${formatDate(deposit.depositDate, 'd MMM')} · ${formatCurrency(deposit.amount)}`}
      footer={footer}
    >
      <div className="revbody">
        <div className="row2">
          <div>
            <div className="fl"><span className="lbl">Receipt</span></div>
            <div className="revreceipt">
              {receipt ? (
                <div>
                  {isPdfUrl(receipt) ? (
                    <iframe title="Receipt PDF" src={receipt} />
                  ) : (
                    <a href={receipt} rel="noreferrer" aria-label="Open the receipt full size"><img src={receipt} alt="Receipt" /></a>
                  )}
                  <small><a className="rcpt" href={receipt} rel="noreferrer">{receiptName(receipt)}</a></small>
                </div>
              ) : (
                <div>
                  {pending ? <FileX className="warn" /> : <ImageIcon />}
                  <b>No receipt attached</b>
                  {pending && <small>Ask for a MoMo screenshot before you verify.</small>}
                </div>
              )}
            </div>
          </div>
          <div className="revfacts">
            <div className="drv"><small>Amount paid</small><b>{formatCurrency(deposit.amount)}</b><em>{deposit.depositMethod} · {deposit.referenceNumber}</em></div>
            <div className="drv">
              <small>Orders covered</small>
              <b>{orders === null ? '—' : orders.toLocaleString('en-GB')}</b>
              <em>{orders === null ? 'Matched to the oldest unpaid orders when you verify' : `Matched to ${ordersText(orders)}`}</em>
            </div>
            {cashHeld !== null && <div className="drv"><small>Cash the partner holds</small><b>{formatCurrency(cashHeld)}</b><em>Before this pay-in is matched</em></div>}
            {!pending && (
              <div className="drv">
                <small>Status</small>
                <b><Tag tone={DEPOSIT_TONE[deposit.status]}>{depositLabel(deposit.status)}</Tag></b>
                {deposit.status === 'rejected' && deposit.rejectReason && <em>{deposit.rejectReason}</em>}
              </div>
            )}
          </div>
        </div>
        {rejecting && pending && (
          <div className="row2">
            <Select label="Rejection reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
            <Input label="Note to the partner" optional value={note} autoComplete="off" onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        {error && <p className="err" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
