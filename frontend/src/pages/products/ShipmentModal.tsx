import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button, Input, Modal, Select, useToast } from '../../components/ui-v2';
import { shipmentsService, type Shipment, type ShipmentPayload } from '../../services/shipments.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency, getStoreCurrency } from '../../utils/format';
import { effectiveRate, fromShipment, liveLanded, totalOf, type ShipmentFields } from './shipModel';

interface ShipmentModalProps {
  /** The pending shipment being edited, or null to add one. The modal is mounted only while it is open, one per shipment. */
  shipment: Shipment | null;
  /** The active physical products an added shipment can be for. */
  products: Array<{ id: number; name: string }>;
  onClose: () => void;
  onSaved: () => void;
}

type Errors = Partial<Record<keyof ShipmentFields, string>>;

const blank = (store: string, productId: number | undefined): ShipmentFields => ({
  productId: productId == null ? '' : String(productId), supplier: '', quantity: '', currency: store, fxRate: '', unitCost: '', shippingCost: '0', customsDuties: '0', otherCosts: '0', expectedArrivalDate: '', notes: '',
});

/**
 * Add or edit an incoming shipment (M4-T23, F-604, F-605, F-607). One product, one supplier, one currency. The landed cost
 * per unit shows live. For a foreign currency the rate line says which rate applies: the stored rate of the day, or a typed one.
 */
export function ShipmentModal({ shipment, products, onClose, onSaved }: ShipmentModalProps) {
  const say = useToast();
  const store = getStoreCurrency();
  const editing = shipment !== null;
  const [fields, setFields] = useState<ShipmentFields>(() => (shipment ? fromShipment(shipment) : blank(store, products[0]?.id)));
  const [errors, setErrors] = useState<Errors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ShipmentFields>(key: K, value: ShipmentFields[K]) => {
    setFields((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setApiError(null);
  };

  const currency = fields.currency.trim().toUpperCase() || store;
  const foreign = currency !== store;
  const total = totalOf(fields);
  const typedRate = fields.fxRate.trim() !== '' && Number(fields.fxRate) > 0 ? Number(fields.fxRate) : null;
  // The stored rate of an edited shipment applies while its currency stays the same.
  const storedRate = shipment && shipment.currency === currency && shipment.fxRate ? Number(shipment.fxRate) : null;
  const rate = effectiveRate({ foreign, typed: typedRate, stored: storedRate });
  const landed = liveLanded(total, rate, Number(fields.quantity));
  const landedText = landed === null ? '—' : formatCurrency(landed, foreign && rate === null ? currency : store);
  const landedInForeign = foreign && rate === null && landed !== null;

  const lineText = !foreign
    ? null
    : typedRate
      ? `Typed rate: 1 ${currency} = ${typedRate} ${store}. Total ${formatCurrency(total * typedRate, store)}.`
      : storedRate
        ? `Stored rate: 1 ${currency} = ${storedRate} ${store}. Total ${formatCurrency(total * storedRate, store)}.`
        : `The stored rate of the day (1 ${currency} in ${store}) is used when you save. Type a rate to override it.`;

  const check = (): Errors => {
    const e: Errors = {};
    if (!editing && !fields.productId) e.productId = 'Pick a product';
    const q = Number(fields.quantity);
    if (!Number.isInteger(q) || q < 1) e.quantity = 'Quantity must be a whole number above 0';
    if (fields.unitCost.trim() === '' || !(Number(fields.unitCost) >= 0)) e.unitCost = 'Unit cost must be 0 or more';
    for (const key of ['shippingCost', 'customsDuties', 'otherCosts'] as const) if (!(Number(fields[key] || 0) >= 0)) e[key] = 'Must be 0 or more';
    if (!/^[A-Za-z]{3}$/.test(fields.currency.trim())) e.currency = 'Use a 3-letter currency code';
    if (fields.fxRate.trim() !== '' && !(Number(fields.fxRate) > 0)) e.fxRate = 'The rate must be above 0';
    return e;
  };

  const save = async () => {
    const found = check();
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    setApiError(null);
    const body: ShipmentPayload = {
      ...(editing ? {} : { productId: Number(fields.productId) }),
      supplier: fields.supplier.trim(),
      quantity: Number(fields.quantity),
      unitCost: Number(fields.unitCost),
      shippingCost: Number(fields.shippingCost || 0),
      customsDuties: Number(fields.customsDuties || 0),
      otherCosts: Number(fields.otherCosts || 0),
      currency,
      ...(foreign && typedRate ? { fxRate: typedRate } : {}),
      expectedArrivalDate: fields.expectedArrivalDate || null,
      notes: fields.notes.trim(),
    };
    try {
      if (shipment) await shipmentsService.update(shipment.id, body);
      else await shipmentsService.create(body);
      say(editing ? 'Shipment saved' : 'Shipment added');
      onSaved();
      onClose();
    } catch (e) {
      setSaving(false);
      setApiError(apiErrorMessage(e, 'The shipment could not be saved.'));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Edit shipment' : 'Add incoming shipment'}
      description="Record what is on the way and what it costs to land."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}><Check /> Save shipment</Button>
        </>
      }
    >
      <form className="pform" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="fg">
          {editing ? (
            <Input label="Product" value={shipment.product.name} readOnly />
          ) : (
            <Select label="Product" value={fields.productId} error={errors.productId} onChange={(e) => set('productId', e.target.value)}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
          <Input label="Supplier" value={fields.supplier} autoComplete="off" onChange={(e) => set('supplier', e.target.value)} />
        </div>
        <div className="fg three">
          <Input label="Quantity" type="number" min={1} value={fields.quantity} error={errors.quantity} onChange={(e) => set('quantity', e.target.value)} />
          <Input label="Currency" maxLength={3} value={fields.currency} error={errors.currency} autoComplete="off" onChange={(e) => set('currency', e.target.value.toUpperCase())} />
          <Input label="Expected arrival" type="date" optional value={fields.expectedArrivalDate} onChange={(e) => set('expectedArrivalDate', e.target.value)} />
        </div>
        <div className="fg">
          <Input label={`Unit cost (${currency})`} type="number" step="0.01" min={0} value={fields.unitCost} error={errors.unitCost} onChange={(e) => set('unitCost', e.target.value)} />
          <Input label={`Shipping (${currency})`} type="number" step="0.01" min={0} value={fields.shippingCost} error={errors.shippingCost} onChange={(e) => set('shippingCost', e.target.value)} />
          <Input label={`Customs and duties (${currency})`} type="number" step="0.01" min={0} value={fields.customsDuties} error={errors.customsDuties} onChange={(e) => set('customsDuties', e.target.value)} />
          <Input label={`Other costs (${currency})`} type="number" step="0.01" min={0} value={fields.otherCosts} error={errors.otherCosts} onChange={(e) => set('otherCosts', e.target.value)} />
        </div>
        {foreign && (
          <div className="fg">
            <Input label={`Rate (${store} per 1 ${currency})`} type="number" step="any" min={0} optional placeholder={storedRate ? String(storedRate) : 'Stored rate of the day'} value={fields.fxRate} error={errors.fxRate} onChange={(e) => set('fxRate', e.target.value)} />
            <p className="hint" data-testid="rate-line" style={{ alignSelf: 'end' }}>{lineText}</p>
          </div>
        )}
        <div className="fl">
          <label htmlFor="sp-notes">Notes <span className="opt">(optional)</span></label>
          <textarea id="sp-notes" placeholder="Order reference, tracking number" value={fields.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div className="landed">
          <span>
            Landed cost per unit
            {landedInForeign && <small>In {currency}; converted when you save</small>}
          </span>
          <b className="num" data-testid="live-landed">{landedText}</b>
        </div>
        {apiError && <p className="err" role="alert">{apiError}</p>}
      </form>
    </Modal>
  );
}
