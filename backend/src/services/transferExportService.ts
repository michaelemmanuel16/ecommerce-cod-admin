import { TransferStatus, TransferType } from '@prisma/client';
import prisma from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { transferBatches, type TransferFilters } from './inventoryReadService';

const COLUMNS = ['Date', 'Type', 'From', 'To', 'Product', 'SKU', 'Quantity', 'Status', 'Counted', 'Reason', 'Order', 'Started by', 'Note'] as const;
const STATUS: Record<TransferStatus, string> = { in_transit: 'In transit', received: 'Received', disputed: 'Received short', cancelled: 'Cancelled' };
const SOLO: TransferType[] = ['adjustment', 'count_adjustment'];

/** "short_in_package" -> "Short in package" */
const humanize = (v: string): string => (v.charAt(0).toUpperCase() + v.slice(1)).replace(/_/g, ' ');

/** A text cell: quoted, with a leading = + - @ (or tab / return) defused so a spreadsheet never runs it as a formula. */
export function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

interface Row {
  createdAt: Date; transferType: TransferType; status: TransferStatus; quantity: number; receivedQuantity: number | null;
  reason: string | null; orderId: number | null; notes: string | null;
  product: { name: string; sku: string };
  fromLocation: { name: string } | null; toLocation: { name: string } | null;
  createdBy: { firstName: string; lastName: string };
}

function line(t: Row): string {
  const from = t.fromLocation?.name ?? (t.transferType === 'receipt' ? 'Supplier' : '');
  const to = t.toLocation?.name ?? (t.transferType === 'order_fulfillment' ? 'Customer' : '');
  // An adjustment out of a place is a negative number; every other move is the unsigned quantity
  const quantity = SOLO.includes(t.transferType) && t.fromLocation && !t.toLocation ? -t.quantity : t.quantity;
  return [
    csvText(t.createdAt.toISOString()), csvText(humanize(t.transferType)), csvText(from), csvText(to), csvText(t.product.name), csvText(t.product.sku),
    String(quantity), csvText(STATUS[t.status]), t.receivedQuantity === null ? '' : String(t.receivedQuantity),
    csvText(t.reason ? humanize(t.reason) : ''), t.orderId === null ? '' : String(t.orderId),
    csvText(`${t.createdBy.firstName} ${t.createdBy.lastName}`.trim()), csvText(t.notes ?? ''),
  ].join(',');
}

/** The moves the filters match as CSV, built once, with one audit row for the export (F-659). */
export async function exportTransfers(actor: { id: number }, filters: Omit<TransferFilters, 'page' | 'limit'>): Promise<string> {
  const lines: string[] = [COLUMNS.join(',')];
  for await (const batch of transferBatches(filters)) for (const t of batch) lines.push(line(t));
  const { includeCounts: _c, scopeLocationId: _s, ...shown } = filters;
  await prisma.auditLog.create({
    data: {
      tenantId: resolveTenantId(), userId: actor.id, actorKind: 'person', channel: 'app', action: 'export', resource: 'inventory_transfer',
      metadata: { rows: lines.length - 1, filters: shown },
    },
  });
  return lines.join('\r\n');
}
