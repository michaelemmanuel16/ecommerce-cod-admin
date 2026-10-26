import { CircleDollarSign, Megaphone, Percent, Receipt } from 'lucide-react';
import { Button, Skeleton, Tag, Tile } from '../../../components/ui-v2';
import type { ProfitByProduct } from '../../../services/financeReports.service';
import { perOrderNote } from './copy';
import { isLoss, money, monthOf, pct } from './format';
import type { Block } from './useBlock';

/**
 * The four tiles of "Products and profit" (F-1055): net result, delivered revenue, Meta ad spend, profit per delivered order.
 * One component for Finance and for Reports, so the two screens cannot drift apart.
 */
export function ProfitTiles({ block }: { block: Block<ProfitByProduct> }) {
  const p = block.data;
  if (block.failed) {
    return (
      <div className="card blockerr" role="alert">
        <div><b>Profit figures did not load</b><p>Something went wrong on our side.</p></div>
        <Button size="mini" onClick={block.retry}>Retry</Button>
      </div>
    );
  }
  if (!p) return <div className="grid kpis" aria-busy="true" aria-label="Loading profit figures">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={132} className="skelcard" />)}</div>;
  const loss = isLoss(p.netProfit);
  const perOrderLoss = isLoss(p.profitPerDeliveredOrder);
  const note = perOrderNote(p);
  return (
    <div className={`grid kpis${block.loading ? ' finbusy' : ''}`}>
      <Tile
        icon={<Percent />} tone={loss ? 'coral' : 'mint'}
        value={<span className={loss ? 'neg' : undefined}>{money(p.netProfit)}</span>}
        label="Net result, by delivery date"
        footer={<><span>Net margin {pct(p.netMarginPct)}</span><Tag tone={loss ? 'bad' : 'ok'}>{loss ? 'Loss' : 'Profit'}</Tag></>}
      />
      <Tile
        icon={<CircleDollarSign />} tone="pine" value={money(p.totals.revenue)} label="Delivered revenue"
        footer={<><span>{p.products.length} {p.products.length === 1 ? 'product' : 'products'} sold</span><Tag>{monthOf(p.to)}</Tag></>}
      />
      <Tile
        icon={<Megaphone />} tone="gold" value={money(p.metaSpendWithNoProduct)} label="Meta ad spend"
        footer={<span>Not split by product yet</span>}
      />
      <Tile
        icon={<Receipt />} tone={perOrderLoss ? 'coral' : 'mint'}
        value={<span className={perOrderLoss ? 'neg' : undefined}>{money(p.profitPerDeliveredOrder)}</span>}
        label="Profit per delivered order"
        footer={<><span>{note ?? 'After rep commission'}</span>{p.profitPerDeliveredOrder !== null && <Tag tone={perOrderLoss ? 'bad' : 'ok'}>{perOrderLoss ? 'Loss' : 'Profit'}</Tag>}</>}
      />
    </div>
  );
}
