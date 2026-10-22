import type { ReactNode } from 'react';
import clsx from 'clsx';
import { CircleDollarSign, Hourglass, Receipt, Wallet } from 'lucide-react';
import { Card, EmptyState, Tag, Tile } from '../../components/ui-v2';
import { parseMoney } from '../../utils/money';
import { DayBarChart, Donut } from './charts';
import { percentChange, snapshotChange } from './delta';
import { compactMoney, count, plural, rangeLabel, wholeMoney, wholePercent } from './format';
import { Part, type TabControl } from './Part';
import type { SalesReport, SalesTiles } from './types';

const SLICE_COLORS = ['var(--pine)', 'var(--violet)', 'var(--gold)', 'var(--mint)', 'var(--coral)', 'var(--ink-3)'];

/** The AOV change is an amount, not a percent: "▼ GH₵3 vs GH₵248". Neutral colour, as the mockup shows it. */
function aovChange(aov: SalesTiles['aov'], currency: string): ReactNode {
  if (aov.previous === null && aov.deltaAmount === null) return null;
  if (aov.deltaAmount === null || aov.previous === null) return <><Tag tone="n">No data</Tag>in the previous period</>;
  const delta = parseMoney(aov.deltaAmount);
  if (delta === 0) return <><Tag tone="n">Same</Tag>vs {wholeMoney(aov.previous, currency)}</>;
  return <><Tag tone="n">{delta > 0 ? '▲' : '▼'} {wholeMoney(Math.abs(delta), currency)}</Tag>vs {wholeMoney(aov.previous, currency)}</>;
}

const Empty = () => <EmptyState title="No delivered orders in this range" text="Pick a longer range to see more." />;

/** Sales and revenue (F-1052, F-1064, mockup #t-sales). The location table is "State" (COD-139). */
export function SalesTab({ report, ctl }: { report: SalesReport | null; ctl: TabControl }) {
  const { compare } = ctl;
  const currency = report?.currency ?? '';
  const range = report ? rangeLabel(report.range.from, report.range.to) : '';

  return (
    <div className="panel">
      <Part name="Tiles" block={report?.tiles} ctl={ctl} height={150}>
        {(t) => {
          const cash = t.cashReceived;
          const held = t.cashWithPartners;
          return (
            <div className={clsx('grid kpis', !cash && 'n2')}>
              <Tile
                icon={<CircleDollarSign />} tone="pine" value={wholeMoney(t.deliveredRevenue.value, t.currency)} label="Delivered revenue"
                footer={<><span>{plural(t.deliveredOrders.value, 'delivered order')}</span><Tag tone="n">By delivery date</Tag></>}
                delta={compare ? percentChange(t.deliveredRevenue.deltaPercent, t.deliveredRevenue.previous === null ? null : wholeMoney(t.deliveredRevenue.previous, t.currency)) : null}
              />
              <Tile
                icon={<Receipt />} tone="violet" value={t.aov.value === null ? 'n/a' : wholeMoney(t.aov.value, t.currency)} label="Average order value"
                footer={<span>Last 30 days {t.thirtyDayAov.value === null ? 'n/a' : wholeMoney(t.thirtyDayAov.value, t.currency)}</span>}
                delta={compare ? aovChange(t.aov, t.currency) : null}
              />
              {cash && (
                <Tile
                  icon={<Wallet />} tone="mint" value={compactMoney(cash.value, t.currency)} label="Cash received"
                  footer={<span>{wholePercent(cash.percentOfDeliveredRevenue)} of delivered revenue</span>}
                  delta={compare ? percentChange(cash.deltaPercent, cash.previous === null ? null : compactMoney(cash.previous, t.currency)) : null}
                />
              )}
              {held && (
                <Tile
                  icon={<Hourglass />} tone="gold" value={compactMoney(held.value, t.currency)} label="Cash still with partners"
                  footer={<span>Held by {plural(held.partners, 'partner')}</span>}
                  delta={snapshotChange(compare)}
                />
              )}
            </div>
          );
        }}
      </Part>

      <div className="grid two">
        <Card title="Delivered revenue per day" aside={currency}>
          {compare && (
            <div className="legend lgrow">
              <span><i style={{ background: 'var(--pine)' }} />This period</span>
              <span><i style={{ background: 'var(--ink-3)' }} />Previous period</span>
            </div>
          )}
          <div className="chart">
            <Part name="Chart" block={report?.revenuePerDay} ctl={ctl} height={240} bare>
              {(d) => (
                <DayBarChart
                  compare={compare}
                  data={d.rows.map((r) => ({ date: r.date, value: parseMoney(r.revenue), valuePrev: r.previous ? parseMoney(r.previous.revenue) : null }))}
                  summary={`Delivered revenue per day, ${range}.`}
                />
              )}
            </Part>
          </div>
        </Card>

        <Part name="Revenue by product" block={report?.byProduct} ctl={ctl} height={240}>
          {(p) => (
            <Card title="Revenue by product" aside={wholeMoney(p.total, currency)}>
              {p.rows.length === 0 ? <Empty /> : (
                <Donut
                  top={compactMoney(p.total, currency)} sub="delivered"
                  summary={`Revenue by product: ${p.rows.map((r) => `${r.name} ${wholeMoney(r.revenue, currency)}`).join(', ')}.`}
                  slices={p.rows.map((r, i) => ({ name: r.name, value: parseMoney(r.revenue), color: SLICE_COLORS[i % SLICE_COLORS.length], text: wholeMoney(r.revenue, currency) }))}
                />
              )}
            </Card>
          )}
        </Part>
      </div>

      <Part name="Revenue by State" block={report?.byState} ctl={ctl} height={260}>
        {(c) => (
          <Card title="Revenue by State" aside={`Delivered orders, ${range}`} className="tcard">
            {c.rows.length === 0 ? <Empty /> : (
              <div className="tablewrap">
                <table className="dt" aria-label="Revenue by State">
                  <thead>
                    <tr><th scope="col">State</th><th scope="col" className="r">Delivered</th><th scope="col" className="r">Revenue</th><th scope="col" className="r">Average order</th><th scope="col" className="r">Share</th></tr>
                  </thead>
                  <tbody>
                    {c.rows.map((r) => (
                      <tr key={r.state}>
                        <td><b>{r.state}</b></td>
                        <td className="r num">{count(r.delivered)}</td>
                        <td className="r num">{wholeMoney(r.revenue, currency)}</td>
                        <td className="r num">{r.averageOrder === null ? 'n/a' : wholeMoney(r.averageOrder, currency)}</td>
                        <td className="r num">{wholePercent(r.sharePercent)}</td>
                      </tr>
                    ))}
                    <tr className="tot">
                      <td>Total</td>
                      <td className="r num">{count(c.total.delivered)}</td>
                      <td className="r num">{wholeMoney(c.total.revenue, currency)}</td>
                      <td className="r num">{c.total.averageOrder === null ? 'n/a' : wholeMoney(c.total.averageOrder, currency)}</td>
                      <td className="r num">100%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </Part>
    </div>
  );
}
