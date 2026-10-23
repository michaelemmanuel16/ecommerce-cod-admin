import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Skeleton, Table, Tag, type Column, type TagTone } from '../../../components/ui-v2';
import { ORDER_STATUS_LABELS } from '../../../utils/orderStatus';
import type { OrderStatus } from '../../../types';
import { formatCurrency } from '../../../utils/format';
import { INFO } from '../copy';
import { initials, orderNumber } from '../format';
import { PageLink } from '../links';
import { PATHS } from '../paths';
import { BlockFrame, Tip } from './Frame';
import type { Block, RecentOrder } from '../types';

const STATUS_TONE: Record<string, TagTone> = {
  delivered: 'ok', digital_delivered: 'ok',
  out_for_delivery: 'v', preparing: 'v', ready_for_pickup: 'v',
  pending_confirmation: 'warn', payment_pending: 'warn',
  confirmed: 'n',
  failed_delivery: 'bad', returned: 'bad', cancelled: 'bad', payment_failed: 'bad',
};
// The avatar colours of the mockup rows, in turn.
const AVATARS = ['pine', 'gold', 'violet', 'coral'] as const;

function columns(rows: RecentOrder[]): Column<RecentOrder>[] {
  return [
    { key: 'order', header: 'Order', render: (o) => <b>{orderNumber(o)}</b> },
    {
      key: 'customer',
      header: 'Customer',
      render: (o) => {
        const i = rows.indexOf(o) % AVATARS.length;
        return (
          <div className="who">
            <div className={clsx('a', AVATARS[i])}>{initials(o.customerName)}</div>
            <div>{o.customerName}{o.city && <small>{o.city}</small>}</div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (o) => (
        <>
          <Tag tone={STATUS_TONE[o.status] ?? 'n'}>{ORDER_STATUS_LABELS[o.status as OrderStatus] ?? o.status}</Tag>
          {o.notReachable && <small className="note">Not reachable</small>}
        </>
      ),
    },
    { key: 'amount', header: 'Amount', right: true, render: (o) => <span className="num">{formatCurrency(o.amount, o.currency)}</span> },
  ];
}

interface RecentOrdersProps {
  orders: Block<RecentOrder[]> | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}

/** Recent orders (F-207). A row opens the order's page; the drawer comes with the Orders task. */
export function RecentOrdersCard({ orders, loading, failed, onRetry }: RecentOrdersProps) {
  const navigate = useNavigate();
  return (
    <BlockFrame name="Recent orders" block={orders} loading={loading} failed={failed} onRetry={onRetry} skeleton={<Skeleton height={250} className="skelcard" />}>
      {(rows) => (
        <div className="card">
          <div className="ct">
            <h3><Tip info={INFO.recentOrders}>Recent orders</Tip></h3>
            <PageLink to={PATHS.orders} className="mini">View all</PageLink>
          </div>
          {rows.length === 0 ? (
            <p className="emptyrow">No orders in this range yet.</p>
          ) : (
            <div className="rtable">
              <Table label="Recent orders" columns={columns(rows)} rows={rows} rowKey={(o) => o.id} onRowClick={(o) => navigate(`/orders/${o.id}`)} />
            </div>
          )}
        </div>
      )}
    </BlockFrame>
  );
}
