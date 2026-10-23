import type { ReactNode } from 'react';
import { Tag, type Column } from '../../components/ui-v2';
import type { PartnerRow, PartnerTotal } from '../../services/delivery-partners.service';
import { initials } from '../../utils/people';
import { count, DATA_SOURCE_LABEL, days, feeRuleText, rowTags, toneOf, TYPE_LABEL, TYPE_TONE } from './model';
import { AvailabilitySwitch } from './AvailabilitySwitch';
import { SuccessBar } from './SuccessBar';

interface ColumnContext {
  /** Delivery success target in percent (the pace line on every bar). */
  target: number;
  total: PartnerTotal | null;
  /** The viewer may turn availability on and off (owner, admin, manager). */
  canSwitch: boolean;
  onSwitch: (row: PartnerRow, on: boolean) => void;
}

const num = (n: number): ReactNode => <span className="num">{count(n)}</span>;
const dash = <span className="mut">—</span>;

/** The 15 columns of the partner table: the 12 of F-700, base town, days to pay and the availability switch (F-709). */
export function buildColumns({ target, total, canSwitch, onSwitch }: ColumnContext): Column<PartnerRow>[] {
  return [
    {
      key: 'partner',
      header: 'Partner',
      total: <b>All partners</b>,
      render: (p) => (
        <div className="who">
          <div className={`a ${toneOf(p.partnerId)}`} aria-hidden="true">{initials(p.name)}</div>
          <div>
            <b>{p.name}</b> <Tag tone={TYPE_TONE[p.type]}>{TYPE_LABEL[p.type]}</Tag>
            {rowTags(p).map((t) => <Tag key={t.text} tone={t.tone}>{t.text}</Tag>)}
          </div>
        </div>
      ),
    },
    { key: 'town', header: 'Base town', render: (p) => p.baseTown ?? dash },
    { key: 'assigned', header: 'Assigned', right: true, total: <b className="num">{total ? count(total.assigned) : '—'}</b>, render: (p) => num(p.assigned) },
    { key: 'delivered', header: 'Delivered', right: true, total: <b className="num">{total ? count(total.delivered) : '—'}</b>, render: (p) => num(p.delivered) },
    {
      key: 'failed',
      header: 'Failed or returned',
      right: true,
      total: <b className="num" title={total ? `Failed ${total.failed}, returned ${total.returned}` : undefined}>{total ? count(total.failedOrReturned) : '—'}</b>,
      render: (p) => <span className="num" title={`Failed ${p.failed}, returned ${p.returned}`}>{count(p.failedOrReturned)}</span>,
    },
    { key: 'out', header: 'Out now', right: true, total: <b className="num">{total ? count(total.outNow) : '—'}</b>, render: (p) => num(p.outNow) },
    {
      key: 'success',
      header: <>Delivery success <small>(target {target}%)</small></>,
      total: total ? <SuccessBar rate={total.deliverySuccessRate} target={target} /> : null,
      render: (p) => <SuccessBar rate={p.deliverySuccessRate} target={target} />,
    },
    { key: 'c2d', header: 'Confirmed to dispatched', right: true, render: (p) => <span className="num">{days(p.confirmedToDispatchedDays)}</span> },
    { key: 'd2d', header: 'Dispatched to delivered', right: true, render: (p) => <span className="num">{days(p.dispatchedToDeliveredDays)}</span> },
    // Cash held and oldest unpaid are filled by the payout release (M5, F-704); until then the API sends null
    { key: 'cash', header: 'Cash held', right: true, render: (p) => (p.cashHeld === null ? dash : <b className="num">{p.cashHeld}</b>) },
    { key: 'unpaid', header: 'Oldest unpaid', render: (p) => (p.oldestUnpaidDays === null ? dash : <Tag>{days(p.oldestUnpaidDays)}</Tag>) },
    {
      key: 'dtp',
      header: 'Days to pay',
      right: true,
      render: (p) => (p.daysToPay === null ? dash : <span className="num">{p.daysToPay}</span>),
    },
    {
      key: 'fee',
      header: <>Delivery fee rule <small>(delivered · failed · returned)</small></>,
      render: (p) => {
        // A role without financial:view gets no fee rule from the API at all
        if (p.feeRule === undefined) return dash;
        const text = feeRuleText(p.feeRule);
        return text ? <span className="num">{text}</span> : <Tag>No fee rule</Tag>;
      },
    },
    { key: 'source', header: 'Data source', render: (p) => <Tag>{DATA_SOURCE_LABEL[p.dataSource]}</Tag> },
    {
      key: 'available',
      header: 'Available',
      render: (p) => (
        <AvailabilitySwitch name={p.name} checked={p.isAvailable} label={false} disabled={!canSwitch || !p.isActive} onChange={(on) => onSwitch(p, on)} />
      ),
    },
  ];
}
