import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, HandCoins } from 'lucide-react';
import { Button, Card, EmptyState, Tag, type Column } from '../ui-v2';
import { Table } from '../ui-v2';
import { GuardedButtonV2 } from './GuardedButtonV2';
import type { AgingPartner, AgingReport } from '../../services/collections.service';
import { formatCurrency } from '../../utils/format';
import { initials } from '../../utils/people';
import { daysText, isLateOldest, toneOf } from '../../pages/financial/collections/model';

interface Props {
  report: AgingReport;
  remindingId: number | null;
  onReview: (p: AgingPartner) => void;
  onRemind: (p: AgingPartner) => void;
  onBlock: (p: AgingPartner) => void;
  onUnblock: (p: AgingPartner) => void;
  onExport: () => void;
}

const money = (n: number) => (n === 0 ? <span className="mut num">{formatCurrency(0)}</span> : <span className="num">{formatCurrency(n)}</span>);

/**
 * Agent aging by partner (F-910, F-911, F-704): cash held, the four age buckets, oldest unpaid and days to pay. Overdue means
 * past the partner's own days to pay. The switch shows only partners with something overdue.
 */
export function AgentAgingTab({ report, remindingId, onReview, onRemind, onBlock, onUnblock, onExport }: Props) {
  const [overdueOnly, setOverdueOnly] = useState(false);
  const rows = useMemo(() => (overdueOnly ? report.partners.filter((p) => p.overdueOrders > 0) : report.partners), [report.partners, overdueOnly]);
  const { summary } = report;
  const cashTotal = report.partners.reduce((sum, p) => sum + p.cashHeld, 0);
  const bucketTotal = (i: number) => formatCurrency(summary.bucketTotals[i]?.amount ?? 0);

  const columns: Column<AgingPartner>[] = [
    {
      key: 'partner',
      header: 'Partner',
      total: <b>All partners</b>,
      render: (p) => (
        <div className="who">
          <div className={`a ${toneOf(p.agentId)}`} aria-hidden="true">{initials(p.name)}</div>
          <div>
            <b>{p.name}</b>
            {p.isBlocked && <> <Tag tone="bad">Blocked</Tag></>}
            {p.negativeCashHeld && <> <Tag tone="warn">Cash below zero</Tag></>}
            {p.email && <small>{p.email}</small>}
          </div>
        </div>
      ),
    },
    {
      key: 'cash',
      header: 'Cash held',
      right: true,
      total: <b className="num">{formatCurrency(cashTotal)}</b>,
      render: (p) => <b className="num" style={p.negativeCashHeld ? { color: 'var(--coral)' } : undefined}>{formatCurrency(p.cashHeld)}</b>,
    },
    ...(['0-3', '4-7', '8-14', '15+'] as const).map((key, i): Column<AgingPartner> => ({
      key: `b${key}`,
      header: `${key.replace('-', '–')} days`,
      right: true,
      total: <span className="num">{bucketTotal(i)}</span>,
      render: (p) => {
        const amount = p.buckets.find((b) => b.key === key)?.amount ?? 0;
        return amount > 0 && i >= 2 ? <span className="num" style={{ color: 'var(--coral)' }}>{formatCurrency(amount)}</span> : money(amount);
      },
    })),
    {
      key: 'oldest',
      header: 'Oldest unpaid',
      render: (p) => (p.oldestUnpaidDays === null ? <span className="mut">None</span> : <Tag tone={isLateOldest(p.oldestUnpaidDays, p.daysToPay) ? 'bad' : 'n'}>{daysText(p.oldestUnpaidDays)}</Tag>),
    },
    { key: 'dtp', header: 'Days to pay', right: true, render: (p) => <span className="num">{daysText(p.daysToPay)}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (p.overdueOrders > 0 ? <Tag tone="warn">{p.overdueOrders} overdue</Tag> : <Tag tone="ok">On time</Tag>),
    },
    {
      key: 'actions',
      header: 'Actions',
      right: true,
      render: (p) => (
        <div className="rowacts">
          <GuardedButtonV2 perm="verifyCollection" size="mini" variant="primary" aria-label={`Review ${p.name}`} onClick={() => onReview(p)}>Review</GuardedButtonV2>
          <GuardedButtonV2 perm="remindPartner" size="mini" aria-label={`Send reminder to ${p.name}`} disabled={remindingId === p.agentId || p.unpaidOrders === 0} onClick={() => onRemind(p)}>Send reminder</GuardedButtonV2>
          <GuardedButtonV2 perm="blockPartner" size="mini" aria-label={`${p.isBlocked ? 'Unblock' : 'Block'} ${p.name}`} onClick={() => (p.isBlocked ? onUnblock(p) : onBlock(p))}>{p.isBlocked ? 'Unblock' : 'Block'}</GuardedButtonV2>
        </div>
      ),
    },
  ];

  return (
    <Card title="Agent aging" aside="Unpaid delivered orders, net of delivery fee" className="agingwrap">
      <div className="agtools">
        <label className="chk">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          Show overdue only <small className="mut">past the partner's days to pay</small>
        </label>
        <Button onClick={onExport}><Download />Export CSV</Button>
      </div>
      {report.partners.length === 0 ? (
        <EmptyState icon={<HandCoins />} title="No partner holds cash" text="Partners with delivered orders to pay in show here." action={<Link className="btn" to="/delivery-agents">Open Deliveries</Link>} />
      ) : rows.length === 0 ? (
        <EmptyState title="No partner is overdue" text="Everyone is within their days to pay." />
      ) : (
        <Table label="Agent aging" columns={columns} rows={rows} rowKey={(p) => p.agentId} />
      )}
    </Card>
  );
}
