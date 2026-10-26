import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Tag } from '../../components/ui-v2';
import type { OrderListRow } from '../../services/orders.service';
import { formatCurrency } from '../../utils/format';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import { customerName, orderNumber, shortDate, STATUS_TONE } from '../orders/model';

interface OrderRowProps {
  row: OrderListRow;
  /** Before the order: the proof thumbnail. */
  lead?: ReactNode;
  /** Under the status tag: the proof button. */
  aside?: ReactNode;
}

/** One order line of the partner drawer: number, customer, date and amount, and the status tag. */
export function OrderRow({ row, lead, aside }: OrderRowProps) {
  return (
    <div className="dorow">
      {lead}
      <div className="domain">
        <Link to={`/orders/${row.id}`}><b>{orderNumber(row.id)}</b></Link> {customerName(row)}
        <small>{shortDate(row.createdAt)} · {formatCurrency(row.totalAmount)}</small>
      </div>
      <div className="doside">
        <Tag tone={STATUS_TONE[row.status]}>{ORDER_STATUS_LABELS[row.status]}</Tag>
        {aside}
      </div>
    </div>
  );
}
