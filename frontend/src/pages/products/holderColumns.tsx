import type { Column } from '../../components/ui-v2';
import type { Holder, Holders } from '../../services/products.service';
import { formatCurrency } from '../../utils/format';
import { TYPE_LABEL } from '../inventory/model';

const n = (v: number) => <span className="num">{v}</span>;

/** The columns of the stock-by-holder table (F-603). The total row is the table's total slot. */
export function holderColumns(total: Holders['total']): Column<Holder>[] {
  return [
    { key: 'holder', header: 'Holder', total: 'Total', render: (h) => <><b>{h.name}</b><small>{TYPE_LABEL[h.type]}</small></> },
    { key: 'allocated', header: 'Allocated', right: true, total: n(total.allocated), render: (h) => n(h.allocated) },
    { key: 'transit', header: 'In transit', right: true, total: n(total.inTransit), render: (h) => (h.inTransit > 0 ? n(h.inTransit) : <span className="num" style={{ color: 'var(--ink-3)' }}>0</span>) },
    { key: 'delivered', header: 'Delivered', right: true, total: n(total.delivered), render: (h) => n(h.delivered) },
    { key: 'returned', header: 'Returned', right: true, total: n(total.returned), render: (h) => n(h.returned) },
    { key: 'onHand', header: 'On hand', right: true, total: n(total.onHand), render: (h) => <b className="num">{h.onHand}</b> },
    { key: 'value', header: 'Value', right: true, total: <span className="num">{formatCurrency(total.value)}</span>, render: (h) => <span className="num">{formatCurrency(h.value)}</span> },
  ];
}
