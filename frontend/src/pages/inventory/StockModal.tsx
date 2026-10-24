import { useMemo, useState } from 'react';
import { ArrowLeftRight, PackagePlus, SlidersHorizontal, Undo2 } from 'lucide-react';
import { Button, Input, Modal, Select } from '../../components/ui-v2';
import {
  inventoryService, type AdjustReason, type LocationCard, type Overview, type PhysicalProduct, type ReturnReason, type StockLocationType,
} from '../../services/inventory.service';
import { apiErrorMessage } from '../../utils/apiError';
import { ADJUST_REASONS, num, REASON_LABEL, RETURN_REASONS } from './model';

export type StockModalKind = 'allocate' | 'transfer' | 'return' | 'adjust';

export interface StockModalProps {
  kind: StockModalKind;
  overview: Overview;
  products: PhysicalProduct[];
  /** Holder and product to preselect (a click on a card or a row, or the link that opened the page). */
  initial?: { locationId?: number | null; productId?: number | null };
  onClose: () => void;
  /** The change is saved: the page shows `message`, refreshes the cards, the table and the transfers, and closes the modal. */
  onDone: (message: string) => void;
}

interface Copy {
  title: string;
  description: string;
  submit: string;
  Icon: typeof PackagePlus;
  /** Which holders the "From" (or "Holder") list offers. */
  from: StockLocationType[];
  fromLabel: string;
}

const COPY: Record<StockModalKind, Copy> = {
  allocate: {
    title: 'Allocate stock to agent',
    description: 'Move units from the warehouse to a delivery agent or 3PL.',
    submit: 'Allocate stock',
    Icon: PackagePlus,
    from: ['own_store', 'partner_3pl'],
    fromLabel: 'From',
  },
  transfer: {
    title: 'Transfer to another agent',
    description: 'Stock moves straight from one agent to another. The warehouse is not involved.',
    submit: 'Transfer stock',
    Icon: ArrowLeftRight,
    from: ['agent'],
    fromLabel: 'From agent',
  },
  return: {
    title: 'Return to warehouse',
    description: 'Use this for failed deliveries and stock an agent no longer needs.',
    submit: 'Return stock',
    Icon: Undo2,
    from: ['agent', 'partner_3pl'],
    fromLabel: 'From',
  },
  adjust: {
    title: 'Adjust quantity',
    description: 'Fix the count after a stock check. Every change needs a reason and is logged.',
    submit: 'Save adjustment',
    Icon: SlidersHorizontal,
    from: ['own_store', 'partner_3pl', 'agent'],
    fromLabel: 'Holder',
  },
};

/** Where the stock can go. A transfer goes agent to agent; a return goes to a store or 3PL; an allocation goes to anyone else. */
const TO_TYPES: Record<Exclude<StockModalKind, 'adjust'>, StockLocationType[]> = {
  allocate: ['agent', 'partner_3pl', 'own_store'],
  transfer: ['agent'],
  return: ['own_store', 'partner_3pl'],
};

const pick = (locations: LocationCard[], types: StockLocationType[], preferred?: number | null, not?: number) => {
  const fit = locations.filter((l) => types.includes(l.type) && l.id !== not);
  return fit.find((l) => l.id === preferred) ?? fit[0];
};

/**
 * Allocate, Transfer, Return and Adjust as one component set (M4-T26, F-655). The quantity limits are the numbers the
 * overview API sends: you cannot send more than the holder has on hand. The server checks again.
 */
export function StockModal({ kind, overview, products, initial, onClose, onDone }: StockModalProps) {
  const copy = COPY[kind];
  const { locations, stockByLocation } = overview;
  const onHand = (locationId: number | undefined, productId: number | undefined): number =>
    stockByLocation.find((r) => r.locationId === locationId && r.productId === productId)?.onHand ?? 0;

  const firstFrom = pick(locations, copy.from, initial?.locationId);
  const [productId, setProductId] = useState<number | undefined>(initial?.productId ?? products[0]?.id);
  const [fromId, setFromId] = useState<number | undefined>(firstFrom?.id);
  const [toId, setToId] = useState<number | undefined>(() =>
    kind === 'adjust' ? undefined : pick(locations, TO_TYPES[kind], null, firstFrom?.id)?.id);
  const [quantity, setQuantity] = useState(() => (kind === 'adjust' ? String(onHand(firstFrom?.id, initial?.productId ?? products[0]?.id)) : ''));
  const [reason, setReason] = useState<ReturnReason | AdjustReason>(kind === 'return' ? 'failed_deliveries' : 'physical_count_correction');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fromOptions = useMemo(() => locations.filter((l) => copy.from.includes(l.type)), [locations, copy.from]);
  const toOptions = useMemo(
    () => (kind === 'adjust' ? [] : locations.filter((l) => TO_TYPES[kind].includes(l.type) && l.id !== fromId)),
    [locations, kind, fromId],
  );
  const have = onHand(fromId, productId);
  const nameOf = (id: number | undefined) => locations.find((l) => l.id === id)?.name ?? '';
  const productName = products.find((p) => p.id === productId)?.name ?? '';

  const qty = quantity.trim() === '' ? null : Number(quantity);
  const whole = qty !== null && Number.isInteger(qty);
  let quantityError: string | undefined;
  if (qty !== null && !whole) quantityError = 'Use a whole number';
  else if (kind === 'adjust' && qty !== null && qty < 0) quantityError = 'Use 0 or more';
  else if (kind !== 'adjust' && qty !== null && qty < 1) quantityError = 'Use 1 or more';
  else if (kind !== 'adjust' && qty !== null && qty > have) quantityError = `Only ${num(have)} on hand`;

  const change = kind === 'adjust' && whole && qty !== null ? qty - have : 0;
  const noteNeeded = kind === 'adjust' && reason === 'other' && !note.trim();
  const ready = productId !== undefined && fromId !== undefined && (kind === 'adjust' || toId !== undefined)
    && qty !== null && !quantityError && (kind === 'adjust' ? change !== 0 && !noteNeeded : true);

  const changeHolder = (id: number) => {
    setFromId(id);
    if (kind === 'adjust') setQuantity(String(onHand(id, productId)));
    else if (toId === id) setToId(pick(locations, TO_TYPES[kind], null, id)?.id);
  };
  const changeProduct = (id: number) => {
    setProductId(id);
    if (kind === 'adjust') setQuantity(String(onHand(fromId, id)));
  };

  const save = async () => {
    if (!ready || productId === undefined || fromId === undefined || qty === null) return;
    setSaving(true);
    setError(null);
    const text = note.trim() || undefined;
    try {
      if (kind === 'adjust') {
        await inventoryService.adjust({ locationId: fromId, productId, newQuantity: qty, reason: reason as AdjustReason, note: text });
        onDone(`${nameOf(fromId)} now holds ${num(qty)} of ${productName}. Reason logged.`);
        return;
      }
      await inventoryService.createTransfer({
        type: kind === 'allocate' ? 'allocation' : kind === 'transfer' ? 'agent_transfer' : 'return_to_warehouse',
        productId, quantity: qty, fromLocationId: fromId, toLocationId: toId!,
        ...(kind === 'return' && { reason: reason as ReturnReason }),
        note: text,
      });
      onDone({
        allocate: `Allocated ${num(qty)} of ${productName} to ${nameOf(toId)}. In transit until they confirm.`,
        transfer: `Sent ${num(qty)} of ${productName} from ${nameOf(fromId)} to ${nameOf(toId)}. In transit until they confirm.`,
        return: `${num(qty)} of ${productName} on the way back from ${nameOf(fromId)}. In transit until it is received.`,
      }[kind]);
    } catch (e) {
      setSaving(false);
      setError(apiErrorMessage(e, 'The stock could not be moved.'));
    }
  };

  const hint = kind === 'adjust'
    ? (change === 0 ? `Now ${num(have)}. No change.` : `Now ${num(have)}. Change of ${change > 0 ? '+' : '−'}${num(Math.abs(change))}.`)
    : `${num(have)} ${kind === 'allocate' ? 'available' : 'on hand'}`;

  const { Icon } = copy;
  return (
    <Modal
      open
      onClose={onClose}
      title={copy.title}
      description={copy.description}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ready || saving} onClick={() => void save()}><Icon />{copy.submit}</Button>
        </>
      }
    >
      <form noValidate className="stockform" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {kind === 'adjust' ? (
          <div className="fg">
            <Select label="Holder" value={fromId ?? ''} onChange={(e) => changeHolder(Number(e.target.value))}>
              {fromOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Select label="Product" value={productId ?? ''} onChange={(e) => changeProduct(Number(e.target.value))}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
        ) : (
          <>
            <Select label="Product" value={productId ?? ''} onChange={(e) => changeProduct(Number(e.target.value))}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <div className="fg">
              <Select label={copy.fromLabel} hint={hint} value={fromId ?? ''} onChange={(e) => changeHolder(Number(e.target.value))}>
                {fromOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
              <Select label={kind === 'transfer' ? 'To agent' : 'To'} value={toId ?? ''} onChange={(e) => setToId(Number(e.target.value))}>
                {toOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </div>
          </>
        )}
        <div className="fg">
          <Input
            label={kind === 'adjust' ? 'New quantity' : 'Quantity'}
            type="number"
            min={kind === 'adjust' ? 0 : 1}
            max={kind === 'adjust' ? undefined : have}
            value={quantity}
            error={quantityError}
            hint={kind === 'adjust' ? hint : undefined}
            onChange={(e) => setQuantity(e.target.value)}
          />
          {kind === 'return' && (
            <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value as ReturnReason)}>
              {RETURN_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </Select>
          )}
          {kind === 'adjust' && (
            <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)}>
              {ADJUST_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </Select>
          )}
        </div>
        {kind === 'allocate' && <p className="hint">Units show as in transit until the agent confirms them.</p>}
        <div className="fl">
          <label htmlFor="stock-note">Note <span className="opt">{kind === 'adjust' && reason === 'other' ? '(required for Other)' : '(optional)'}</span></label>
          <textarea id="stock-note" value={note} placeholder={kind === 'adjust' ? 'For example: Kofi counted on 15 Oct' : 'Pickup time, order numbers, condition'} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p className="err" role="alert">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
