import { ProfitByProductCard, ProfitInsightCard } from './ProfitByProductCard';
import { ProfitTrendCard } from './ProfitTrendCard';
import { useProfitByProduct, useProfitTrend } from './blocks';
import { useFinanceRange } from './range';

/** Profit by product (M5-T40, F-924): the last 3 months chart beside the finding, then the table, for the Finance date range. */
export function ProductProfitPanel() {
  const { from, to } = useFinanceRange();
  const profit = useProfitByProduct(from, to);
  const trend = useProfitTrend();
  return (
    <div className="fin">
      <div className="grid two">
        <ProfitTrendCard block={trend} />
        <ProfitInsightCard block={profit} />
      </div>
      <ProfitByProductCard block={profit} />
    </div>
  );
}
