import { ProfitByProductCard, ProfitInsightCard } from './ProfitByProductCard';
import { useProfitByProduct } from './blocks';
import { useFinanceRange } from './range';

/** Profit by product (M5-T40, F-924): the finding, then the table, for the Finance date range. */
export function ProductProfitPanel() {
  const { from, to } = useFinanceRange();
  const profit = useProfitByProduct(from, to);
  return (
    <div className="fin">
      <ProfitInsightCard block={profit} />
      <ProfitByProductCard block={profit} />
    </div>
  );
}
