import { Card, Tag } from '../../../components/ui-v2';
import type { MonthlyPl, PlColumn } from '../../../services/financeReports.service';
import { formatRateUsed } from '../../../utils/format';
import { parseMoney } from '../../../utils/money';
import { plNotes } from './copy';
import { lossClass, marginTone, money, pct } from './format';
import { Part } from './Part';
import type { FinanceBlock } from './useBlock';

const anyColumn = (columns: PlColumn[], pick: (c: PlColumn) => unknown): boolean => columns.some((c) => parseMoney(pick(c) as string) !== 0);

/** The rate Meta spend was converted at: "₦112 = GH₵1", "Mixed rates", or nothing when no spend. */
function rateText(c: PlColumn): string | null {
  if (c.metaRate.kind === 'single' && c.metaRate.ngnPerGhs !== null) return formatRateUsed('NGN', c.metaRate.ngnPerGhs);
  return c.metaRate.kind === 'mixed' ? 'Mixed rates' : null;
}

/** Monthly profit and loss (F-923, M5-T25): months and the same days of last month next to this month to date. */
export function MonthlyPlCard({ block }: { block: FinanceBlock<MonthlyPl> }) {
  return (
    <Part name="Monthly profit and loss" block={block} height={360}>
      {(pl) => {
        const cols = pl.columns;
        const showPaystack = anyColumn(cols, (c) => c.paystackFees);
        const last = cols[cols.length - 1];
        return (
          <Card title="Monthly profit and loss" aside={last ? `${last.label} runs to ${last.to}` : undefined} className="fincard">
            {cols.length === 0 ? (
              <p className="note">Nothing is booked in the ledger yet.</p>
            ) : (
              <div className="tablewrap">
                <table className="dt" aria-label="Monthly profit and loss">
                  <thead>
                    <tr>
                      <th>Line</th>
                      {cols.map((c) => (
                        <th key={c.key} className="r">
                          {c.label}
                          {c.note && <small>As booked</small>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><b>Delivered revenue</b></td>
                      {cols.map((c) => <td key={c.key} className="r num"><b>{money(c.revenue)}</b></td>)}
                    </tr>
                    <tr>
                      <td>Product cost</td>
                      {cols.map((c) => <td key={c.key} className="r num">{money(c.productCost)}</td>)}
                    </tr>
                    <tr>
                      <td>Delivery fees</td>
                      {cols.map((c) => <td key={c.key} className="r num">{money(c.deliveryFees)}</td>)}
                    </tr>
                    <tr>
                      <td>Meta ad spend, converted <small>one rate per column</small></td>
                      {cols.map((c) => (
                        <td key={c.key} className="r num">
                          {money(c.metaSpend)}
                          {rateText(c) && <small>{rateText(c)}</small>}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td>Rep commission and rewards</td>
                      {cols.map((c) => (
                        c.repCommission === null
                          ? <td key={c.key} className="r ink3">Not split out{c.repCommissionNote && <small>{c.repCommissionNote}</small>}</td>
                          : <td key={c.key} className="r num">{money(c.repCommission)}</td>
                      ))}
                    </tr>
                    {showPaystack && (
                      <tr>
                        <td>Payment fees</td>
                        {cols.map((c) => <td key={c.key} className="r num">{money(c.paystackFees)}</td>)}
                      </tr>
                    )}
                    <tr>
                      <td>Other expenses</td>
                      {cols.map((c) => <td key={c.key} className="r num">{money(c.otherExpenses)}</td>)}
                    </tr>
                    <tr className="tot">
                      <td>Net profit</td>
                      {cols.map((c) => <td key={c.key} className={`r num ${lossClass(c.netProfit) ?? ''}`}>{money(c.netProfit)}</td>)}
                    </tr>
                    <tr>
                      <td><b>Net margin</b> <small>target {pct(pl.targetNetMargin)}</small></td>
                      {cols.map((c) => (
                        <td key={c.key} className="r"><Tag tone={marginTone(c.netMarginPct, pl.targetNetMargin)}>{pct(c.netMarginPct)}</Tag></td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {plNotes(cols).map((n) => <p className="note" key={n}>{n}</p>)}
          </Card>
        );
      }}
    </Part>
  );
}

