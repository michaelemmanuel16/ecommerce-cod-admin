import clsx from 'clsx';
import { Clock, PhoneCall, PhoneMissed, PhoneOutgoing } from 'lucide-react';
import { Card, EmptyState, Tag, Tile } from '../../components/ui-v2';
import { initials } from '../dashboard/format';
import { isBlockError } from '../dashboard/types';
import { Donut } from './charts';
import { count, plural, reasonLabel, wholePercent } from './format';
import { Part, type TabControl } from './Part';
import type { DeliveryReport, TeamReport } from './types';

const OUTCOME: Record<string, { label: string; color: string }> = {
  confirmed: { label: 'Confirmed', color: 'var(--mint)' },
  not_reachable: { label: 'Not reachable', color: 'var(--coral)' },
  no_answer: { label: 'No answer', color: 'var(--coral)' },
  rescheduled: { label: 'Call back later', color: 'var(--gold)' },
  declined: { label: 'Declined', color: 'var(--violet)' },
  cancelled: { label: 'Cancelled', color: 'var(--ink-3)' },
  other: { label: 'Other', color: 'var(--ink-3)' },
};
const REASON_COLOR = ['var(--coral)', 'var(--gold)', 'var(--violet)', 'var(--ink-3)', 'var(--ink-3)'];
const AVATAR = ['mint', 'violet', 'gold', 'coral'] as const;

/** 190 minutes -> "3 h 10 min". */
const waited = (minutes: number): string => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`);
const callsPer = (n: number | null): string => (n === null ? 'Calls per confirmation: n/a' : `${n} calls per confirmation`);
const of = (detail: Record<string, number> | undefined, top: string, bottom: string): string | null =>
  detail && detail[top] !== undefined && detail[bottom] !== undefined ? `${count(detail[top])} of ${count(detail[bottom])}` : null;

/**
 * Team performance (F-1054, F-1057, mockup #t-team): tiles, call outcomes, decline reasons, the call rep table and the
 * partners ranked. GET /api/reports/team has no previous period and the page does no KPI arithmetic: every rate and
 * count is the API's. The partner bars read the Delivery report's own partner rows.
 */
export function TeamTab({ report, delivery, ctl, deliveryCtl }: { report: TeamReport | null; delivery: DeliveryReport | null; ctl: TabControl; deliveryCtl: TabControl }) {
  const { compare } = ctl;
  return (
    <div className="panel">
      <Part name="Team performance" block={report ?? undefined} ctl={ctl} height={150}>
        {(t) => (
          <>
            <div className="grid kpis">
              <Tile
                icon={<PhoneCall />} tone="mint" value={count(t.tiles.ordersConfirmed)} label="Orders confirmed"
                footer={<span>Confirmation rate {wholePercent(t.all.confirmationRate.value)}</span>}
                delta={compare ? <><Tag tone="n">No comparison</Tag>team numbers have no previous period</> : null}
              />
              <Tile
                icon={<PhoneOutgoing />} tone="violet" value={count(t.tiles.callsMade)} label="Calls made"
                footer={<><span>{callsPer(t.tiles.callsPerConfirmation)}</span><Tag tone="n">{plural(t.reps.length, 'rep')}</Tag></>}
              />
              <Tile
                icon={<PhoneMissed />} tone="gold" value={count(t.tiles.notReachable.count)} label="Not reachable"
                footer={<span>{wholePercent(t.tiles.notReachable.percentOfCalls)} of calls</span>}
              />
              <Tile
                icon={<Clock />} tone="coral" value={count(t.tiles.queue.pending)} label="Pending in the queue now"
                footer={<>
                  <span>{t.tiles.queue.oldestWaitMinutes === null ? 'Nothing is waiting' : `Oldest waiting ${waited(t.tiles.queue.oldestWaitMinutes)}`}, {count(t.tiles.queue.withoutRep)} with no rep</span>
                </>}
                delta={compare ? <><Tag tone="n">Snapshot</Tag>no previous figure</> : null}
              />
            </div>

            <div className="grid two">
              <Card title="Call outcomes" aside={`${count(t.tiles.callsMade)} calls`}>
                {t.callOutcomes.length === 0 ? <EmptyState title="No calls in this range" text="Calls show here once a rep logs one." /> : (
                  <Donut
                    top={count(t.tiles.callsMade)} sub="calls"
                    slices={t.callOutcomes.map((o) => {
                      const known = OUTCOME[o.outcome] ?? { label: reasonLabel(o.outcome), color: 'var(--ink-3)' };
                      return { name: known.label, value: o.count, color: known.color, text: count(o.count) };
                    })}
                    summary={`Call outcomes: ${t.callOutcomes.map((o) => `${(OUTCOME[o.outcome]?.label ?? reasonLabel(o.outcome))} ${count(o.count)}`).join(', ')}.`}
                  />
                )}
              </Card>

              <Card title="Why customers decline" aside="Share of declined orders">
                {t.declineReasons.length === 0 ? <EmptyState title="No declined orders" text="Nothing to explain in this range." /> : (
                  <div className="bars">
                    {t.declineReasons.map((x, i) => {
                      const top = Math.max(1, ...t.declineReasons.map((r) => r.count));
                      return (
                        <div className="bar-row" key={x.reason}>
                          <span>{reasonLabel(x.reason)}</span>
                          <div className="track"><i style={{ width: `${(x.count / top) * 100}%`, background: REASON_COLOR[i % REASON_COLOR.length] }} /></div>
                          <span className="val num">{wholePercent(x.percent)} <small>{count(x.count)}</small></span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            <Card title="Call reps" aside="Calls and orders in the range" className="tcard">
              {t.reps.length === 0 ? <EmptyState title="No call reps yet" text="Add a call rep to see their numbers here." /> : (
                <div className="tablewrap">
                  <table className="dt camp" aria-label="Call reps">
                    <thead>
                      <tr>
                        <th scope="col">Rep</th><th scope="col" className="r">Calls</th><th scope="col" className="r">Confirmed</th>
                        <th scope="col" className="r">Confirmation rate</th>
                        <th scope="col" className="r">Delivered from confirmed<small>of closed</small></th>
                        <th scope="col" className="r">Not reachable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.reps.map((r, i) => (
                        <tr key={r.repId}>
                          <td><div className="who"><div className={clsx('a', AVATAR[i % AVATAR.length])} aria-hidden="true">{initials(r.name)}</div><div><b>{r.name}</b></div></div></td>
                          <td className="r num">{count(r.calls)}</td>
                          <td className="r num"><b>{count(r.confirmed)}</b></td>
                          <td className="r num">{wholePercent(r.confirmationRate.value)}</td>
                          <td className="r num">{wholePercent(r.deliveredFromConfirmedRate.value)}<small className="ink3" style={{ display: 'block' }}>{of(r.deliveredFromConfirmedRate.detail, 'delivered', 'closed')}</small></td>
                          <td className="r num">{count(r.notReachable)}</td>
                        </tr>
                      ))}
                      <tr className="tot">
                        <td>All call reps</td>
                        <td className="r num">{count(t.all.calls)}</td>
                        <td className="r num">{count(t.all.confirmed)}</td>
                        <td className="r num">{wholePercent(t.all.confirmationRate.value)}</td>
                        <td className="r num">{wholePercent(t.all.deliveredFromConfirmedRate.value)}<small className="ink3" style={{ display: 'block' }}>{of(t.all.deliveredFromConfirmedRate.detail, 'delivered', 'closed')}</small></td>
                        <td className="r num">{count(t.all.notReachable)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              <p className="note" style={{ paddingTop: 12 }}>Confirmation rate is confirmed ÷ orders assigned to the rep. Delivered from confirmed is delivered ÷ closed among the orders the rep confirmed.</p>
            </Card>
          </>
        )}
      </Part>

      <Part name="Delivery partners ranked" block={delivery?.partners} ctl={deliveryCtl} height={200}>
        {(p) => {
          const target = delivery && !isBlockError(delivery.tiles) ? delivery.tiles.deliverySuccessRate.target : null;
          // best first; a partner with no closed orders goes last (display order only)
          const rows = [...p.rows].sort((a, b) => (b.successRate ?? -1) - (a.successRate ?? -1));
          return (
            <Card title="Delivery partners ranked" aside={target === null ? 'Delivery success' : `Delivery success, target ${target}%`}>
              {rows.length === 0 ? <EmptyState title="No orders with a delivery partner" text="Assign orders to a partner to rank them here." /> : (
                <>
                  <div className="bars">
                    {rows.map((x) => (
                      <div className="bar-row" key={x.partnerId}>
                        <span>{x.name}</span>
                        <div className="track">
                          <i style={{ width: `${Math.min(100, ((x.successRate ?? 0) / (target ?? 100)) * 100)}%`, background: target !== null && (x.successRate ?? 0) >= target ? 'var(--mint)' : 'var(--gold)' }} />
                          {target !== null && <span className="pace" style={{ left: '100%' }} />}
                        </div>
                        <span className="val num">{wholePercent(x.successRate)}{x.successRate === null && <small> no closed orders</small>}</span>
                      </div>
                    ))}
                  </div>
                  {target !== null && <p className="note">A full bar is the {target}% target. A partner with no closed orders yet shows n/a.</p>}
                </>
              )}
            </Card>
          );
        }}
      </Part>
    </div>
  );
}
