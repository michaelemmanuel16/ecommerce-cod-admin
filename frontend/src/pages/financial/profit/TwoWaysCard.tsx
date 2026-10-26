import { Card, Skeleton } from '../../../components/ui-v2';
import { BlockError } from '../../dashboard/blocks/Frame';
import type { CohortProfit, ProfitByProduct } from '../../../services/financeReports.service';
import { rangeLabel } from '../../reports/format';
import { twoWays } from './copy';
import { isLoss, monthOf } from './format';
import { Part } from './Part';
import type { FinanceBlock } from './useBlock';

/** "Two ways to read October" (F-925, F-1055): the result by delivery date next to the projected result of the orders placed. */
export function TwoWaysCard({ profit, cohort }: { profit: FinanceBlock<ProfitByProduct>; cohort: FinanceBlock<CohortProfit> }) {
  return (
    <Part name="Two ways to read the month" block={profit} height={170}>
      {(p) => {
        if (cohort.status === 'failed') return <BlockError name="The order cohort" onRetry={cohort.retry} />;
        if (!cohort.data) return <div aria-busy="true" aria-label="Loading the order cohort"><Skeleton height={170} className="skelcard" /></div>;
        const t = twoWays(p, cohort.data);
        return (
          <Card title={`Two ways to read ${monthOf(p.to)}`} aside={rangeLabel(p.from, p.to)} className="fincard">
            <div className="two3">
              <div className="drv"><small>{t.byDelivery.label}</small><b className={isLoss(p.netProfit) ? 'neg' : undefined}>{t.byDelivery.value}</b><em>{t.byDelivery.detail}</em></div>
              <div className="drv"><small>{t.byCohort.label}</small><b>{t.byCohort.value}</b><em>{t.byCohort.detail}</em></div>
            </div>
            {t.note && <p className="note finnote">{t.note}</p>}
          </Card>
        );
      }}
    </Part>
  );
}
