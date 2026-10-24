import { useState } from 'react';
import { PackagePlus, Truck, Wallet } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, Skeleton, Table, Tabs, Tag, Tile, useToast } from '../../components/ui-v2';
import { shipmentsService, type Shipment } from '../../services/shipments.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency } from '../../utils/format';
import { ClaimModal } from './ClaimModal';
import { shortDay } from './model';
import { ReceiveModal } from './ReceiveModal';
import { shipmentColumns } from './shipmentColumns';
import { isReceived } from './shipModel';
import { ShipmentModal } from './ShipmentModal';
import { useShipments } from './useShipments';
import type { ShipFilter } from './urlState';

interface ShipmentsPaneProps {
  filter: ShipFilter;
  onFilter: (f: ShipFilter) => void;
  canWrite: boolean;
  /** The active physical products the add modal offers. */
  products: Array<{ id: number; name: string }>;
  /** Set by the page head's "Add shipment" button. */
  adding: boolean;
  onAddingChange: (on: boolean) => void;
  /** After a receive or a delete: stock and cost moved, so the page reloads the Products table. */
  onStockChanged: () => void;
}

/**
 * The Incoming shipments tab (M4-T23, F-604 to F-608): three tiles, tabs, the 15-column table, add / edit / delete for
 * pending shipments, receive and the supplier claim. A received row is locked: no Edit, no Delete.
 */
export function ShipmentsPane({ filter, onFilter, canWrite, products, adding, onAddingChange, onStockChanged }: ShipmentsPaneProps) {
  const say = useToast();
  const data = useShipments();
  const [editing, setEditing] = useState<Shipment | null>(null);
  const [deleting, setDeleting] = useState<Shipment | null>(null);
  const [receiving, setReceiving] = useState<Shipment | null>(null);
  const [claiming, setClaiming] = useState<Shipment | null>(null);

  const list = data.list;
  const pending = (list ?? []).filter((s) => !isReceived(s));
  const received = (list ?? []).filter(isReceived);
  const rows = filter === 'pending' ? pending : filter === 'received' ? received : list ?? [];
  const next = pending.filter((s) => s.expectedArrivalDate).sort((a, b) => a.expectedArrivalDate!.localeCompare(b.expectedArrivalDate!))[0];
  const store = data.summary?.currency;

  const remove = async () => {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    try {
      await shipmentsService.remove(target.id);
      say('Shipment deleted');
      void data.refetch();
      onStockChanged();
    } catch (e) {
      say(apiErrorMessage(e, 'The shipment could not be deleted.'));
    }
  };

  const columns = shipmentColumns({ canWrite, onReceive: setReceiving, onEdit: setEditing, onDelete: setDeleting, onClaim: setClaiming });

  return (
    <div>
      <div className="grid kpis k3" style={{ marginTop: 0 }}>
        <Tile
          icon={<Truck />}
          tone="violet"
          value={data.summary ? data.summary.pendingCount : '—'}
          label="Pending shipments"
          footer={<><span>{next ? `Next: ${next.product.name}, ${shortDay(next.expectedArrivalDate)}` : 'Nothing due'}</span><Tag>Coming</Tag></>}
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
          <Table label="Incoming shipments" className="shp" columns={columns} rows={rows} rowKey={(s) => s.id} />
        )}
        <div className="pfoot">
          <span>Landed cost per unit is the total divided by the units counted on arrival (the quantity until then). It updates the product cost when the shipment is received.</span>
          <span>{list ? `Showing ${rows.length} of ${list.length}` : ''}</span>
        </div>
      </div>

      {(adding || editing) && (
        <ShipmentModal
          key={editing?.id ?? 'new'}
          shipment={editing}
          products={products}
          onClose={() => { onAddingChange(false); setEditing(null); }}
          onSaved={() => void data.refetch()}
        />
      )}
      {receiving && (
        <ReceiveModal key={receiving.id} shipment={receiving} onClose={() => setReceiving(null)} onReceived={() => { setReceiving(null); void data.refetch(); onStockChanged(); }} />
      )}
      {claiming && <ClaimModal key={claiming.id} shipment={claiming} onClose={() => setClaiming(null)} onChanged={(done) => { setClaiming(done); void data.refetch(); }} />}
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
