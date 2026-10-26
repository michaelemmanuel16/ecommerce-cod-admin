import { Tag, type Column } from '../../components/ui-v2';
import type { Shipment } from '../../services/shipments.service';
import { formatCurrency } from '../../utils/format';
import { parseMoney } from '../../utils/money';
import { Dash } from './Dash';
import { shortDay } from './model';
import { isReceived } from './shipModel';
import { Actions, type ShipmentActions } from './ShipmentActions';

/** The 15 columns of the incoming shipments table (F-604). Amounts are in the shipment currency; Total is in the store currency. */
export function shipmentColumns(a: ShipmentActions): Column<Shipment>[] {
  return [
    { key: 'product', header: 'Product', render: (s) => <b>{s.product.name}</b> },
    { key: 'supplier', header: 'Supplier', render: (s) => s.supplier ?? <Dash /> },
    { key: 'qty', header: 'Qty', right: true, render: (s) => <span className="num">{s.quantity}</span> },
    { key: 'unit', header: 'Unit cost', right: true, render: (s) => <span className="num">{formatCurrency(s.unitCost, s.currency)}</span> },
    { key: 'shipping', header: 'Shipping', right: true, render: (s) => <span className="num">{formatCurrency(s.shippingCost, s.currency)}</span> },
    { key: 'customs', header: 'Customs', right: true, render: (s) => <span className="num">{formatCurrency(parseMoney(s.customsDuties), s.currency)}</span> },
    { key: 'other', header: 'Other', right: true, render: (s) => <span className="num">{formatCurrency(s.otherCosts, s.currency)}</span> },
    {
      key: 'total',
      header: 'Total',
      right: true,
      render: (s) => (
        <span className="num">
          <b>{formatCurrency(s.totalCostStore, s.storeCurrency)}</b>
          {s.currency !== s.storeCurrency && <small data-testid="original-amount">{formatCurrency(s.totalCost, s.currency)}</small>}
        </span>
      ),
    },
    {
      key: 'landed',
      header: 'Landed per unit',
      right: true,
      render: (s) => (s.landedCostPerUnit === null ? <Dash /> : <b className="num">{formatCurrency(Math.round(s.landedCostPerUnit * 100) / 100, s.storeCurrency)}</b>),
    },
    { key: 'expected', header: 'Expected', render: (s) => shortDay(s.expectedArrivalDate) },
    {
      key: 'at',
      header: 'Received at',
      render: (s) => (isReceived(s) ? <>{s.destinationLocation?.name ?? '—'}<small>{shortDay(s.receivedAt)}</small></> : <Dash />),
    },
    { key: 'counted', header: 'Counted', right: true, render: (s) => (isReceived(s) ? <span className="num">{s.quantityCounted}</span> : <Dash />) },
    {
      key: 'short',
      header: 'Short',
      right: true,
      render: (s) => (!isReceived(s) ? <Dash /> : (s.shortQuantity ?? 0) > 0 ? <Tag tone="bad">{s.shortQuantity} short</Tag> : <span className="num">0</span>),
    },
    { key: 'status', header: 'Status', render: (s) => (isReceived(s) ? <Tag tone="ok">Received</Tag> : <Tag tone="v">Pending</Tag>) },
    { key: 'actions', header: 'Actions', right: true, render: (s) => <Actions s={s} a={a} /> },
  ];
}
