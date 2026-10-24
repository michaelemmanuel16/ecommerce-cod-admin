import { useEffect, useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { Button, Input, Modal, Select, useToast } from '../../components/ui-v2';
import { productsService, type StockLocationOption } from '../../services/products.service';
import { shipmentsService, type CountSource, type Shipment } from '../../services/shipments.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency } from '../../utils/format';
import { liveLanded, today } from './shipModel';

interface ReceiveModalProps {
  open: boolean;
  shipment: Shipment | null;
  onClose: () => void;
  onReceived: (shipment: Shipment) => void;
}

const SOURCES: Array<{ id: CountSource; label: string }> = [
  { id: 'own_count', label: 'We counted it' },
  { id: 'three_pl_dashboard', label: '3PL dashboard' },
  { id: 'agent_count', label: 'The agent counted it' },
];

/**
 * Receive shipment (M4-T24, F-606): "Count what arrived before it goes into stock." One save puts the counted units at the
 * holder, sets the landed cost per unit (total in store currency over the units counted) and opens a supplier claim for the short units.
 */
export function ReceiveModal({ open, shipment, onClose, onReceived }: ReceiveModalProps) {
  const say = useToast();
  const [locations, setLocations] = useState<StockLocationOption[]>([]);
  const [locationId, setLocationId] = useState('');
  const [date, setDate] = useState(today());
  const [counted, setCounted] = useState('');
  const [source, setSource] = useState<CountSource>('own_count');
  const [note, setNote] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !shipment) return;
    setDate(today());
    setCounted(String(shipment.quantity));
    setSource('own_count');
    setNote('');
    setRate('');
    setError(null);
    setSaving(false);
  }, [open, shipment]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    productsService.stockLocations().then((list) => {
      if (!live) return;
      setLocations(list);
      setLocationId((cur) => cur || String((list.find((l) => l.type === 'partner_3pl') ?? list[0])?.id ?? ''));
    }, () => setError('The stock holders could not load.'));
    return () => {
      live = false;
    };
  }, [open]);

  if (!shipment) return null;
  const shipped = shipment.quantity;
  const n = counted.trim() === '' ? NaN : Number(counted);
  const valid = Number.isInteger(n) && n >= 0 && n <= shipped;
  const short = valid ? shipped - n : 0;
  const foreign = shipment.currency !== shipment.storeCurrency;
  const typed = rate.trim() !== '' && Number(rate) > 0 ? Number(rate) : null;
  const effectiveRate = !foreign ? 1 : typed ?? (shipment.fxRate ? Number(shipment.fxRate) : null);
  const landed = valid ? liveLanded(shipment.totalCost, effectiveRate, n) : null;

  const save = async () => {
    if (!valid) {
      setError(`Counted must be a whole number from 0 to ${shipped}`);
      return;
    }
    if (!locationId) {
      setError('Pick where the shipment arrived');
      return;
    }
    if (rate.trim() !== '' && !typed) {
      setError('The rate must be above 0');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const done = await shipmentsService.receive(shipment.id, {
        locationId: Number(locationId),
        receivedAt: date,
        quantityCounted: n,
        countSource: source,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(foreign && typed ? { fxRate: typed } : {}),
      });
      say(`${shipment.product.name} added to stock`);
      onReceived(done);
    } catch (e) {
      setSaving(false);
      setError(apiErrorMessage(e, 'The shipment could not be received.'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Receive shipment"
      description={`${shipment.product.name} · ${shipment.supplier ?? 'No supplier'}. Count what arrived before it goes into stock.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}><PackageCheck /> Save and add to stock</Button>
        </>
      }
    >
      <form className="pform" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="fg">
          <Select label="Received at" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Input label="Received date" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
          <Input label="Units shipped" type="number" value={shipped} readOnly />
          <Input label="Units counted" type="number" min={0} max={shipped} inputMode="numeric" value={counted} onChange={(e) => { setCounted(e.target.value); setError(null); }} />
          <Select label="Counted by" value={source} onChange={(e) => setSource(e.target.value as CountSource)}>
            {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
          {foreign && (
            <Input
              label={`Rate (${shipment.storeCurrency} per 1 ${shipment.currency})`}
              type="number"
              step="any"
              min={0}
              optional
              placeholder="Rate of the received date"
              hint="Leave empty to use the stored rate of the received date."
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          )}
        </div>
        <div className={short > 0 ? 'landed bad' : 'landed'}>
          <span>Short or damaged</span>
          <b className="num" data-testid="live-short">{valid ? `${short} ${short === 1 ? 'unit' : 'units'}` : '—'}</b>
        </div>
        <div className="fl">
          <label htmlFor="rv-note">Note <span className="opt">(optional)</span></label>
          <textarea id="rv-note" placeholder="For example: two cartons wet, photos sent to the supplier" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="landed">
          <span>
            Landed cost per unit
            {foreign && !typed && <small>At the stored rate; the received date&rsquo;s rate sets the final cost</small>}
            {foreign && effectiveRate === null && <small>{shipment.currency} amount; converted when you save</small>}
          </span>
          <b className="num" data-testid="live-landed">
            {landed === null ? '—' : formatCurrency(landed, foreign && effectiveRate === null ? shipment.currency : shipment.storeCurrency)}
          </b>
        </div>
        {error && <p className="err" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
