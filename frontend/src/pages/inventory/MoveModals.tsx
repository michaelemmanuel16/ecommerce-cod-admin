import { useState } from 'react';
import { Input, Select } from '../../components/ui-v2';
import {
  inventoryService, type AdjustReason, type LocationCard, type Overview, type PhysicalProduct, type ReturnReason,
} from '../../services/inventory.service';
import { apiErrorMessage } from '../../utils/apiError';
import { ACTION_META, ADJUST_REASONS, REASON_LABEL, RETURN_REASONS, type ModalKind, type MoveKind } from './model';
import { count } from '../deliveries/model';
import { StockShell } from './StockShell';

export interface StockModalProps {
  overview: Overview;
  products: PhysicalProduct[];
  /** Holder and product to preselect (a click on a card or a row, or the link that opened the page). */
  initial?: { locationId?: number | null; productId?: number | null };
  onClose: () => void;
  /** The change is saved: the page shows `message`, refreshes the cards, the table and the transfers, and closes the modal. */
  onDone: (message: string) => void;
}

const onHandAt = (overview: Overview, locationId: number | undefined, productId: number | undefined): number =>
  overview.stockByLocation.find((r) => r.locationId === locationId && r.productId === productId)?.onHand ?? 0;

/** The chosen option, or the first one: the choice is derived, so a list that changes under it never leaves a stale pick. */
const chosen = (options: LocationCard[], id: number | null | undefined): LocationCard | undefined => options.find((o) => o.id === id) ?? options[0];

const MOVE_COPY: Record<MoveKind, { description: string; fromLabel: string; toLabel: string }> = {
  allocate: { description: 'Move units from the warehouse to a delivery agent or 3PL.', fromLabel: 'From', toLabel: 'To' },
  transfer: { description: 'Stock moves straight from one agent to another. The warehouse is not involved.', fromLabel: 'From agent', toLabel: 'To agent' },
  return: { description: 'Use this for failed deliveries and stock an agent no longer needs.', fromLabel: 'From', toLabel: 'To' },
};
const TRANSFER_TYPE = { allocate: 'allocation', transfer: 'agent_transfer', return: 'return_to_warehouse' } as const;

/**
 * Allocate, Transfer and Return (M4-T26, F-655): units leave a holder and wait in transit for the receiver. The quantity limit
 * is the on-hand number of the overview API, and the server checks again.
 */
export function MoveModal({ kind, overview, products, initial, onClose, onDone }: StockModalProps & { kind: MoveKind }) {
  const meta = ACTION_META[kind];
  const copy = MOVE_COPY[kind];
  const [productId, setProductId] = useState<number | undefined>(initial?.productId ?? products[0]?.id);
  const [fromId, setFromId] = useState<number | null | undefined>(initial?.locationId);
  const [toId, setToId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<ReturnReason>('failed_deliveries');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fromOptions = overview.locations.filter((l) => meta.from.includes(l.type));
  const from = chosen(fromOptions, fromId);
  const toOptions = overview.locations.filter((l) => meta.to.includes(l.type) && l.id !== from?.id);
  const to = chosen(toOptions, toId);
  const have = onHandAt(overview, from?.id, productId);
  const product = products.find((p) => p.id === productId);

  const qty = quantity.trim() === '' ? null : Number(quantity);
  let quantityError: string | undefined;
  if (qty !== null && !Number.isInteger(qty)) quantityError = 'Use a whole number';
  else if (qty !== null && qty < 1) quantityError = 'Use 1 or more';
  else if (qty !== null && qty > have) quantityError = `Only ${count(have)} on hand`;
  const ready = !!product && !!from && !!to && qty !== null && !quantityError;

  const save = async () => {
    if (!ready || !product || !from || !to || qty === null) return;
    setSaving(true);
    setError(null);
    try {
      await inventoryService.createTransfer({
        type: TRANSFER_TYPE[kind], productId: product.id, quantity: qty, fromLocationId: from.id, toLocationId: to.id,
        ...(kind === 'return' && { reason }), note: note.trim() || undefined,
      });
      onDone(meta.done({ quantity: qty, product: product.name, from: from.name, to: to.name }));
    } catch (e) {
      setSaving(false);
      setError(apiErrorMessage(e, 'The stock could not be moved.'));
    }
  };

  return (
    <StockShell
      kind={kind} description={copy.description} ready={ready} saving={saving} error={error} note={note} onNote={setNote}
      notePlaceholder="Pickup time, order numbers, condition" onClose={onClose} onSave={() => void save()}
    >
      <Select label="Product" value={productId ?? ''} onChange={(e) => setProductId(Number(e.target.value))}>
        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <div className="fg">
        <Select label={copy.fromLabel} hint={`${count(have)} ${kind === 'allocate' ? 'available' : 'on hand'}`} value={from?.id ?? ''} onChange={(e) => setFromId(Number(e.target.value))}>
          {fromOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <Select label={copy.toLabel} value={to?.id ?? ''} onChange={(e) => setToId(Number(e.target.value))}>
          {toOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>
      <div className="fg">
        <Input label="Quantity" type="number" min={1} max={have} value={quantity} error={quantityError} onChange={(e) => setQuantity(e.target.value)} />
        {kind === 'return' && (
          <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value as ReturnReason)}>
            {RETURN_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
          </Select>
        )}
      </div>
      {kind === 'allocate' && <p className="hint">Units show as in transit until the agent confirms them.</p>}
    </StockShell>
  );
}

/** Adjust quantity (F-655): set what one holder has of one product. Every change needs a reason; "Other" needs a note. */
export function AdjustModal({ overview, products, initial, onClose, onDone }: StockModalProps) {
  const meta = ACTION_META.adjust;
  const [productId, setProductId] = useState<number | undefined>(initial?.productId ?? products[0]?.id);
  const [holderId, setHolderId] = useState<number | null | undefined>(initial?.locationId);
  /** null until the person types: the box then shows what the holder has now. */
  const [typed, setTyped] = useState<string | null>(null);
  const [reason, setReason] = useState<AdjustReason>('physical_count_correction');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const holder = chosen(overview.locations, holderId);
  const have = onHandAt(overview, holder?.id, productId);
  const product = products.find((p) => p.id === productId);
  const shown = typed ?? String(have);
  const qty = shown.trim() === '' ? null : Number(shown);
  const change = qty !== null && Number.isInteger(qty) ? qty - have : 0;

  let quantityError: string | undefined;
  if (qty !== null && !Number.isInteger(qty)) quantityError = 'Use a whole number';
  else if (qty !== null && qty < 0) quantityError = 'Use 0 or more';
  const noteRequired = reason === 'other';
  const ready = !!product && !!holder && qty !== null && !quantityError && change !== 0 && (!noteRequired || note.trim() !== '');
  const hint = change === 0 ? `Now ${count(have)}. No change.` : `Now ${count(have)}. Change of ${change > 0 ? '+' : '−'}${count(Math.abs(change))}.`;

  const save = async () => {
    if (!ready || !product || !holder || qty === null) return;
    setSaving(true);
    setError(null);
    try {
      await inventoryService.adjust({ locationId: holder.id, productId: product.id, newQuantity: qty, reason, note: note.trim() || undefined });
      onDone(meta.done({ quantity: qty, product: product.name, from: holder.name, to: '' }));
    } catch (e) {
      setSaving(false);
      setError(apiErrorMessage(e, 'The quantity could not be saved.'));
    }
  };

  return (
    <StockShell
      kind="adjust" description="Fix the count after a stock check. Every change needs a reason and is logged." ready={ready} saving={saving}
      error={error} note={note} onNote={setNote} noteRequired={noteRequired} notePlaceholder="For example: Kofi counted on 15 Oct"
      onClose={onClose} onSave={() => void save()}
    >
      <div className="fg">
        <Select label="Holder" value={holder?.id ?? ''} onChange={(e) => { setHolderId(Number(e.target.value)); setTyped(null); }}>
          {overview.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <Select label="Product" value={productId ?? ''} onChange={(e) => { setProductId(Number(e.target.value)); setTyped(null); }}>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <div className="fg">
        <Input label="New quantity" type="number" min={0} value={shown} error={quantityError} hint={hint} onChange={(e) => setTyped(e.target.value)} />
        <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)}>
          {ADJUST_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
        </Select>
      </div>
    </StockShell>
  );
}

/** Which of the stock modals a kind opens. */
export function StockModal({ kind, ...props }: StockModalProps & { kind: ModalKind }) {
  return kind === 'adjust' ? <AdjustModal {...props} /> : <MoveModal kind={kind} {...props} />;
}
