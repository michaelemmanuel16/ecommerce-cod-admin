import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select } from '../../components/ui-v2';
import type { StatusMoveExtras } from '../../services/orders.service';
import type { DeclineReason, FailureReason, OrderStatus } from '../../types';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import { DECLINE_REASONS, FAILURE_REASONS, reasonKind } from './reasons';

interface ReasonDialogProps {
  /** null: closed. */
  open: { target: OrderStatus; count: number; first: string; forced: boolean; declineRequired: boolean } | null;
  onClose: () => void;
  onSubmit: (extras: StatusMoveExtras) => void;
}

const tomorrow = (): string => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const MIN_FORCE_REASON = 5;

/**
 * The small dialog a move can ask for (F-306, F-313): the decline reason for a cancel, the failure reason and the next
 * attempt date for a failed delivery, and a written reason (5 characters or more) for a forced move.
 * A bulk move asks once, for all the selected orders.
 */
export function ReasonDialog({ open, onClose, onSubmit }: ReasonDialogProps) {
  const [decline, setDecline] = useState<DeclineReason | ''>('');
  const [failure, setFailure] = useState<FailureReason | ''>('');
  const [next, setNext] = useState('');
  const [why, setWhy] = useState('');
  const [tried, setTried] = useState(false);

  const isOpen = open !== null;
  useEffect(() => {
    if (isOpen) {
      setDecline('');
      setFailure('');
      setNext('');
      setWhy('');
      setTried(false);
    }
  }, [isOpen]);

  if (!open) return null;
  const kind = reasonKind(open.target);
  const label = ORDER_STATUS_LABELS[open.target];
  const title = open.count === 1 ? `Move ${open.first} to ${label}` : `Move ${open.count.toLocaleString('en-GB')} orders to ${label}`;

  const problem =
    open.forced && why.trim().length < MIN_FORCE_REASON ? 'Write a reason of at least 5 characters.'
    : kind === 'failure' && !failure ? 'Choose why the delivery failed.'
    : kind === 'decline' && open.declineRequired && !decline ? 'Choose why the order is cancelled.'
    : kind === 'failure' && failure === 'rescheduled' && !next ? 'Choose the next attempt date.'
    : null;

  const submit = () => {
    setTried(true);
    if (problem) return;
    onSubmit({
      ...(kind === 'decline' && decline && { declineReason: decline }),
      ...(kind === 'failure' && failure && { failureReason: failure }),
      ...(kind === 'failure' && next && { nextAttemptDate: next }),
      ...(open.forced && { force: true, reason: why.trim() }),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={open.forced ? 'This move is outside the normal flow. It is saved in the order history.' : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            Move to {label}
          </Button>
        </>
      }
    >
      {kind === 'decline' && (
        <Select label={open.declineRequired ? 'Why is it cancelled?' : 'Why is it cancelled? (optional)'} value={decline} onChange={(e) => setDecline(e.target.value as DeclineReason)}>
          <option value="">{open.declineRequired ? 'Choose a reason' : 'No reason'}</option>
          {DECLINE_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      )}
      {kind === 'failure' && (
        <>
          <Select label="Why did the delivery fail?" value={failure} onChange={(e) => {
            const v = e.target.value as FailureReason;
            setFailure(v);
            if (v === 'rescheduled' && !next) setNext(tomorrow());
          }}>
            <option value="">Choose a reason</option>
            {FAILURE_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Input label="Next attempt" optional={failure !== 'rescheduled'} type="date" value={next} onChange={(e) => setNext(e.target.value)} />
        </>
      )}
      {open.forced && (
        <Input label="Reason" value={why} maxLength={500} onChange={(e) => setWhy(e.target.value)} />
      )}
      {tried && problem && <p className="err" role="alert" style={{ color: 'var(--coral)', fontSize: 12.5 }}>{problem}</p>}
    </Modal>
  );
}
