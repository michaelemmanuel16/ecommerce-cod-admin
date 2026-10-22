import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Pencil, Phone, ShoppingBag, Trash2 } from 'lucide-react';
import { useV2Page } from '../components/shell/useV2Page';
import { Button, Card, ConfirmDialog, EmptyState, Skeleton, Table, Tabs, Tag, Tile, useToast, type Column } from '../components/ui-v2';
import { usePermissions } from '../hooks/usePermissions';
import { customersService, type CustomerDetail } from '../services/customers.service';
import { formatCurrency, formatPhoneLocal } from '../utils/format';
import { ORDER_STATUS_LABELS } from '../utils/orderStatus';
import type { OrderStatus } from '../types';
import { RiskTags } from './customers/RiskTags';
import { CustomerModal } from './customers/CustomerModal';
import { AVATAR_TONES, customerName, initials, lastOrderDate } from './customers/model';
import { orderNumber, shortDate, STATUS_TONE } from './orders/model';

type TabId = 'orders' | 'messages' | 'calls' | 'notes';
const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'orders', label: 'Orders' },
  { id: 'messages', label: 'Messages' },
  { id: 'calls', label: 'Calls' },
  { id: 'notes', label: 'Notes' },
];

type Order = CustomerDetail['orders'][number];

const ORDER_COLUMNS: Column<Order>[] = [
  { key: 'order', header: 'Order', render: (o) => <b>{orderNumber(o.id)}</b> },
  { key: 'date', header: 'Date', render: (o) => <span className="mut">{shortDate(o.createdAt)}</span> },
  {
    key: 'status',
    header: 'Status',
    render: (o) => <Tag tone={STATUS_TONE[o.status as OrderStatus] ?? 'n'}>{ORDER_STATUS_LABELS[o.status as OrderStatus] ?? o.status}</Tag>,
  },
  { key: 'amount', header: 'Amount', right: true, render: (o) => <b className="num">{formatCurrency(o.totalAmount)}</b> },
];

const dash = <span className="mut">—</span>;

/**
 * The customer page (M3-T50, F-354). No mockup: built in the v2 style from the Orders and Dashboard parts.
 * Messages, Calls and Notes wait for M9 and show an empty state.
 */
export function CustomerDetails() {
  useV2Page();
  const { id } = useParams();
  const navigate = useNavigate();
  const say = useToast();
  const { can } = usePermissions();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('orders');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    async (quiet: boolean) => {
      try {
        setCustomer(await customersService.getCustomerDetail(Number(id), quiet));
        setError(null);
      } catch (e) {
        const status = axios.isAxiosError(e) ? e.response?.status : undefined;
        setError(status === 404 ? 'This customer could not be found.' : status === 403 ? 'You cannot open this customer.' : 'The customer could not load.');
      }
    },
    [id],
  );
  useEffect(() => {
    setCustomer(null);
    void load(false);
  }, [load]);

  const remove = async () => {
    if (!customer) return;
    setDeleting(false);
    try {
      await customersService.deleteCustomer(customer.id);
      say(`${customerName(customer)} deleted`);
      navigate('/customers');
    } catch (e) {
      // 409: an order is out for delivery. The API's sentence says what to do.
      const data = axios.isAxiosError(e) ? e.response?.data : undefined;
      say(data?.message || data?.error || 'The customer could not be deleted.');
    }
  };

  if (error) {
    return (
      <section className="cdetail">
        <EmptyState title={error} action={<Button onClick={() => navigate('/customers')}>Back to customers</Button>} />
      </section>
    );
  }
  if (!customer) {
    return (
      <section className="cdetail" aria-busy="true" aria-label="Loading customer">
        <Skeleton height={64} />
        <Skeleton height={120} />
        <Skeleton height={220} />
      </section>
    );
  }

  const name = customerName(customer);
  const deleted = customer.isActive === false;
  const digits = customer.phoneNumber.replace(/\D/g, '');
  const orderCount = customer.totalOrders;
  const optOut = (off: boolean) => (off ? <Tag tone="warn">Opted out</Tag> : <Tag tone="ok">Receives</Tag>);

  return (
    <section className="cdetail">
      <Link to="/customers" className="back">
        <ArrowLeft aria-hidden="true" />
        Customers
      </Link>

      <div className="head">
        <div className="nm who">
          <div className={`a big ${AVATAR_TONES[customer.id % AVATAR_TONES.length]}`} aria-hidden="true">{initials(name)}</div>
          <div>
            <h1>{name}</h1>
            <RiskTags row={customer}>{customer.codBlocked && <Tag tone="bad">COD off</Tag>}</RiskTags>
            <small>
              {formatPhoneLocal(customer.phoneNumber)}
              {customer.area ? ` · ${customer.area}` : ''}
            </small>
          </div>
        </div>
        <div className="hact">
          <a className="btn" href={`tel:+${digits}`}>
            <Phone />
            Call
          </a>
          <a className="btn" href={`https://wa.me/${digits}`}>
            <MessageCircle />
            WhatsApp
          </a>
          {!deleted && can('customers', 'update') && (
            <Button onClick={() => setEditing(true)}>
              <Pencil />
              Edit
            </Button>
          )}
          {!deleted && can('customers', 'delete') && (
            <Button variant="danger" onClick={() => setDeleting(true)}>
              <Trash2 />
              Delete
            </Button>
          )}
          {!deleted && can('orders', 'create') && (
            <Link className="btn pri" to={`/orders?new=1&customerId=${customer.id}`}>
              <ShoppingBag />
              New order for this customer
            </Link>
          )}
        </div>
      </div>

      {deleted && (
        <div className="bar warn" role="status">
          <b>This customer was deleted</b>
          <span>Their orders stay. You can read this page but not change it.</span>
        </div>
      )}
      {customer.codBlocked && (
        <div className="bar bad" role="status">
          <b>Cash on delivery is off</b>
          <span>Refused {customer.refusedOrders} deliveries. New orders go to a manual call.</span>
        </div>
      )}

      <div className="grid kpis">
        <Tile value={customer.totalOrders} label="Orders" />
        <Tile value={customer.deliveredOrders} label="Delivered" />
        <Tile value={customer.refusedOrders} label="Refused" />
        <Tile value={formatCurrency(customer.deliveredValue)} label="Delivered value" />
        <Tile value={customer.averageOrderValue === null ? '—' : formatCurrency(customer.averageOrderValue)} label="Average order value" />
        <Tile value={lastOrderDate(customer.lastOrderAt) ?? '—'} label="Last order" />
      </div>

      <div className="cols">
        <Card title="Contact">
          <dl>
            <dt>Email</dt>
            <dd>{customer.email || dash}</dd>
            <dt>Phone</dt>
            <dd>{formatPhoneLocal(customer.phoneNumber)}</dd>
            <dt>Alternate phone</dt>
            <dd>{customer.alternatePhone ? formatPhoneLocal(customer.alternatePhone) : dash}</dd>
            <dt>SMS</dt>
            <dd>{optOut(customer.smsOptOut)}</dd>
            <dt>WhatsApp</dt>
            <dd>{optOut(customer.whatsappOptOut)}</dd>
            <dt>Email messages</dt>
            <dd>{optOut(customer.emailOptOut)}</dd>
          </dl>
        </Card>
        <Card title="Address">
          <dl>
            <dt>Street</dt>
            <dd>{customer.address || dash}</dd>
            <dt>Town</dt>
            <dd>{customer.area || dash}</dd>
            <dt>Region</dt>
            <dd>{customer.state || dash}</dd>
            <dt>Landmark</dt>
            <dd>{customer.landmark || dash}</dd>
          </dl>
          {customer.notes && (
            <>
              <div className="ct"><h3>Internal notes</h3></div>
              <p className="notes">{customer.notes}</p>
            </>
          )}
        </Card>
      </div>

      <div className="card ctwrap">
        <Tabs label="Customer history" items={TABS} value={tab} onChange={(next) => setTab(next as TabId)} />
        <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
          {tab === 'orders' &&
            (customer.orders.length === 0 ? (
              <EmptyState title="No orders yet" text="Orders from this customer show here." />
            ) : (
              <>
                <Table label="Orders of this customer" columns={ORDER_COLUMNS} rows={customer.orders} rowKey={(o) => o.id} onRowClick={(o) => navigate(`/orders/${o.id}`)} />
                {orderCount > customer.orders.length && (
                  <div className="cfoot">
                    <span>Showing the last {customer.orders.length} of {orderCount.toLocaleString('en-GB')} orders</span>
                  </div>
                )}
              </>
            ))}
          {tab === 'messages' && <EmptyState title="No messages yet" text="Messages sent to this customer will show here." />}
          {tab === 'calls' && <EmptyState title="No calls yet" text="Calls with this customer will show here." />}
          {tab === 'notes' && <EmptyState title="No notes yet" text="The team's notes on this customer will show here." />}
        </div>
      </div>

      <CustomerModal
        open={editing}
        onClose={() => setEditing(false)}
        customer={customer}
        onSaved={(saved) => {
          setEditing(false);
          say(`${saved} saved`);
          void load(true);
        }}
      />
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => void remove()} action="Delete" count={1} noun="customer" title={`Delete ${name}?`}>
        {orderCount > 0
          ? `Their ${orderCount.toLocaleString('en-GB')} ${orderCount === 1 ? 'order stays' : 'orders stay'}. They disappear from the customer list.`
          : 'They disappear from the customer list.'}
      </ConfirmDialog>
    </section>
  );
}
