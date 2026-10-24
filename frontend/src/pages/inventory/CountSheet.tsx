import { useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Button, Drawer, Input, Select, Tag } from '../../components/ui-v2';
import {
  inventoryService, type CountLine, type CountReason, type CountSource, type Overview, type PhysicalProduct, type ReceivedShipment, type StockCount,
} from '../../services/inventory.service';
import { apiErrorMessage } from '../../utils/apiError';
import { COUNT_REASONS, COUNT_SOURCES, DEFAULT_SOURCE, REASON_LABEL, shortDate, SOURCE_LABEL, today } from './model';
import { count } from '../deliveries/model';

interface CountSheetProps {
  open: boolean;
  overview: Overview;
  products: PhysicalProduct[];
  /** Location to start with (a card's holder). The page mounts a new sheet, keyed, for each opening, so the fields start fresh. */
  initialLocationId?: number | null;
  onClose: () => void;
  /** The sheet closed after a count was saved or a line applied: the page refreshes its cards and table, once. */
  onChanged: () => void;
}

interface Row {
  productId: number;
  name: string;
  records: number;
  /** The text in the box; '' while the person clears it. */
  counted: string;
}

const diffText = (d: number): string => (d === 0 ? 'Matches' : `${d > 0 ? '+' : '−'}${count(Math.abs(d))}`);

/**
 * "Start stock count" (M4-T27, F-653). Step 1: pick the location, the date and the source, type what was counted per product.
 * Step 2, after the save: every line with a difference is applied to our records ("Apply count", with a reason) or left alone
 * ("Keep investigating", no call). Agents do not count in the app (F-653): an owner enters an agent's count here by hand.
 */
export function CountSheet({ open, overview, products, initialLocationId, onClose, onChanged }: CountSheetProps) {
  const locations = overview.locations;
  const rowsFor = (id: number | undefined): Row[] =>
    overview.stockByLocation
      .filter((r) => r.locationId === id && (r.onHand !== 0 || r.count !== null))
      .map((r) => ({ productId: r.productId, name: r.productName, records: r.onHand, counted: String(r.onHand) }));

  const first = locations.find((l) => l.id === initialLocationId) ?? locations[0];
  const [locationId, setLocationId] = useState<number | undefined>(first?.id);
  const [date, setDate] = useState(today());
  const [source, setSource] = useState<CountSource>(first ? DEFAULT_SOURCE[first.type] : 'own_count');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>(() => rowsFor(first?.id));
  const [adding, setAdding] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<StockCount | null>(null);
  /** Something was saved or applied: the page reloads once, when the sheet closes. */
  const [dirty, setDirty] = useState(false);

  const close = () => {
    onClose();
    if (dirty) onChanged();
  };

  const changeLocation = (id: number) => {
    const type = locations.find((l) => l.id === id)?.type;
    setLocationId(id);
    if (type) setSource(DEFAULT_SOURCE[type]);
    setRows(rowsFor(id));
  };

  const addable = products.filter((p) => !rows.some((r) => r.productId === p.id));
  const add = (id: number) => {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const records = overview.stockByLocation.find((r) => r.locationId === locationId && r.productId === id)?.onHand ?? 0;
    setRows((rs) => [...rs, { productId: id, name: p.name, records, counted: String(records) }]);
    setAdding('');
  };

  const countedOf = (r: Row): number | null => (r.counted.trim() === '' || !Number.isInteger(Number(r.counted)) || Number(r.counted) < 0 ? null : Number(r.counted));
  const ready = locationId !== undefined && rows.length > 0 && rows.every((r) => countedOf(r) !== null) && date !== '' && date <= today();
  const off = rows.reduce((sum, r) => sum + Math.abs((countedOf(r) ?? r.records) - r.records), 0);

  const save = async () => {
    if (!ready || locationId === undefined) return;
    setSaving(true);
    setError(null);
    try {
      const made = await inventoryService.createCount({
        locationId, countDate: date, source, ...(note.trim() && { note: note.trim() }),
        lines: rows.map((r) => ({ productId: r.productId, countedQuantity: countedOf(r)! })),
      });
      setSaved(made);
      setDirty(true);
    } catch (e) {
      setError(apiErrorMessage(e, 'The count could not be saved.'));
    }
    setSaving(false);
  };

  return (
    <Drawer
      open={open}
      onClose={close}
      title={saved ? 'Stock count saved' : 'Start a stock count'}
      description={saved ? `${saved.location.name}, ${shortDate(saved.countDate.slice(0, 10))}. Decide what to do with each difference.` : 'Count what is on the shelf. Differences are logged and open a finding.'}
      footer={
        saved ? (
          <Button variant="primary" onClick={close}>Done</Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={!ready || saving} onClick={() => void save()}><Check />Save count</Button>
          </>
        )
      }
    >
      {saved ? (
        <SavedCount saved={saved} onApplied={(next) => { setSaved(next); setDirty(true); }} />
      ) : (
        <>
          <div className="fg">
            <Select label="Location" value={locationId ?? ''} onChange={(e) => changeLocation(Number(e.target.value))}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Input label="Count date" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            <Select label="Who counted" value={source} onChange={(e) => setSource(e.target.value as CountSource)}>
              {COUNT_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </Select>
            <Input label="Note" optional value={note} placeholder="For example: Logiswift list of 15 Oct" onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="tablewrap">
            <table className="st countrows" aria-label="Counted quantities">
              <thead>
                <tr><th>Product</th><th className="r">Our records</th><th className="r">Counted</th><th className="r">Difference</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const c = countedOf(r);
                  const d = c === null ? 0 : c - r.records;
                  return (
                    <tr key={r.productId}>
                      <td>{r.name}</td>
                      <td className="r num">{count(r.records)}</td>
                      <td className="r">
                        <input
                          type="number" min={0} value={r.counted} aria-label={`Counted ${r.name}`} aria-invalid={c === null}
                          onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, counted: e.target.value } : x)))}
                        />
                      </td>
                      <td className={d === 0 ? 'r num' : 'r num bad'}>{c === null ? '—' : diffText(d)}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={4} className="mut">No stock recorded here yet. Add the products you counted.</td></tr>}
              </tbody>
            </table>
          </div>
          {addable.length > 0 && (
            <div className="addrow">
              <Select compact label="Add a product" value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">Add a product…</option>
                {addable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Button size="mini" disabled={adding === ''} onClick={() => add(Number(adding))}><Plus />Add</Button>
            </div>
          )}
          <p className="hint">{off === 0 ? 'Everything matches so far.' : `${count(off)} ${off === 1 ? 'unit differs' : 'units differ'} from our records.`}</p>
          {error && <p className="err" role="alert">{error}</p>}
        </>
      )}
    </Drawer>
  );
}

interface SavedCountProps {
  saved: StockCount;
  onApplied: (count: StockCount) => void;
}

/** Step 2: one block per line with a difference. */
function SavedCount({ saved, onApplied }: SavedCountProps) {
  const gaps = saved.lines.filter((l) => l.difference !== 0);
  const matching = saved.lines.length - gaps.length;
  return (
    <div className="countresult">
      <p className="hint">{gaps.length === 0 ? 'Everything matches. Nothing to apply.' : `${gaps.length} ${gaps.length === 1 ? 'line differs' : 'lines differ'}. ${matching} ${matching === 1 ? 'matches' : 'match'}.`}</p>
      {gaps.map((line) => <CountLineBlock key={line.id} countId={saved.id} line={line} onApplied={onApplied} />)}
    </div>
  );
}

function CountLineBlock({ countId, line, onApplied }: { countId: number; line: CountLine; onApplied: (c: StockCount) => void }) {
  const short = line.difference < 0;
  const options = COUNT_REASONS.filter((r) => short || r !== 'short_on_arrival');
  const [reason, setReason] = useState<CountReason>(short ? 'physical_count_correction' : 'found_extra_stock');
  const [shipments, setShipments] = useState<ReceivedShipment[]>([]);
  const [shipmentId, setShipmentId] = useState('');
  const [note, setNote] = useState('');
  const [kept, setKept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (reason !== 'short_on_arrival') return;
    let live = true;
    inventoryService.receivedShipments(line.productId).then((s) => live && setShipments(s)).catch(() => live && setShipments([]));
    return () => { live = false; };
  }, [reason, line.productId]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await inventoryService.applyCountLine(countId, line.id, {
        reason,
        ...(reason === 'short_on_arrival' && shipmentId !== '' && { shipmentId: Number(shipmentId) }),
        ...(note.trim() && { note: note.trim() }),
      });
      if (result.warning) setWarning(result.warning);
      onApplied(result.count);
    } catch (e) {
      setError(apiErrorMessage(e, 'The count could not be applied.'));
    }
    setBusy(false);
  };

  const gap = Math.abs(line.difference);
  return (
    <section className="card countline" aria-label={line.product.name}>
      <div className="cl-head">
        <b>{line.product.name}</b>
        <Tag tone={line.applied ? 'ok' : 'bad'}>{line.applied ? 'Applied' : `${diffText(line.difference)} ${gap === 1 ? 'unit' : 'units'}`}</Tag>
      </div>
      <p className="cl-sub">Our records said {count(line.systemQuantity)}. Counted {count(line.countedQuantity)}.</p>
      {line.applied ? (
        <p className="cl-sub">Our records now say {count(line.countedQuantity)}.{warning ? ` ${warning}` : ''}</p>
      ) : kept ? (
        <p className="cl-sub">Kept as it is. The finding stays open until you apply the count or explain the gap.</p>
      ) : (
        <>
          <div className="fg">
            <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value as CountReason)}>
              {options.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </Select>
            {reason === 'short_on_arrival' ? (
              <Select label="Shipment" value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} hint="Optional. The shipment that arrived short.">
                <option value="">Not sure</option>
                {shipments.map((s) => <option key={s.id} value={s.id}>{`Shipment ${s.id}${s.receivedAt ? `, ${shortDate(s.receivedAt)}` : ''}, ${count(s.quantity)} sent`}</option>)}
              </Select>
            ) : (
              <Input label="Note" optional={reason !== 'other'} hint={reason === 'other' ? 'Needed for Other.' : undefined} value={note} onChange={(e) => setNote(e.target.value)} />
            )}
          </div>
          {error && <p className="err" role="alert">{error}</p>}
          <div className="cl-actions">
            <Button variant="primary" size="mini" disabled={busy || (reason === 'other' && !note.trim())} onClick={() => void apply()}>Apply count</Button>
            <Button size="mini" onClick={() => setKept(true)}>Keep investigating</Button>
          </div>
        </>
      )}
    </section>
  );
}
