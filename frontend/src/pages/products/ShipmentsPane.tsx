import { useMemo, useState } from 'react';
import { Lock, PackagePlus, Pencil, PackageCheck, Trash2, Truck, Wallet } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, Skeleton, Tabs, Tag, Tile, useToast } from '../../components/ui-v2';
import { shipmentsService, type Shipment } from '../../services/shipments.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency } from '../../utils/format';
import { ClaimModal } from './ClaimModal';
import { num } from './model';
import { ReceiveModal } from './ReceiveModal';
import { dayText } from './shipModel';
import { ShipmentModal } from './ShipmentModal';
import { useShipments } from './useShipments';
import type { ShipFilter } from './urlState';

interface ShipmentsPaneProps {
  filter: ShipFilter;
  onFilter: (f: ShipFilter) => void;
  canWrite: boolean;
  /** Set by the page head's "Add shipment" button. */
  adding: boolean;
  onAddingChange: (on: boolean) => void;
  /** After any change: the page reloads the Products table (stock and cost moved). */
  onChanged: () => void;
}

const isReceived = (s: Shipment) => s.status !== 'pending';

/**
 * The Incoming shipments tab (M4-T23, F-604 to F-608): three tiles, tabs, the 15-column table, add / edit / delete for
 * pending shipments, receive and the supplier claim. A received row is locked: no Edit, no Delete.
 */
export function ShipmentsPane({ filter, onFilter, canWrite, adding, onAddingChange, onChanged }: ShipmentsPaneProps) {
  const say = useToast();
  const data = useShipments();
  const [editing, setEditing] = useState<Shipment | null>(null);
  const [deleting, setDeleting] = useState<Shipment | null>(null);
  const [receiving, setReceiving] = useState<Shipment | null>(null);
  const [claiming, setClaiming] = useState<Shipment | null>(null);

  const list = data.list;
  const pending = useMemo(() => (list ?? []).filter((s) => s.status === 'pending'), [list]);
  const received = useMemo(() => (list ?? []).filter(isReceived), [list]);
  const rows = filter === 'pending' ? pending : filter === 'received' ? received : list ?? [];
  const next = useMemo(() => [...pending].filter((s) => s.expectedArrivalDate).sort((a, b) => a.expectedArrivalDate!.localeCompare(b.expectedArrivalDate!))[0], [pending]);
  const store = data.summary?.currency;

  const changed = () => {
    void data.refetch();
    onChanged();
  };

  const remove = async () => {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    try {
      await shipmentsService.remove(target.id);
      say('Shipment deleted');
      changed();
    } catch (e) {
      say(apiErrorMessage(e, 'The shipment could not be deleted.'));
    }
  };

  return (
    <div>
      <div className="grid kpis k3" style={{ marginTop: 0 }}>
        <Tile
          icon={<Truck />}
          tone="violet"
          value={data.summary ? data.summary.pendingCount : '—'}
          label="Pending shipments"
          footer={<><span>{next ? `Next: ${next.product.name}, ${dayText(next.expectedArrivalDate)}` : 'Nothing due'}</span><Tag>Coming</Tag></>}
        />
        <Tile
          icon={<PackagePlus />}
          tone="pine"
          value={data.summary ? data.summary.unitsOnTheWay.toLocaleString('en-GB') : '—'}
          label="Units on the way"
          footer={<><span>Across {new Set(pending.map((s) => s.productId)).size} products</span><Tag>Not in stock yet</Tag></>}
        />
        <Tile
          icon={<Wallet />}
          tone="gold"
          value={data.summary ? formatCurrency(data.summary.costToLand, store) : '—'}
          label="Cost to land them"
          footer={<><span>Product, shipping, customs, other</span><Tag>Total</Tag></>}
        />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="ct">
          <h3>Incoming shipments</h3>
          {canWrite && (
            <Button variant="primary" onClick={() => onAddingChange(true)}>
              <PackagePlus />
              Add shipment
            </Button>
          )}
        </div>
        <Tabs
          label="Shipment status"
          className="ptabs"
          items={[
            { id: 'all', label: 'All', count: list?.length },
            { id: 'pending', label: 'Pending', count: list ? pending.length : undefined },
            { id: 'received', label: 'Received', count: list ? received.length : undefined },
          ]}
          value={filter}
          onChange={(id) => onFilter(id as ShipFilter)}
        />

        {data.loading && !list ? (
          <div style={{ padding: 20 }} aria-busy="true" aria-label="Loading shipments">
            <Skeleton height={44} />
            <Skeleton height={44} className="skelgap" />
          </div>
        ) : data.error && !list ? (
          <EmptyState title={data.error} action={<Button onClick={() => void data.refetch()}>Try again</Button>} />
        ) : rows.length === 0 ? (
          <EmptyState title="No shipments here." />
        ) : (
          <div className="tablewrap">
            <table className="shp" aria-label="Incoming shipments">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Supplier</th>
                  <th className="r">Qty</th>
                  <th className="r">Unit cost</th>
                  <th className="r">Shipping</th>
                  <th className="r">Customs</th>
                  <th className="r">Other</th>
                  <th className="r">Total</th>
                  <th className="r">Landed per unit</th>
                  <th>Expected</th>
                  <th>Received at</th>
                  <th className="r">Counted</th>
                  <th className="r">Short</th>
                  <th>Status</th>
                  <th className="r">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const done = isReceived(s);
                  const cur = s.currency;
                  const foreign = cur !== s.storeCurrency;
                  return (
                    <tr key={s.id} data-shipment={s.id}>
                      <td><b>{s.product.name}</b></td>
                      <td className="wrapcell">{s.supplier ?? '—'}</td>
                      <td className="r num">{s.quantity}</td>
                      <td className="r num">{formatCurrency(s.unitCost, cur)}</td>
                      <td className="r num">{formatCurrency(s.shippingCost, cur)}</td>
                      <td className="r num">{formatCurrency(num(s.customsDuties), cur)}</td>
                      <td className="r num">{formatCurrency(s.otherCosts, cur)}</td>
                      <td className="r num">
                        <b>{formatCurrency(s.totalCostStore, s.storeCurrency)}</b>
                        {foreign && <small data-testid="original-amount">{formatCurrency(s.totalCost, cur)}</small>}
                      </td>
                      <td className="r num"><b>{s.landedCostPerUnit === null ? '—' : formatCurrency(Math.round(s.landedCostPerUnit * 100) / 100, s.storeCurrency)}</b></td>
                      <td>{dayText(s.expectedArrivalDate)}</td>
                      <td className="wrapcell">
                        {done ? <>{s.destinationLocation?.name ?? '—'}<small>{dayText(s.receivedAt)}</small></> : <span style={{ color: 'var(--ink-3)' }}>—</span>}
                      </td>
                      <td className="r num">{done ? s.quantityCounted : <span style={{ color: 'var(--ink-3)' }}>—</span>}</td>
                      <td className="r num">
                        {!done ? <span style={{ color: 'var(--ink-3)' }}>—</span> : (s.shortQuantity ?? 0) > 0 ? <Tag tone="bad">{s.shortQuantity} short</Tag> : '0'}
                      </td>
                      <td>{done ? <Tag tone="ok">Received</Tag> : <Tag tone="v">Pending</Tag>}</td>
                      <td className="r">
                        <span className="acts">
                          {!done ? (
                            canWrite && (
                              <>
                                <Button size="mini" variant="primary" onClick={() => setReceiving(s)}><PackageCheck size={13} /> Receive</Button>
                                <Button size="icon-sm" aria-label={`Edit shipment of ${s.product.name}`} title="Edit" onClick={() => setEditing(s)}><Pencil /></Button>
                                <Button size="icon-sm" aria-label={`Delete shipment of ${s.product.name}`} title="Delete" onClick={() => setDeleting(s)}><Trash2 /></Button>
                              </>
                            )
                          ) : (
                            <>
                              {s.claimStatus !== 'none' && (
                                <Button size="mini" onClick={() => setClaiming(s)}>
                                  {s.claimStatus === 'open' ? `Claim ${formatCurrency(s.claimAmount, s.storeCurrency)}` : s.claimStatus === 'settled' ? 'Claim settled' : 'Claim written off'}
                                </Button>
                              )}
                              <span className="lock" title="Received shipments are locked"><Lock size={14} aria-label="Locked" /> In stock</span>
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="pfoot">
          <span>Landed cost per unit is the total divided by the units counted on arrival (the quantity until then). It updates the product cost when the shipment is received.</span>
          <span>{list ? `Showing ${rows.length} of ${list.length}` : ''}</span>
        </div>
      </div>

      <ShipmentModal open={adding || editing !== null} shipment={editing} onClose={() => { onAddingChange(false); setEditing(null); }} onSaved={changed} />
      <ReceiveModal open={receiving !== null} shipment={receiving} onClose={() => setReceiving(null)} onReceived={() => { setReceiving(null); changed(); }} />
      <ClaimModal open={claiming !== null} shipment={claiming} onClose={() => setClaiming(null)} onChanged={(done) => { setClaiming(done); changed(); }} />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
        action="Delete"
        count={1}
        noun="shipment"
        title={deleting ? `Delete the shipment of ${deleting.product.name}?` : undefined}
      >
        It is not in stock yet, so no stock or ledger entry changes.
      </ConfirmDialog>
    </div>
  );
}

