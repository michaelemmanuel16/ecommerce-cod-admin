import { useMemo } from 'react';
import { History } from 'lucide-react';
import { Button, EmptyState, Table, type Column } from '../../components/ui-v2';
import type { Transfer } from '../../services/inventory.service';
import { shortDate, signedQuantity } from './model';
import { Move, StatusCell, TransferActions } from './TransferParts';

interface RecentTransfersProps {
  transfers: Transfer[];
  canMove: boolean;
  onReceive: (t: Transfer) => void;
  onResolve: (t: Transfer) => void;
  onOpenHistory: (transferId?: number) => void;
}

/** The latest moves (F-654, F-659). The full list with filters is in the history modal. */
export function RecentTransfers({ transfers, canMove, onReceive, onResolve, onOpenHistory }: RecentTransfersProps) {
  const columns = useMemo<Column<Transfer>[]>(() => [
    { key: 'date', header: 'Date', render: (t) => shortDate(t.createdAt) },
    { key: 'move', header: 'Move', render: (t) => <Move transfer={t} /> },
    { key: 'items', header: 'Items', render: (t) => `${t.product.name} \u00d7 ${signedQuantity(t)}` },
    { key: 'status', header: 'Status', render: (t) => <StatusCell transfer={t} /> },
    ...(canMove ? [{ key: 'actions', header: <span className="sr-only">Actions</span>, render: (t: Transfer) => <TransferActions transfer={t} onReceive={onReceive} onResolve={onResolve} /> }] : []),
  ], [canMove, onReceive, onResolve]);

  return (
    <div className="card">
      <div className="ct">
        <h3>Recent transfers</h3>
        <Button size="mini" onClick={() => onOpenHistory()}><History style={{ width: 14, height: 14 }} />View all with filters</Button>
      </div>
      {transfers.length === 0 ? (
        <EmptyState title="No transfers yet." text="Allocate stock to an agent and it shows here." />
      ) : (
        <Table label="Recent transfers" className="tt" columns={columns} rows={transfers} rowKey={(t) => t.id} onRowClick={(t) => onOpenHistory(t.id)} />
      )}
    </div>
  );
}
