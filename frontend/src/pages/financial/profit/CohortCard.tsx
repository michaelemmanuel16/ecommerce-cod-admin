import { Card } from '../../../components/ui-v2';
import type { CohortProfit } from '../../../services/financeReports.service';
import { rangeLabel } from '../../reports/format';
import { cohortLine } from './copy';
import { cost, lossClass, lowerFirst, money, monthOf, pct } from './format';
import { Part } from './Part';
import type { FinanceBlock } from './useBlock';

/** The order cohort card (F-925, M5-T26): projected profit of the orders placed in the range, at the yield of the closed cohorts. */
export function CohortCard({ cohort }: { cohort: FinanceBlock<CohortProfit> }) {
  return (
    <Part name="Order cohort" block={cohort} height={300}>
      {(c) => {
        const month = monthOf(c.to);
        if (!c.available) {
          return (
            <Card title={`${month} order cohort`} aside={`Orders placed ${rangeLabel(c.from, c.to)}`} className="fincard">
              <p className="note cohortgap">{c.message}. The yield is projected from orders that have closed.</p>
            </Card>
          );
        }
        return (
          <Card title={`${month} order cohort`} aside={`Orders placed ${rangeLabel(c.from, c.to)}, ${lowerFirst(c.yieldLabel)}`} className="fincard">
            <div className="tablewrap">
              <table className="dt cohort" aria-label={`${month} order cohort`}>
                <tbody>
                  <tr><td>Delivered orders <small>{c.ordersPlaced} placed</small></td><td className="r num">{c.projectedDelivered}</td></tr>
                  <tr><td>Revenue</td><td className="r num">{money(c.revenue)}</td></tr>
                  <tr><td>Product cost</td><td className="r num">{cost(c.productCost)}</td></tr>
                  <tr><td>Delivery fees</td><td className="r num">{cost(c.fees)}</td></tr>
                  <tr><td>Meta ad spend</td><td className="r num">{cost(c.metaAds)}</td></tr>
                  <tr><td>Rep commission and rewards</td><td className="r num">{cost(c.repCommission)}</td></tr>
                  <tr className="tot">
                    <td>Profit before other expenses <small>{pct(c.marginPct)} margin</small></td>
                    <td className={`r num ${lossClass(c.profitBeforeOtherExpenses) ?? ''}`}>{money(c.profitBeforeOtherExpenses)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="note">{cohortLine(c)}</p>
          </Card>
        );
      }}
    </Part>
  );
}
