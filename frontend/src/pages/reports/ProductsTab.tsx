import { ProfitByProductCard } from '../financial/profit/ProfitByProductCard';
import { ProfitTiles } from '../financial/profit/ProfitTiles';
import { TwoWaysCard } from '../financial/profit/TwoWaysCard';
import { useCohortProfit, useProfitByProduct } from '../financial/profit/blocks';
import type { DayRange } from './range';

/**
 * Reports, "Products and profit" (M5-T44, F-1055). It holds no figure of its own: the tiles, "two ways to read the month"
 * and the table are the Finance cards, asked for the range the page shows. The compare switch does not change it (there
 * is no previous period for a profit snapshot).
 */
export function ProductsTab({ range }: { range: DayRange }) {
  const profit = useProfitByProduct(range.from, range.to);
  const cohort = useCohortProfit(range.from, range.to);
  return (
    <div className="panel fin">
      <ProfitTiles block={profit} />
      <TwoWaysCard profit={profit} cohort={cohort} />
      <ProfitByProductCard block={profit} />
    </div>
  );
}
