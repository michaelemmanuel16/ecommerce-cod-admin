import { useState } from 'react';
import { BadgeCheck, BadgePercent, CheckCircle2, Gift } from 'lucide-react';
import { Button, Card, EmptyState, Skeleton, Tag, Tile } from '../../components/ui-v2';
import { GuardedButtonV2 } from '../../components/financial/GuardedButtonV2';
import { PayoutForm } from '../../components/payouts/PayoutForm';
import { payoutsService, type PayoutRow, type RepOwedRow } from '../../services/payouts.service';
import { useBlock } from './profit/useBlock';
import { formatCurrency, formatDate } from '../../utils/format';
import { toCents } from '../../utils/money';
import { initials } from '../../utils/people';
import { ListSkeleton } from '../deliveries/ListSkeleton';
import { monthName } from '../dashboard/format';
import { toneOf } from './collections/model';
import { repTiles } from './repModel';

const HISTORY_ROWS = 10;
const repName = (r: { firstName: string; lastName: string }): string => `${r.firstName} ${r.lastName}`;

/**
 * Rep commissions tab (F-914, M5-T38), laid out as the v2 mockup: four tiles, a table of every rep with what was earned, paid
 * in the month and is owed, "Record payout" per rep (the one payout form), and the payout history. The tile figures are the
 * server's totals. The ledger account behind it is 2020 Commissions payable. Only people are listed: delivery agents and AI
 * agents get no commission payout.
 */
export function RepCommissions() {
  const owed = useBlock('reps:owed', () => payoutsService.repsOwed());
  const history = useBlock('reps:payouts', () => payoutsService.recentRepPayouts(HISTORY_ROWS));
  const [paying, setPaying] = useState<RepOwedRow | null>(null);
  const data = owed.data;

  const reload = () => {
    owed.retry();
    history.retry();
  };

  if (owed.status === 'failed' && !data) {
    return <div className="card"><EmptyState title="The rep commissions could not load." action={<Button onClick={owed.retry}>Try again</Button>} /></div>;
  }

  const reps = data?.reps ?? [];
  const totals = data?.totals;
  const month = data ? monthName(`${data.month}-01`) : '';
  const { perOrder, targetRewards, repsPaid } = repTiles(reps);
  const skel = <Skeleton width={90} height={28} />;

  return (
    <div className="repcom vstack">
      <div className="grid kpis" aria-busy={!data}>
        <Tile icon={<BadgePercent />} tone="gold" value={totals ? <span data-testid="tile-owed">{formatCurrency(totals.owed)}</span> : skel} label="Commission owed"
          footer={<><span>{totals ? `${totals.repsOwed} ${totals.repsOwed === 1 ? 'rep' : 'reps'} · account 2020` : 'Account 2020'}</span>{totals && totals.repsOwed > 0 && <Tag tone="warn">To pay</Tag>}</>} />
        <Tile icon={<CheckCircle2 />} tone="mint" value={totals ? <span data-testid="tile-paid-in-month">{formatCurrency(totals.paidInMonth)}</span> : skel} label="Paid this month"
          footer={<><span>{data ? `${repsPaid} ${repsPaid === 1 ? 'rep' : 'reps'} paid in ${month}` : 'Paid this month'}</span>{repsPaid > 0 && <Tag tone="ok">Paid</Tag>}</>} />
        <Tile icon={<BadgeCheck />} tone="violet" value={data ? (perOrder === null ? '—' : formatCurrency(perOrder)) : skel} label="Per delivered confirmed order"
          footer={<><span>Average commission, before upsell reward</span><Tag tone="n">Rule</Tag></>} />
        <Tile icon={<Gift />} tone="pine" value={data ? formatCurrency(targetRewards) : skel} label="Target rewards earned"
          footer={<><span>Earned at month close</span><Tag tone="n">{targetRewards > 0 ? 'Earned' : 'Pending'}</Tag></>} />
      </div>

      <Card title="Rep commissions" aside={data ? `${month} · commission per delivered confirmed order plus upsell reward` : undefined} className="comwrap">
        {!data ? (
          <ListSkeleton label="Loading rep commissions" rows={3} height={44} />
        ) : reps.length === 0 ? (
          <EmptyState icon={<BadgePercent />} title="No reps yet" text="Sales reps and what they earn show here." />
        ) : (
          <div className="tablewrap">
            <table className="dt" aria-label="Rep commissions">
              <thead>
                <tr>
                  <th>Rep</th><th className="r">Delivered</th><th className="r">Commission</th><th className="r">Upsell reward</th><th className="r">Earned</th>
                  <th className="r">Paid in {month.slice(0, 3)}</th><th className="r">Owed</th><th>Target reward</th><th>Last payout</th><th className="r">Action</th>
                </tr>
              </thead>
              <tbody>
                {reps.map((r) => (
                  <tr key={r.id}>
                    <td><div className="who"><div className={`a ${toneOf(r.id)}`} aria-hidden="true">{initials(repName(r))}</div><div><b>{repName(r)}</b> <Tag tone="n">Human</Tag></div></div></td>
                    <td className="r num">{r.delivered.toLocaleString('en-GB')}</td>
                    <td className="r num">{formatCurrency(r.commission)}</td>
                    <td className="r num">{formatCurrency(r.upsellReward)}</td>
                    <td className="r num">{formatCurrency(r.earned)}</td>
                    <td className="r num">{formatCurrency(r.paidInMonth)}</td>
                    <td className="r"><b className="num">{formatCurrency(r.owed)}</b></td>
                    <td>{toCents(r.targetReward) > 0 ? <span className="num">{formatCurrency(r.targetReward)}</span> : <Tag tone="n">None yet</Tag>}</td>
                    <td>{r.lastPayout ? formatDate(r.lastPayout, 'd MMM') : <span className="mut">No payout yet</span>}</td>
                    <td className="r">
                      <GuardedButtonV2 perm="recordPayout" size="mini" variant="primary" aria-label={`Record payout for ${repName(r)}`} onClick={() => setPaying(r)}>Record payout</GuardedButtonV2>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">Commission and upsell reward are paid only when the order is delivered.</p>
      </Card>

      <Card title="Payout history" aside="Commissions and rewards paid" className="comwrap">
        <PayoutHistory rows={history.data} failed={history.status === 'failed'} onRetry={history.retry} />
      </Card>

      {paying && <PayoutForm personId={paying.id} personName={repName(paying)} onClose={() => setPaying(null)} onRecorded={reload} />}
    </div>
  );
}

function PayoutHistory({ rows, failed, onRetry }: { rows: PayoutRow[] | undefined; failed: boolean; onRetry: () => void }) {
  if (!rows) {
    return failed
      ? <EmptyState title="The payout history could not load." action={<Button onClick={onRetry}>Try again</Button>} />
      : <ListSkeleton label="Loading payout history" rows={2} height={36} />;
  }
  if (rows.length === 0) return <EmptyState title="No payout yet" text="A payout you record shows here." />;
  return (
    <div className="tablewrap">
      <table className="dt" aria-label="Payout history">
        <thead><tr><th>Date</th><th>Rep</th><th>Method</th><th>Reference</th><th className="r">Amount</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{formatDate(p.payoutDate, 'd MMM')}</td>
              <td><b>{repName(p.payee)}</b></td>
              <td>{p.method}</td>
              <td>{p.reference ?? p.notes ?? '—'}</td>
              <td className="r num">{formatCurrency(p.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
