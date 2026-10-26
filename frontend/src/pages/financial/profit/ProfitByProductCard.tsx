import { TrendingDown, TrendingUp } from 'lucide-react';
import { Card, Tag } from '../../../components/ui-v2';
import type { ProfitByProduct } from '../../../services/financeReports.service';
import { parseMoney } from '../../../utils/money';
import { rangeLabel } from '../../reports/format';
import { profitHeadline } from './copy';
import { cost, lossClass, marginTone, money, monthOf, pct } from './format';
import { Part } from './Part';
import type { FinanceBlock } from './useBlock';

/** The one finding above the table, written from the answer (see copy.ts). */
export function ProfitInsightCard({ block }: { block: FinanceBlock<ProfitByProduct> }) {
  return (
    <Part name="Profit finding" block={block} height={120}>
      {(p) => {
        const h = profitHeadline(p);
        if (!h) return null;
        const Icon = h.tone === 'bad' ? TrendingDown : TrendingUp;
        return (
          <div className="card insight" role="status">
            <div className="h">
              <div className={`ico ${h.tone === 'bad' ? 'coral' : 'mint'}`}><Icon /></div>
              <div>
                <b>{h.title}</b>
                <p>{h.body}</p>
              </div>
            </div>
          </div>
        );
      }}
    </Part>
  );
}

/**
 * Profit by product (F-924, M5-T26): one row per product, then the lines that are not split by product, then the net result.
 * Every cell is the server's figure. A product with no cost says "Cost missing" and has no profit.
 */
export function ProfitByProductCard({ block }: { block: FinanceBlock<ProfitByProduct> }) {
  return (
    <Part name="Profit by product" block={block} height={420}>
      {(p) => {
        const notMatched = [p.notMatchedToProductRow.revenue, p.notMatchedToProductRow.productCost, p.notMatchedToProductRow.fees].some((v) => parseMoney(v) !== 0);
        return (
          <Card title="Profit by product" aside={`${monthOf(p.to)} · ${rangeLabel(p.from, p.to)}`} className="fincard">
            {p.products.length === 0 && !parseMoney(p.netProfit) ? (
              <p className="note">No order was delivered in these dates.</p>
            ) : (
              <div className="tablewrap">
                <table className="dt" aria-label="Profit by product">
                  <thead>
                    <tr>
                      <th>Product</th><th className="r">Delivered</th><th className="r">Revenue</th><th className="r">Product cost</th>
                      <th className="r">Fees</th><th className="r">Meta ads</th><th className="r">Profit</th><th className="r">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.products.map((r) => (
                      <tr key={r.productId}>
                        <td><b>{r.name}</b>{r.productType === 'digital' && <small>digital</small>}</td>
                        <td className="r num">{r.delivered}</td>
                        <td className="r num">{money(r.revenue)}</td>
                        <td className="r num">{r.costMissing ? <Tag tone="warn">{r.costNote ?? 'Cost missing'}</Tag> : money(r.productCost)}</td>
                        <td className="r num">{money(r.fees)}</td>
                        <td className="r num">{money(r.metaAds)}</td>
                        <td className={`r num ${lossClass(r.profit) ?? ''}`}>{r.profit === null ? '-' : <b>{money(r.profit)}</b>}</td>
                        <td className="r">{r.marginPct === null ? <span className="ink3">n/a</span> : <Tag tone={r.marginPct < 0 ? 'bad' : 'ok'}>{pct(r.marginPct)}</Tag>}</td>
                      </tr>
                    ))}
                    {notMatched && (
                      <tr>
                        <td>Not matched to a product row <small>returns and other currencies</small></td>
                        <td />
                        <td className="r num">{money(p.notMatchedToProductRow.revenue)}</td>
                        <td className="r num">{money(p.notMatchedToProductRow.productCost)}</td>
                        <td className="r num">{money(p.notMatchedToProductRow.fees)}</td>
                        <td /><td /><td />
                      </tr>
                    )}
                    <tr>
                      <td>Meta spend with no product <small>not split by product yet</small></td>
                      <td /><td /><td /><td />
                      <td className="r num">{money(p.metaSpendWithNoProduct)}</td>
                      <td className="r num neg"><b>{cost(p.metaSpendWithNoProduct)}</b></td>
                      <td />
                    </tr>
                    <tr>
                      <td>Rep commission and rewards <small>not split by product</small></td>
                      <td /><td /><td /><td /><td />
                      <td className="r num neg"><b>{cost(p.repCommission)}</b></td>
                      <td />
                    </tr>
                    <tr>
                      <td>Other expenses <small>not split by product</small></td>
                      <td /><td /><td /><td /><td />
                      <td className="r num neg"><b>{cost(p.otherExpenses)}</b></td>
                      <td />
                    </tr>
                    <tr className="tot">
                      <td>Net result</td>
                      <td className="r num">{p.totals.delivered}</td>
                      <td className="r num">{money(p.totals.revenue)}</td>
                      <td className="r num">{money(p.totals.productCost)}</td>
                      <td className="r num">{money(p.totals.fees)}</td>
                      <td className="r num">{money(p.metaSpendWithNoProduct)}</td>
                      <td className={`r num ${lossClass(p.netProfit) ?? ''}`}>{money(p.netProfit)}</td>
                      <td className="r"><Tag tone={marginTone(p.netMarginPct, p.targetNetMargin)}>{pct(p.netMarginPct)}</Tag></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {p.costMissingProducts > 0 && (
              <p className="note">{p.costMissingProducts} {p.costMissingProducts === 1 ? 'product has' : 'products have'} no cost yet, so its profit is not shown. Add its cost on the Products page.</p>
            )}
          </Card>
        );
      }}
    </Part>
  );
}
