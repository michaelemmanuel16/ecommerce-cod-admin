import clsx from 'clsx';
import { Gauge, PackageX, Timer, Truck } from 'lucide-react';
import { Card, EmptyState, Tag, Tile } from '../../components/ui-v2';
import { RATE_TAG } from '../dashboard/copy';
import { initials } from '../dashboard/format';
import { isBlockError } from '../dashboard/types';
import { DayLineChart, TargetBars } from './charts';
import { countChange, rateChange, snapshotChange } from './delta';
import { count, daysText, placeName, plural, rangeLabel, reasonLabel, wholeMoney, wholePercent } from './format';
import { Part, type TabControl } from './Part';
import type { DeliveryReport } from './types';

const REASON_COLOR = ['var(--coral)', 'var(--gold)', 'var(--violet)', 'var(--ink-3)', 'var(--ink-3)'];
const AVATAR = ['coral', 'gold', 'violet', 'pine'] as const;
const days1 = (n: number | null) => (n === null ? 'n/a' : String(Number(n.toFixed(1))));

/** Delivery and operations (F-1053, F-1064, mockup #t-delivery). Failed and returned are two separate numbers. */
export function DeliveryTab({ report, ctl }: { report: DeliveryReport | null; ctl: TabControl }) {
  const { compare } = ctl;
  const currency = report?.currency ?? '';
  const range = report ? rangeLabel(report.range.from, report.range.to) : '';
  const tiles = report && !isBlockError(report.tiles) ? report.tiles : null;
  const target = tiles?.deliverySuccessRate.target ?? null;

  return (
    <div className="panel">
      <Part name="Tiles" block={report?.tiles} ctl={ctl} height={150}>
        {(t) => {
          const s = t.deliverySuccessRate;
          const tag = RATE_TAG[s.tag];
          return (
            <div className="grid kpis">
              <Tile
                icon={<Gauge />} tone="coral" value={wholePercent(s.value)} label="Delivery success rate"
                footer={<><span>{count(s.delivered)} of {count(s.closed)} closed, target {s.target}%</span><Tag tone={tag.tone}>{tag.label}</Tag></>}
                delta={compare ? rateChange(s) : null}
              />
              <Tile
                icon={<PackageX />} tone="gold" value={count(t.failed.value)} label="Failed deliveries"
                footer={<span><b>{count(t.returned.value)} returned</b> · {wholePercent(t.notReachable.percentOfFailedAndReturned)} of failed and returned not reachable</span>}
                delta={compare ? countChange(t.failed, 'down') : null}
              />
              <Tile
                icon={<Truck />} tone="pine" value={count(t.outForDeliveryNow.value)} label="Out for delivery now"
                footer={<><span>Across {plural(t.outForDeliveryNow.partners, 'partner')}</span><Tag tone="n">Live</Tag></>}
                delta={snapshotChange(compare)}
              />
              <Tile
                icon={<Timer />} tone="violet" value={t.slowestPaysIn ? daysText(t.slowestPaysIn.days) : 'n/a'}
                label={t.slowestPaysIn ? `${t.slowestPaysIn.name} pays in` : 'Days to pay'}
                footer={<span>{t.slowestPaysIn ? 'Slowest partner to pay' : 'No payouts yet'}</span>}
                delta={snapshotChange(compare)}
              />
            </div>
          );
        }}
      </Part>

      <div className="grid two">
        <Card title="Delivered per day" aside="Orders">
          <div className="legend lgrow">
            <span><i style={{ background: 'var(--pine)' }} />Delivered</span>
            {compare && report?.compare && <span><i className="dash" />Previous period ({rangeLabel(report.compare.from, report.compare.to)})</span>}
          </div>
          <div className="chart">
            <Part name="Chart" block={report?.deliveredPerDay} ctl={ctl} height={240} bare>
              {(d) => (
                <DayLineChart
                  compare={compare}
                  series={[{ key: 'delivered', color: 'var(--pine)', area: true }]}
                  data={d.rows.map((r) => ({ date: r.date, delivered: r.delivered, deliveredPrev: r.previous?.delivered ?? null }))}
                  summary={`Delivered orders per day, ${range}.`}
                />
              )}
            </Part>
          </div>
        </Card>

        <Part name="Failed deliveries by reason" block={report?.reasons} ctl={ctl} height={240}>
          {(r) => {
            const top = Math.max(1, ...r.rows.map((x) => x.count));
            return (
              <Card title="Failed deliveries by reason" aside={tiles ? `${count(tiles.failed.value)} failed and ${count(tiles.returned.value)} returned` : `${count(r.total)} failed or returned`}>
                {r.rows.length === 0 ? <EmptyState title="No failed or returned orders" text="Nothing to explain in this range." /> : (
                  <>
                    <div className="bars">
                      {r.rows.map((x, i) => (
                        <div className="bar-row" key={x.reason}>
                          <span>{reasonLabel(x.reason)}</span>
                          <div className="track"><i style={{ width: `${(x.count / top) * 100}%`, background: REASON_COLOR[i % REASON_COLOR.length] }} /></div>
                          <span className="val num">{wholePercent(x.percent)} <small>{count(x.count)}</small></span>
                        </div>
                      ))}
                    </div>
                    <p className="note">Calling the customer before dispatch is the cheapest fix for not reachable.</p>
                  </>
                )}
              </Card>
            );
          }}
        </Part>
      </div>

      <Part name="Delivery partners" block={report?.partners} ctl={ctl} height={260}>
        {(p) => {
          const showCash = p.total.cashHeld !== undefined;
          return (
            <Card title="Delivery partners" aside={`Closed orders, ${range}`} className="tcard">
              {p.rows.length === 0 ? <EmptyState title="No orders with a delivery partner" text="Assign orders to a partner to see them here." /> : (
                <div className="tablewrap">
                  <table className="dt camp" aria-label="Delivery partners">
                    <thead>
                      <tr>
                        <th scope="col">Partner</th><th scope="col" className="r">Assigned</th><th scope="col" className="r">Delivered</th>
                        <th scope="col" className="r">Failed or returned</th><th scope="col" className="r">Out now</th>
                        <th scope="col">Success{target !== null && <small>target {target}%</small>}</th>
                        <th scope="col" className="r">Days to dispatch<small>from confirmed</small></th>
                        <th scope="col" className="r">Days to deliver<small>from dispatch</small></th>
                        {showCash && <th scope="col" className="r">Cash held</th>}
                        <th scope="col" className="r">Pays in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.rows.map((x, i) => (
                        <tr key={x.partnerId}>
                          <td><div className="who"><div className={clsx('a', AVATAR[i % AVATAR.length])} aria-hidden="true">{initials(x.name)}</div><div><b>{x.name}</b></div></div></td>
                          <td className="r num">{count(x.assigned)}</td>
                          <td className="r num">{count(x.delivered)}</td>
                          <td className="r num">{count(x.failedOrReturned)}</td>
                          <td className="r num">{count(x.outNow)}</td>
                          {x.successRate === null ? (
                            <td className="ink3">No closed orders yet</td>
                          ) : (
                            <td className="rate">
                              <b className="num">{wholePercent(x.successRate)}</b>
                              <div className="prog">
                                <i className={target !== null && x.successRate < target ? 'gold' : undefined} style={{ width: `${Math.min(100, x.successRate)}%` }} />
                                {target !== null && <span className="pace" style={{ left: `${target}%` }} />}
                              </div>
                            </td>
                          )}
                          <td className="r num">{days1(x.confirmedToDispatchedDays)}</td>
                          <td className={clsx('r num', x.dispatchedToDeliveredDays === null && 'ink3')}>{days1(x.dispatchedToDeliveredDays)}</td>
                          {showCash && <td className="r num"><b>{wholeMoney(x.cashHeld ?? 0, currency)}</b></td>}
                          <td className={clsx('r num', x.paysInDays === null && 'ink3')}>{x.paysInDays === null ? 'No payout yet' : daysText(x.paysInDays)}</td>
                        </tr>
                      ))}
                      <tr className="tot">
                        <td>All partners</td>
                        <td className="r num">{count(p.total.assigned)}</td>
                        <td className="r num">{count(p.total.delivered)}</td>
                        <td className="r num">{count(p.total.failedOrReturned)}</td>
                        <td className="r num">{count(p.total.outNow)}</td>
                        <td><b className="num">{wholePercent(p.total.successRate)}</b></td>
                        <td /><td />
                        {showCash && <td className="r num">{wholeMoney(p.total.cashHeld ?? 0, currency)}</td>}
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        }}
      </Part>

      <div className="grid two even">
        <Part name="Delivery success by City/Town" block={report?.successByCity} ctl={ctl} height={240}>
          {(c) => {
            const rows = c.rows.filter((r) => r.successRate !== null).map((r) => ({ label: placeName(r.city), value: r.successRate as number }));
            return (
              <Card title="Delivery success by City/Town" aside={`Target ${c.target}%`}>
                {rows.length === 0 ? <EmptyState title="No closed orders yet" text="Cities show once an order is delivered, failed or returned." /> : (
                  <div className="chart">
                    <TargetBars
                      rows={rows} target={c.target}
                      summary={`Delivery success by city or town against the ${c.target} percent target: ${rows.map((r) => `${r.label} ${Math.round(r.value)} percent`).join(', ')}.`}
                    />
                  </div>
                )}
              </Card>
            );
          }}
        </Part>

        <Part name="Waiting and returns" block={report?.waitingAndReturns} ctl={ctl} height={240}>
          {(w) => (
            <Card title="Waiting and returns" aside="Right now">
              <div className="two3">
                <div className="drv">
                  <small>Waiting to dispatch</small>
                  <b>{plural(w.waiting.count, 'order')}</b>
                  <em>{w.waiting.oldestDays === null ? 'Nothing is waiting' : `Oldest has waited ${plural(w.waiting.oldestDays, 'day')}`}</em>
                </div>
                <div className="drv">
                  <small>Returned orders</small>
                  <b>{count(w.returned.count)}</b>
                  <em>Returned in {range}</em>
                </div>
              </div>
            </Card>
          )}
        </Part>
      </div>
    </div>
  );
}
