import { ArrowRight } from 'lucide-react';
import { Button, Tag } from '../../components/ui-v2';
import type { Transfer } from '../../services/inventory.service';
import { canConfirmHere, placeName, statusView } from './model';

/** "Logiswift -> Kofi Appiah" */
export function Move({ transfer }: { transfer: Transfer }) {
  return (
    <span className="move">
      {placeName(transfer, 'from')}
      <ArrowRight aria-hidden="true" />
      {placeName(transfer, 'to')}
    </span>
  );
}

/** The status tag, the Overdue tag of an in-transit transfer (a dispute waits for the owner, so it is never late), and the line under them. */
export function StatusCell({ transfer }: { transfer: Transfer }) {
  const s = statusView(transfer);
  return (
    <>
      <Tag tone={s.tone}>{s.text}</Tag>
      {transfer.overdue && transfer.status === 'in_transit' && <Tag tone="warn" className="after">Overdue</Tag>}
      {s.sub && <small className="sub">{s.sub}</small>}
    </>
  );
}

interface TransferActionsProps {
  transfer: Transfer;
  onReceive: (t: Transfer) => void;
  onResolve: (t: Transfer) => void;
}

/** "Confirm received" for a 3PL or own store that is waiting for stock; "Resolve" for a dispute. Agents confirm on their own screen. */
export function TransferActions({ transfer, onReceive, onResolve }: TransferActionsProps) {
  return (
    <div className="tbtns">
      {canConfirmHere(transfer) && (
        <Button size="mini" variant="primary" aria-label={`Confirm received: ${transfer.product.name} at ${transfer.toLocation?.name}`} onClick={(e) => { e.stopPropagation(); onReceive(transfer); }}>Confirm received</Button>
      )}
      {transfer.status === 'disputed' && (
        <Button size="mini" aria-label={`Resolve: ${transfer.product.name}, ${transfer.toLocation?.name}`} onClick={(e) => { e.stopPropagation(); onResolve(transfer); }}>Resolve</Button>
      )}
    </div>
  );
}
