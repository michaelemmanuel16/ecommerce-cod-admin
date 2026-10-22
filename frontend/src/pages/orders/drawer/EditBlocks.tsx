import { Plus, X } from 'lucide-react';
import { Button, Input, Select } from '../../../components/ui-v2';
import { formatCurrency } from '../../../utils/format';
import { editGroup, linesTotal, type EditDraft } from './model';
import type { OrderStatus } from '../../../types';
import type { Option } from '../useFilterOptions';

interface EditProps {
  status: OrderStatus;
  draft: EditDraft;
  set: (patch: Partial<EditDraft>) => void;
}

/** Customer block in edit mode (F-318): the status group decides which inputs are open. */
export function CustomerEdit({ status, draft, set }: EditProps) {
  const group = editGroup(status);
  const open = group !== 'notes';
  const full = group === 'full';
  return (
    <div className="sec">
      <h4>Customer</h4>
      <div className="fg">
        <Input label="Name" value={draft.name} disabled={!full} onChange={(e) => set({ name: e.target.value })} />
        <Input label="Phone" value={draft.phone} disabled={!open} inputMode="tel" onChange={(e) => set({ phone: e.target.value })} />
        <Input label="Alternate phone" optional value={draft.altPhone} disabled={!open} inputMode="tel" onChange={(e) => set({ altPhone: e.target.value })} />
        <Input label="Email" optional value={draft.email} disabled={!full} type="email" onChange={(e) => set({ email: e.target.value })} />
        <div className="fl full">
          <label htmlFor="ed-addr">Delivery address</label>
          <textarea id="ed-addr" value={draft.address} disabled={!open} style={{ minHeight: 56 }} onChange={(e) => set({ address: e.target.value })} />
        </div>
        <Input label="State" value={draft.region} disabled={!open} onChange={(e) => set({ region: e.target.value })} />
        <Input label="City/Town" value={draft.town} disabled={!open} onChange={(e) => set({ town: e.target.value })} />
        <div className="fl full">
          <label htmlFor="ed-notes">Notes</label>
          <textarea id="ed-notes" value={draft.notes} style={{ minHeight: 56 }} onChange={(e) => set({ notes: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

interface ItemsEditProps extends EditProps {
  products: Option[];
}

/** Items block in edit mode: add, remove, quantity and price per line, only before dispatch. */
export function ItemsEdit({ status, draft, set, products }: ItemsEditProps) {
  if (editGroup(status) !== 'full') return null;
  const change = (key: string, patch: Partial<EditDraft['items'][number]>) =>
    set({ items: draft.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  const add = () => {
    const first = products[0];
    if (!first) return;
    set({ items: [...draft.items, { key: `n${Date.now()}`, productId: first.id, name: first.name, quantity: '1', unitPrice: '0' }] });
  };
  return (
    <div className="sec">
      <h4>
        Items
        <Button size="mini" onClick={add} disabled={products.length === 0}>
          <Plus aria-hidden="true" style={{ width: 13, height: 13, verticalAlign: -2 }} /> Add product line
        </Button>
      </h4>
      {draft.items.map((i, n) => {
        const known = products.some((p) => p.id === i.productId);
        return (
          <div className="nl" key={i.key}>
            <Select
              label="Product"
              value={i.productId}
              onChange={(e) => change(i.key, { productId: Number(e.target.value), name: products.find((p) => p.id === Number(e.target.value))?.name ?? i.name })}
            >
              {!known && <option value={i.productId}>{i.name}</option>}
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
            <Input label="Qty" type="number" min={1} value={i.quantity} onChange={(e) => change(i.key, { quantity: e.target.value })} />
            <Input label="Price" type="number" min={0} value={i.unitPrice} onChange={(e) => change(i.key, { unitPrice: e.target.value })} />
            <Button
              size="icon-sm"
              aria-label={`Remove line ${n + 1}`}
              style={{ marginBottom: 4 }}
              disabled={draft.items.length === 1}
              onClick={() => set({ items: draft.items.filter((x) => x.key !== i.key) })}
            >
              <X />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

/** Payment block in edit mode: discount and total, before dispatch. The total follows the lines until the person types it. */
export function PaymentEdit({ status, draft, set }: EditProps) {
  if (editGroup(status) !== 'full') return null;
  const total = draft.totalTouched ? draft.total : String(linesTotal(draft));
  return (
    <div className="sec">
      <h4>Payment</h4>
      <div className="fg">
        <Input label="Discount" type="number" min={0} value={draft.discount} onChange={(e) => set({ discount: e.target.value })} />
        <Input
          label="Order total"
          type="number"
          min={0}
          value={total}
          hint={`Adds up from the lines: ${formatCurrency(linesTotal(draft))}. Change it to give a discount.`}
          onChange={(e) => set({ total: e.target.value, totalTouched: true })}
        />
      </div>
    </div>
  );
}
