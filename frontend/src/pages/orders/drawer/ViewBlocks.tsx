import { MessageCircle, Phone } from 'lucide-react';
import { Tag } from '../../../components/ui-v2';
import type { OrderDetail } from '../../../services/orders.service';
import { formatCurrency, formatPhoneLocal } from '../../../utils/format';
import { personName } from '../../../utils/people';
import { methodLabel, num, PAYMENT_TONE, telUrl, whatsappUrl } from './model';

/** Items block: one row per line, then the total (mockup .oi). */
export function ItemsView({ order }: { order: OrderDetail }) {
  const count = order.items.reduce((sum, i) => sum + i.quantity, 0);
  return (
    <div className="sec">
      <h4>
        Items <span style={{ fontWeight: 500 }}>({count})</span>
      </h4>
      <div>
        {order.items.map((i) => (
          <div className="oi" key={i.id}>
            <div>
              <b>{i.metadata?.upsellName ?? i.product?.name ?? 'Unknown product'}</b>
              <small>{formatCurrency(num(i.unitPrice))} each</small>
            </div>
            <span className="num">× {i.quantity}</span>
            <b className="num">{formatCurrency(num(i.totalPrice))}</b>
          </div>
        ))}
        {num(order.discount) > 0 && (
          <div className="oi">
            <span>Discount</span>
            <span />
            <span className="num">−{formatCurrency(num(order.discount))}</span>
          </div>
        )}
        <div className="oi t">
          <span>Total</span>
          <span />
          <span className="num">{formatCurrency(num(order.totalAmount))}</span>
        </div>
      </div>
    </div>
  );
}

/** Customer block with the Call (`tel:`) and WhatsApp (`https://wa.me/<number>`) buttons. */
export function CustomerView({ order }: { order: OrderDetail }) {
  const c = order.customer;
  return (
    <div className="sec">
      <h4>Customer</h4>
      <dl className="kv">
        <dt>Name</dt>
        <dd>{personName(c)}</dd>
        <dt>Phone</dt>
        <dd style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{formatPhoneLocal(c.phoneNumber)}</span>
          <a className="mini" href={telUrl(c.phoneNumber)} style={{ textDecoration: 'none' }}>
            <Phone aria-hidden="true" style={{ width: 13, height: 13, verticalAlign: -2 }} /> Call
          </a>
          <a className="mini" href={whatsappUrl(c.phoneNumber)} style={{ textDecoration: 'none' }}>
            <MessageCircle aria-hidden="true" style={{ width: 13, height: 13, verticalAlign: -2 }} /> WhatsApp
          </a>
        </dd>
        {c.alternatePhone && (
          <>
            <dt>Alternate phone</dt>
            <dd>{formatPhoneLocal(c.alternatePhone)}</dd>
          </>
        )}
        {c.email && (
          <>
            <dt>Email</dt>
            <dd>{c.email}</dd>
          </>
        )}
        <dt>Address</dt>
        <dd>{order.deliveryAddress || '—'}</dd>
        <dt>State</dt>
        <dd>{order.deliveryState || '—'}</dd>
        {order.deliveryArea && (
          <>
            <dt>City/Town</dt>
            <dd>{order.deliveryArea}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/** Payment block: the derived tag, method, amount, deposit line and "Cash held by" (only with financial:view). */
export function PaymentView({ order }: { order: OrderDetail }) {
  const p = order.payment;
  return (
    <div className="sec">
      <h4>Payment</h4>
      <dl className="kv">
        <dt>Status</dt>
        <dd>
          <Tag tone={PAYMENT_TONE[order.paymentTag.code]}>{order.paymentTag.label}</Tag>
        </dd>
        <dt>Method</dt>
        <dd>{methodLabel(p.method)}</dd>
        <dt>Amount</dt>
        <dd className="num">{formatCurrency(num(p.amount))}</dd>
        {p.deposit && (
          <>
            <dt>Deposit</dt>
            <dd>
              Deposit {formatCurrency(num(p.deposit.paid))} paid. {formatCurrency(num(p.deposit.due))} due on delivery
            </dd>
          </>
        )}
        {p.cashHeldBy !== undefined && (
          <>
            <dt>Cash held by</dt>
            <dd>{p.cashHeldBy}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
