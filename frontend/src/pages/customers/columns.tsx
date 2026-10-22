import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { Column } from '../../components/ui-v2';
import type { CustomerRow, CustomerSortField } from '../../services/customers.service';
import { formatCurrency, formatPhoneLocal } from '../../utils/format';
import { AVATAR_TONES, customerName, initials, lastOrderDate } from './model';
import { RiskTags } from './RiskTags';
import type { SortState } from './urlState';

interface ColumnContext {
  sort: SortState | null;
  onSort: (field: CustomerSortField) => void;
}

/** The columns of the Customers table in mockup order (F-350). */
export function buildColumns({ sort, onSort }: ColumnContext): Column<CustomerRow>[] {
  const head = (field: CustomerSortField, label: string): ReactNode => {
    const active = sort?.by === field;
    return (
      <button
        type="button"
        className="sorth"
        onClick={() => onSort(field)}
        aria-label={`Sort by ${label.toLowerCase()}${active ? `, now ${sort?.dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
      >
        {label}
        {active && (sort?.dir === 'asc' ? <ArrowUp /> : <ArrowDown />)}
      </button>
    );
  };

  return [
    {
      key: 'customer',
      header: head('customer', 'Customer'),
      render: (c) => {
        const name = customerName(c);
        return (
          <div className="who">
            <div className={`a ${AVATAR_TONES[c.id % AVATAR_TONES.length]}`} aria-hidden="true">{initials(name)}</div>
            <div>
              {name}
              <small>{formatPhoneLocal(c.phoneNumber)}</small>
            </div>
          </div>
        );
      },
    },
    { key: 'city', header: 'City', render: (c) => c.area || <span className="mut">—</span> },
    { key: 'orders', header: head('orders', 'Orders'), right: true, render: (c) => <span className="num">{c.totalOrders}</span> },
    { key: 'delivered', header: 'Delivered', right: true, render: (c) => <span className="num">{c.deliveredOrders}</span> },
    {
      key: 'refused',
      header: 'Refused',
      right: true,
      render: (c) => (c.refusedOrders > 0 ? <span className="num refs">{c.refusedOrders}</span> : <span className="num mut">0</span>),
    },
    { key: 'value', header: head('deliveredValue', 'Delivered value'), right: true, render: (c) => <b className="num">{formatCurrency(c.deliveredValue)}</b> },
    { key: 'last', header: head('lastOrder', 'Last order'), render: (c) => lastOrderDate(c.lastOrderAt) ?? <span className="mut">—</span> },
    { key: 'risk', header: 'Risk', render: (c) => <RiskTags row={c} /> },
  ];
}
