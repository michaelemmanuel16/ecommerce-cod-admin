import { Lock, PackageCheck, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui-v2';
import type { Shipment } from '../../services/shipments.service';
import { formatCurrency } from '../../utils/format';
import { isReceived } from './shipModel';

export interface ShipmentActions {
  canWrite: boolean;
  onReceive: (s: Shipment) => void;
  onEdit: (s: Shipment) => void;
  onDelete: (s: Shipment) => void;
  onClaim: (s: Shipment) => void;
}

const claimLabel = (s: Shipment): string =>
  s.claimStatus === 'open' ? `Claim ${formatCurrency(s.claimAmount, s.storeCurrency)}` : s.claimStatus === 'settled' ? 'Claim settled' : 'Claim written off';

/** What a row offers: a pending shipment is received, edited or deleted; a received one is locked and may have a claim. */
export function Actions({ s, a }: { s: Shipment; a: ShipmentActions }) {
  if (!isReceived(s)) {
    if (!a.canWrite) return null;
    return (
      <span className="acts">
        <Button size="mini" variant="primary" onClick={() => a.onReceive(s)}><PackageCheck size={13} /> Receive</Button>
        <Button size="icon-sm" aria-label={`Edit shipment of ${s.product.name}`} title="Edit" onClick={() => a.onEdit(s)}><Pencil /></Button>
        <Button size="icon-sm" aria-label={`Delete shipment of ${s.product.name}`} title="Delete" onClick={() => a.onDelete(s)}><Trash2 /></Button>
      </span>
    );
  }
  return (
    <span className="acts">
      {s.claimStatus !== 'none' && <Button size="mini" onClick={() => a.onClaim(s)}>{claimLabel(s)}</Button>}
      <span className="lock" title="Received shipments are locked"><Lock size={14} aria-label="Locked" /> In stock</span>
    </span>
  );
}

