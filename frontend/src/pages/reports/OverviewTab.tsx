import { CircleDollarSign, PackageCheck, PhoneCall, ShoppingCart } from 'lucide-react';
import { Card, Tag, Tile } from '../../components/ui-v2';
import { RATE_TAG } from '../dashboard/copy';
import { parseMoney } from '../../utils/money';
import { shortDay } from '../dashboard/format';
import { DayLineChart } from './charts';
import { countChange, percentChange } from './delta';
import { compactMoney, count, rangeLabel, wholeMoney, wholePercent } from './format';
import { Part, type TabControl } from './Part';
import type { OverviewReport, Segment } from './types';

const SEGMENT_LABEL: Record<Segment, string> = {
  delivered: 'Delivered', failed: 'Failed', returned: 'Returned', outForDelivery: 'Out for delivery',
  waitingToDispatch: 'Waiting to dispatch', pendingCall: 'Pending call', cancelled: 'Cancelled', other: 'Other',
};
const SEGMENT_COLOR: Record<Segment, string> = {
  delivered: 'var(--mint)', failed: 'var(--coral)', returned: 'var(--coral)', outForDelivery: 'var(--violet)',
  waitingToDispatch: 'var(--gold)', pendingCall: 'var(--ink-3)', cancelled: 'var(--ink-3)', other: 'var(--ink-3)',
};

/** Overview (F-1051, mockup #t-overview): four tiles, orders per day, where orders ended up, the daily table. */
export function OverviewTab({ report, ctl }: { report: OverviewReport | null; ctl: TabControl }) {
  const { compare } = ctl;
  const currency = report?.currency ?? '';
  const range = report ? rangeLabel(report.range.from, report.range.to) : '';

  return (
    <div className="panel">
      <Part name="Tiles" block={report?.tiles} ctl={ctl} height={150}>
        {(t) => {
          const conf = t.confirmed.confirmationRate;
          const success = t.delivered.deliverySuccessRate;
          const confTag = RATE_TAG[conf.tag];
          const successTag = RATE_TAG[success.tag];
          return (
            <div className="grid kpis">
              <Tile
                icon={<ShoppingCart />} tone="violet" value={count(t.orders.value)} label="Orders"
                footer={<><span>{range}</span><Tag tone="n">Placed</Tag></>}
                delta={compare ? countChange(t.orders) : null}
              />
              <Tile
                icon={<PhoneCall />} tone="mint" value={count(t.confirmed.value)} label="Confirmed"
                footer={<><span>Confirmation rate {wholePercent(conf.value)}, target {conf.target}%</span><Tag tone={confTag.tone}>{confTag.label}</Tag></>}
                delta={compare ? countChange(t.confirmed) : null}
              />
              <Tile
                icon={<PackageCheck />} tone="coral" value={count(t.delivered.value)} label="Delivered"
                footer={<><span>Delivery success {wholePercent(success.value)}, target {success.target}%</span><Tag tone={successTag.tone}>{successTag.label}</Tag></>}
                delta={compare ? countChange(t.delivered) : null}
              />
              <Tile
                icon={<CircleDollarSign />} tone="pine" value={wholeMoney(t.deliveredRevenue.value, t.currency)} label="Delivered revenue"
                footer={<span>{t.deliveredRevenue.monthTarget === null ? 'By delivery date' : `Month target ${compactMoney(t.deliveredRevenue.monthTarget, t.currency)}`}</span>}
                delta={compare ? percentChange(t.deliveredRevenue.deltaPercent, t.deliveredRevenue.previous === null ? null : wholeMoney(t.deliveredRevenue.previous, t.currency)) : null}
              />
            </div>
          );
        }}
      </Part>

      <div className="grid two">
        <Card title="Orders and deliveries per day" aside={range}>
          <div className="legend lgrow">
            <span><i style={{ background: 'var(--violet)' }} />Orders</span>
            <span><i style={{ background: 'var(--pine)' }} />Delivered</span>
            {compare && report?.compare && <span><i className="dash" />Previous period ({rangeLabel(report.compare.from, report.compare.to)})</span>}
          </div>
          <div className="chart">
            <Part name="Chart" block={report?.daily} ctl={ctl} height={240} bare>
              {(d) => (
                <DayLineChart
                  compare={compare}
                  series={[{ key: 'orders', color: 'var(--violet)', area: true }, { key: 'delivered', color: 'var(--pine)' }]}
                  data={d.rows.map((r) => ({
                    date: r.date, orders: r.orders, delivered: r.delivered,
                    ordersPrev: r.previous?.orders ?? null, deliveredPrev: r.previous?.delivered ?? null,
                  }))}
                  summary={`Orders and delivered orders per day, ${range}. ${count(d.total.orders)} orders and ${count(d.total.delivered)} delivered in total.`}
                />
              )}
            </Part>
          </div>
        </Card>

        <Part name="Where orders ended up" block={report?.endedUp} ctl={ctl} height={300}>
          {(e) => {
            const rows = e.segments.filter((s) => s.key !== 'other' || s.count > 0);
            const top = Math.max(1, ...rows.map((s) => s.count));
            return (
              <Card title={`Where ${count(e.total)} orders ended up`} aside={range}>
                <div className="bars">
                  {rows.map((s) => (
                    <div className="bar-row" key={s.key}>
                      <span>{SEGMENT_LABEL[s.key]}</span>
                      <div className="track"><i style={{ width: `${(s.count / top) * 100}%`, background: SEGMENT_COLOR[s.key] }} /></div>
                      <span className="val num">{count(s.count)}</span>
                    </div>
                  ))}
                </div>
                <p className="note">
                  <b>{wholePercent(e.deliverySuccessRate)} success, {wholePercent(e.orderToCashYield)} yield.</b>{' '}
                  Delivery success is delivered out of closed orders. Yield is delivered out of all orders placed.
                </p>
              </Card>
            );
          }}
        </Part>
      </div>

      <Card title="Daily breakdown" aside={report ? `${report.range.days} days` : ''} className="tcard">
        <Part name="Daily breakdown" block={report?.daily} ctl={ctl} height={260} bare>
          {(d) => (
            <div className="tablewrap dailywrap">
              <table className="dt" aria-label="Daily breakdown">
                <thead>
                  <tr><th scope="col">Date</th><th scope="col" className="r">Orders</th><th scope="col" className="r">Confirmed</th><th scope="col" className="r">Delivered</th><th scope="col" className="r">Revenue</th></tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.date}>
                      <td>{shortDay(r.date)}</td>
                      <td className="r num">{count(r.orders)}</td>
                      <td className="r num">{count(r.confirmed)}</td>
                      <td className="r num">{count(r.delivered)}</td>
                      <td className="r num">{wholeMoney(parseMoney(r.revenue), currency)}</td>
                    </tr>
                  ))}
                  <tr className="tot">
                    <td>Total</td>
                    <td className="r num">{count(d.total.orders)}</td>
                    <td className="r num">{count(d.total.confirmed)}</td>
                    <td className="r num">{count(d.total.delivered)}</td>
                    <td className="r num">{wholeMoney(parseMoney(d.total.revenue), currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Part>
      </Card>
    </div>
  );
}
