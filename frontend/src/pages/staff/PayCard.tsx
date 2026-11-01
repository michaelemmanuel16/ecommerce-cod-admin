import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { Button, Card, EmptyState, Tabs } from '../../components/ui-v2';
import { GuardedButtonV2 } from '../../components/financial/GuardedButtonV2';
import { PayoutForm } from '../../components/payouts/PayoutForm';
import { PayoutHistoryList } from '../../components/payouts/PayoutHistoryList';
import { useRepPayoutHistory } from '../../components/payouts/useRepPayoutHistory';
import { collectionsService } from '../../services/collections.service';
import { deliveryPartnersService, type FeeRule, type PartnerRow } from '../../services/delivery-partners.service';
import { payoutsService, type RepOwedRow } from '../../services/payouts.service';
import { staffService, type StaffRow } from '../../services/staff.service';
import { formatCurrency } from '../../utils/format';
import { toCents } from '../../utils/money';
import { AVATAR_TONES, initials, personName } from '../../utils/people';
import { monthName } from '../dashboard/format';
import { DEFAULT_VIEW, rangeOf } from '../deliveries/urlState';
import { ListSkeleton } from '../deliveries/ListSkeleton';
import { useBlock } from '../financial/profit/useBlock';

type PayTab = 'reps' | 'agents' | 'history';

interface PayCardProps {
  /** The company rep pay of Settings, Rewards, for the note under the call reps. null when the person may not read it. */
  company: { baseCommission: number; upsellPercent: number } | null;
}

/** "GH₵25 delivered · GH₵5 failed": the rule in force, as the mockup writes it. */
function feeRuleLine(rule: FeeRule | null | undefined): string {
  if (rule === undefined) return '—';
  if (!rule || (rule.delivered === null && rule.failed === null)) return 'No rule yet';
  return [rule.delivered !== null && `${formatCurrency(rule.delivered)} delivered`, rule.failed !== null && `${formatCurrency(rule.failed)} failed`].filter(Boolean).join(' · ');
}

/** The cash each partner holds. null when the person may not read it (the API answers 403), so the column shows a dash. */
async function cashHeldById(): Promise<Map<number, number> | null> {
  try {
    return new Map((await collectionsService.aging()).partners.map((p) => [p.agentId, p.cashHeld]));
  } catch {
    return null;
  }
}

/**
 * The Pay card of the Staff screen (F-1164, M6-T22), built from docs/mockups/v2/staff.html: Call reps, Delivery agents and Payout
 * history. "Record payout" opens the same PayoutForm that Finance opens, with the rep's id (its list of owed entries is the
 * "pick delivered orders" view), and the history is the same list Finance draws. Delivery agents are read-only: their fee is kept
 * from the cash they collect, so there is no fee payout. AI agents and companies get no payout and no button.
 */
export function PayCard({ company }: PayCardProps) {
  const [tab, setTab] = useState<PayTab>('reps');
  const [paying, setPaying] = useState<RepOwedRow | null>(null);
  const range = rangeOf(DEFAULT_VIEW);
  const month = monthName(range.from);

  const owed = useBlock('reps:owed', () => payoutsService.repsOwed());
  const history = useRepPayoutHistory();
  // Agents and the people behind them are read only when their tab opens
  const onAgents = tab === 'agents';
  const partners = useBlock(`staff|pay|partners|${range.from}`, () => deliveryPartnersService.list(range, 'agent'), onAgents);
  const cash = useBlock('staff|pay|cash', cashHeldById, onAgents);
  const team = useBlock('staff|pay|team', () => staffService.list({ status: 'active' }));

  const reps = owed.data?.reps ?? [];
  const staff = team.data?.staff ?? [];
  const aiReps = staff.filter((s) => s.kind === 'ai_agent' && s.role === 'sales_rep');
  const profile = new Map(staff.map((s) => [s.id, s]));

  const reload = () => {
    owed.retry();
    history.retry();
  };

  return (
    <Card title="Pay" aside={`${month} · people only. Delivery fees are kept from cash, not paid out.`} id="paycard">
      <Tabs
        label="Pay" value={tab} onChange={(id) => setTab(id as PayTab)}
        items={[
          { id: 'reps', label: 'Call reps' },
          { id: 'agents', label: 'Delivery agents' },
          { id: 'history', label: 'Payout history', ...(history.data && { count: history.data.length }) },
        ]}
      />

      {tab === 'reps' && (
        <div role="tabpanel" aria-label="Call reps">
          {!owed.data ? (
            owed.status === 'failed'
              ? <EmptyState title="The rep pay could not load." action={<Button onClick={owed.retry}>Try again</Button>} />
              : <ListSkeleton label="Loading rep pay" rows={3} height={44} />
          ) : (
            <div className="tablewrap">
              <table className="dt paytbl" aria-label="Call reps pay">
                <thead>
                  <tr><th>Call rep</th><th className="r">Delivered orders</th><th className="r">Commission</th><th className="r">Upsell reward</th><th className="r">Earned</th><th className="r">Paid</th><th className="r">Owed</th><th><span className="sr-only">Action</span></th></tr>
                </thead>
                <tbody>
                  {reps.map((r) => (
                    <tr key={r.id}>
                      <td><div className="who"><div className={`a ${AVATAR_TONES[r.id % AVATAR_TONES.length]}`} aria-hidden="true">{initials(personName(r))}</div><div><b>{personName(r)}</b><small>Call rep</small></div></div></td>
                      <td className="r num">{r.delivered.toLocaleString('en-GB')}</td>
                      <td className="r num">{formatCurrency(r.commission)}</td>
                      <td className="r num">{formatCurrency(r.upsellReward)}</td>
                      <td className="r num">{formatCurrency(r.earned)}</td>
                      <td className="r num">{formatCurrency(r.paid)}</td>
                      <td className="r"><b className="num">{formatCurrency(r.owed)}</b></td>
                      <td className="r">
                        <GuardedButtonV2 perm="recordPayout" size="mini" variant={toCents(r.owed) > 0 ? 'primary' : undefined} aria-label={`Record payout for ${personName(r)}`} onClick={() => setPaying(r)}>Record payout</GuardedButtonV2>
                      </td>
                    </tr>
                  ))}
                  {aiReps.map((a) => (
                    <tr key={a.id} className="off">
                      <td><div className="who"><div className="a violet" aria-hidden="true">AI</div><div><b>{a.name}</b><small>AI agent</small></div></div></td>
                      <td className="r mut" colSpan={6}>No payout</td>
                      <td />
                    </tr>
                  ))}
                  {reps.length === 0 && aiReps.length === 0 && (
                    <tr><td colSpan={8}><EmptyState title="No call reps yet" text="Reps and what they earn show here." /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="pnote">
            <Info aria-hidden="true" />
            <span>
              {company
                ? `Commission is ${formatCurrency(company.baseCommission)} for each confirmed order that is delivered, plus an upsell reward of ${company.upsellPercent}% of the extra value the rep adds at confirmation, paid on delivery. `
                : 'Commission and the upsell reward are paid on delivery. '}
              Target bonuses are separate, see Rewards in <Link to="/settings?tab=rewards">Settings</Link>.
            </span>
          </p>
        </div>
      )}

      {tab === 'agents' && (
        <div role="tabpanel" aria-label="Delivery agents">
          {!partners.data ? (
            partners.status === 'failed'
              ? <EmptyState title="The delivery agents could not load." action={<Button onClick={partners.retry}>Try again</Button>} />
              : <ListSkeleton label="Loading delivery agents" rows={3} height={44} />
          ) : partners.data.rows.length === 0 ? (
            <EmptyState title="No delivery agents yet" text="Agents and what they keep from cash show here." />
          ) : (
            <div className="tablewrap">
              <table className="dt paytbl" aria-label="Delivery agents pay">
                <thead>
                  <tr><th>Delivery agent</th><th>Vehicle</th><th>Location</th><th>Fee rule</th><th className="r">Delivered</th><th className="r">Failed</th><th className="r">Fees kept</th><th className="r">Cash held</th></tr>
                </thead>
                <tbody>
                  {partners.data.rows.map((p) => <AgentRow key={p.partnerId} partner={p} person={profile.get(p.partnerId)} cash={cash.data ?? null} />)}
                </tbody>
              </table>
            </div>
          )}
          <p className="pnote">
            <Info aria-hidden="true" />
            <span>
              The delivery fee is what we pay whoever delivers the order. The agent keeps it from the cash they collect and hands in the rest, so there is no fee payout.
              Cash held is collected minus fees minus deposits. The fee rule is set per partner on <Link to="/deliveries">Deliveries</Link>.
              Target rewards are in <Link to="/settings?tab=rewards">Settings, Rewards</Link>. Deposits are in <Link to="/finance">Finance</Link>.
            </span>
          </p>
        </div>
      )}

      {tab === 'history' && (
        <div role="tabpanel" aria-label="Payout history">
          <PayoutHistoryList rows={history.data} failed={history.status === 'failed'} onRetry={history.retry} />
        </div>
      )}

      {paying && <PayoutForm personId={paying.id} personName={personName(paying)} onClose={() => setPaying(null)} onRecorded={reload} />}
    </Card>
  );
}

function AgentRow({ partner, person, cash }: { partner: PartnerRow; person: StaffRow | undefined; cash: Map<number, number> | null }) {
  // The aging report lists partners that hold cash: a partner missing from it holds none
  const held = cash ? cash.get(partner.partnerId) ?? 0 : undefined;
  const money = (v: string | number | null | undefined) => (v === undefined || v === null ? '—' : formatCurrency(v));
  return (
    <tr>
      <td><div className="who"><div className={`a ${AVATAR_TONES[partner.partnerId % AVATAR_TONES.length]}`} aria-hidden="true">{initials(partner.name)}</div><div><b>{partner.name}</b><small>Delivery</small></div></div></td>
      <td>{person?.vehicleType ?? '—'}{person?.vehicleId && <span className="sub2">{person.vehicleId}</span>}</td>
      <td>{partner.baseTown ?? person?.location ?? '—'}</td>
      <td>{feeRuleLine(partner.feeRule)}</td>
      <td className="r num">{partner.delivered.toLocaleString('en-GB')}</td>
      <td className="r num">{partner.failedOrReturned.toLocaleString('en-GB')}</td>
      <td className="r num">{money(partner.feesKept)}</td>
      <td className="r num"><b>{money(held)}</b></td>
    </tr>
  );
}
