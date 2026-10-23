import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Check, Plus, X } from 'lucide-react';
import { Button, Drawer, Input, Select, useToast } from '../../components/ui-v2';
import { TownSelect } from '../../components/forms/TownSelect';
import { useTowns } from '../../hooks/useTowns';
import { customersService } from '../../services/customers.service';
import { ordersService } from '../../services/orders.service';
import { productsService } from '../../services/products.service';
import { useConfigStore } from '../../stores/configStore';
import type { Product } from '../../types';
import { apiErrorMessage } from '../../utils/apiError';
import { getCountryByCurrency, getCurrencySymbol, getRegionsForCountry } from '../../utils/countries';
import { formatCurrency, formatPhoneLocal } from '../../utils/format';
import type { Option } from './useFilterOptions';
import { phoneOk } from '../../utils/phone';
import { asNumber, computedTotal, linesSum, totalGap, unitsByProduct, type DraftLine } from './newOrder';

interface NewOrderSheetProps {
  open: boolean;
  /** Called for the X, Cancel, Escape, the scrim and after a create. */
  onClose: () => void;
  /** After a create: the list re-reads. */
  onCreated: () => void;
  /** `/orders?new=1&customerId=`: prefill this customer. */
  customerId?: number | null;
  /** Call rep and Delivery agent fields show only when the person has `orders:assign`. */
  canAssign: boolean;
  reps: Option[];
  agents: Option[];
}

interface Known {
  id: number;
  name: string;
  totalOrders: number;
  codBlocked: boolean;
}

interface Form {
  name: string;
  phone: string;
  alternatePhone: string;
  email: string;
  address: string;
  region: string;
  town: string;
  landmark: string;
  discount: string;
  /** null: the total follows the lines. */
  total: string | null;
  notes: string;
  repId: string;
  agentId: string;
  confirmed: boolean;
}

const EMPTY: Form = {
  name: '', phone: '', alternatePhone: '', email: '', address: '', region: '', town: '', landmark: '',
  discount: '', total: null, notes: '', repId: '', agentId: '', confirmed: false,
};

let nextKey = 1;
const blankLine = (): DraftLine => ({ key: nextKey++, productId: null, qty: '1', price: '' });
const available = (p: Product | undefined): number => (p ? p.stockQuantity ?? p.stock ?? 0 : 0);
const messageOf = (e: unknown): string => apiErrorMessage(e, 'The order could not be created');

/**
 * The New order side sheet (M3-T45, F-317), built from docs/mockups/v2/index.html#sh-new. There is no status field:
 * every manual order starts at pending_confirmation. The tick "Customer already confirmed on this call" asks the
 * server to move it to confirmed through the machine.
 */
export function NewOrderSheet({ open, onClose, onCreated, customerId, canAssign, reps, agents }: NewOrderSheetProps) {
  const say = useToast();
  const currency = useConfigStore((s) => s.currency);
  const regions = useMemo(() => getRegionsForCountry(getCountryByCurrency(currency)), [currency]);
  const [form, setForm] = useState<Form>(EMPTY);
  const { towns, loading: townsLoading } = useTowns(form.region);
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()]);
  const [products, setProducts] = useState<Product[]>([]);
  const [known, setKnown] = useState<Known | null>(null);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');

  // Nothing is drawn until the first open, so the closed page holds no hidden form fields.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  // Each open starts clean; a customer link fills the contact and address.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setForm(EMPTY);
    setLines([blankLine()]);
    setKnown(null);
    setTried(false);
    setFailure('');
    productsService.getProducts()
      .then((ps) => live && setProducts(ps.filter((p) => p.isActive !== false)))
      .catch(() => undefined);
    if (customerId) {
      customersService.getForOrder(customerId)
        .then((c) => live && setForm((f) => ({ ...f, name: c.name, phone: formatPhoneLocal(c.phone), alternatePhone: c.alternatePhone && formatPhoneLocal(c.alternatePhone), email: c.email, address: c.address, region: c.region, town: c.town, landmark: c.landmark })))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [open, customerId]);

  // A phone that matches a customer links the order to them (F-317, F-362).
  useEffect(() => {
    if (!open || !phoneOk(form.phone)) {
      setKnown(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      customersService.findByPhone(form.phone).then((c) => live && setKnown(c)).catch(() => live && setKnown(null));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, form.phone]);

  const productOf = (id: number | null) => products.find((p) => p.id === id);
  const computed = computedTotal(lines, form.discount);
  const total = form.total === null ? computed : asNumber(form.total);
  const gap = totalGap(total, computed);
  const asked = unitsByProduct(lines);

  const setLine = (key: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickProduct = (key: number, id: string) => {
    const p = productOf(Number(id));
    setLine(key, { productId: p ? p.id : null, price: p ? String(p.price) : '' });
  };

  const stockProblem = (l: DraftLine): string => {
    const p = productOf(l.productId);
    if (!p) return '';
    const have = available(p);
    return (asked.get(p.id) ?? 0) > have ? `Only ${have} available.` : '';
  };
  const lineProblem = (l: DraftLine): string => {
    if (!l.productId) return tried ? 'Choose a product.' : '';
    const q = asNumber(l.qty);
    if (!Number.isInteger(q) || q < 1) return tried ? 'Quantity must be 1 or more.' : '';
    return stockProblem(l);
  };

  const problems = {
    name: !form.name.trim() ? 'Enter the customer name.' : '',
    phone: !phoneOk(form.phone) ? 'Phone number needs at least 9 digits.' : '',
    address: !form.address.trim() ? 'Enter the delivery address.' : '',
    region: !form.region ? 'Choose a state.' : '',
    town: !form.town.trim() ? 'Choose or type the city/town.' : '',
    total: form.total !== null && (form.total.trim() === '' || asNumber(form.total) < 0) ? 'Enter the order total.' : '',
  };
  const lineOk = (l: DraftLine) => !!l.productId && Number.isInteger(asNumber(l.qty)) && asNumber(l.qty) >= 1 && !stockProblem(l);
  const blocked = Object.values(problems).some(Boolean) || !lines.every(lineOk);
  const shown = (key: keyof typeof problems) => (tried ? problems[key] : '');

  const create = async () => {
    setTried(true);
    setFailure('');
    if (blocked) return;
    setSaving(true);
    try {
      const order = await ordersService.createManualOrder({
        customerName: form.name.trim(),
        customerPhone: form.phone.trim(),
        ...(form.alternatePhone.trim() && { alternatePhone: form.alternatePhone.trim() }),
        ...(form.email.trim() && { customerEmail: form.email.trim() }),
        deliveryAddress: form.address.trim(),
        deliveryState: form.region,
        deliveryArea: form.town.trim(),
        ...(form.landmark.trim() && { landmark: form.landmark.trim() }),
        orderItems: lines.map((l) => ({ productId: l.productId!, quantity: asNumber(l.qty), unitPrice: asNumber(l.price) })),
        subtotal: linesSum(lines),
        discount: asNumber(form.discount),
        totalAmount: total,
        ...(form.notes.trim() && { notes: form.notes.trim() }),
        customerConfirmed: form.confirmed,
        ...(canAssign && form.repId && { customerRepId: Number(form.repId) }),
        ...(canAssign && form.agentId && { deliveryAgentId: Number(form.agentId) }),
      });
      say(`Order ${order.orderNumber || `#${order.id}`} created`);
      onCreated();
      onClose();
    } catch (e) {
      setFailure(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  if (!mounted) return null;

  const regionList = form.region && !regions.includes(form.region) ? [form.region, ...regions] : regions;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New order"
      description="Add an order by hand, for example from a phone call or WhatsApp chat."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void create()} disabled={saving}>
            <Check />
            Create order
          </Button>
        </>
      }
    >
      <div className="sec">
        <h4>Customer</h4>
        <div className="fg">
          <Input label="Customer name" placeholder="For example: Abena Owusu" value={form.name} onChange={(e) => set('name', e.target.value)} error={shown('name')} />
          <Input label="Phone" type="tel" placeholder="024 555 0182" value={form.phone} onChange={(e) => set('phone', e.target.value)} error={shown('phone')} />
          {known && (
            <div className="full no-note" role="status">
              Existing customer: <Link to={`/customers/${known.id}`}>{known.name}</Link>, {known.totalOrders} {known.totalOrders === 1 ? 'order' : 'orders'}
              {known.codBlocked && (
                <b className="no-cod">COD is off for this customer. Call them before you confirm this order.</b>
              )}
            </div>
          )}
          <Input label="Alternate phone" optional type="tel" value={form.alternatePhone} onChange={(e) => set('alternatePhone', e.target.value)} />
          <Input label="Email" optional type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          <div className="fl full">
            <label htmlFor="no-address">Delivery address</label>
            <textarea
              id="no-address"
              placeholder="House number, street, landmark"
              style={{ minHeight: 56 }}
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              aria-invalid={shown('address') ? true : undefined}
            />
            {shown('address') && <p className="err">{shown('address')}</p>}
          </div>
          <Select label="State" value={form.region} onChange={(e) => set('region', e.target.value)} error={shown('region')}>
            <option value="">Choose a state</option>
            {regionList.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
          <TownSelect state={form.region} value={form.town} onChange={(v) => set('town', v)} towns={towns} loading={townsLoading} error={shown('town')} />
          <Input className="full" label="Nearest landmark" optional placeholder="e.g. Opposite Kasoa Total station" value={form.landmark} onChange={(e) => set('landmark', e.target.value)} />
        </div>
      </div>

      <div className="sec">
        <h4>
          Products
          <Button size="mini" onClick={() => setLines((ls) => [...ls, blankLine()])}>
            <Plus style={{ width: 13, height: 13, verticalAlign: -2 }} /> Add product line
          </Button>
        </h4>
        {lines.map((l, i) => {
          const problem = lineProblem(l);
          return (
            <div key={l.key} className="no-line">
              <div className="nl">
                <Select label="Product" value={l.productId ?? ''} onChange={(e) => pickProduct(l.key, e.target.value)}>
                  <option value="">Choose a product</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
                <Input label="Qty" type="number" min={1} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                <Input label="Price" type="number" min={0} value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} />
                <Button
                  size="icon-sm"
                  aria-label={`Remove line ${i + 1}`}
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  style={{ marginBottom: 4 }}
                >
                  <X />
                </Button>
              </div>
              {problem && <p className="err">{problem}</p>}
            </div>
          );
        })}
      </div>

      <div className="sec">
        <h4>Price</h4>
        <div className="fg">
          <Input label="Discount" optional type="number" min={0} value={form.discount} onChange={(e) => set('discount', e.target.value)} />
          <div>
            <Input
              label={`Order total (${getCurrencySymbol(currency)})`}
              type="number"
              min={0}
              value={form.total === null ? String(computed) : form.total}
              onChange={(e) => set('total', e.target.value)}
              error={shown('total')}
              hint={gap ? undefined : 'Adds up from the lines. Change it to give a discount.'}
            />
            {gap > 0 && (
              <p className="hint no-gap" role="status">
                Total differs from the lines by {formatCurrency(gap)}. Write the reason in the notes.
              </p>
            )}
          </div>
          {canAssign && (
            <>
              <Select label="Call rep" value={form.repId} onChange={(e) => set('repId', e.target.value)}>
                <option value="">Assign later</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
              <Select label="Delivery agent" value={form.agentId} onChange={(e) => set('agentId', e.target.value)}>
                <option value="">Assign later</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.unavailable ? `${a.name} (unavailable)` : a.name}</option>
                ))}
              </Select>
            </>
          )}
          <div className="fl full">
            <label htmlFor="no-notes">Notes <span className="opt">(optional)</span></label>
            <textarea id="no-notes" style={{ minHeight: 56 }} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </div>
      </div>

      <label className="chk">
        <input type="checkbox" checked={form.confirmed} onChange={(e) => set('confirmed', e.target.checked)} />
        Customer already confirmed on this call
      </label>
      {failure && <p className="err" role="alert">{failure}</p>}
    </Drawer>
  );
}
