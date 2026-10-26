import { CohortCard } from './CohortCard';
import { FailedCostCard } from './FailedCostCard';
import { MonthlyPlCard } from './MonthlyPlCard';
import { useCohortProfit, useFailedCost, useMonthlyPl } from './blocks';
import { useFinanceRange } from './range';

/** The cards the Finance Overview adds (M5-T40): the order cohort, the cost of failed deliveries and the monthly profit and loss. */
export function OverviewProfitCards() {
  const { from, to } = useFinanceRange();
  const cohort = useCohortProfit(from, to);
  const failed = useFailedCost(from, to);
  const monthly = useMonthlyPl();
  return (
    <div className="fin">
      <div className="grid two even">
        <CohortCard cohort={cohort} />
        <FailedCostCard block={failed} />
      </div>
      <MonthlyPlCard block={monthly} />
    </div>
  );
}
