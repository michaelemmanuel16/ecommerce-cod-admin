import { Download } from 'lucide-react';
import { Button, Card, Tag } from '../../../components/ui-v2';
import type { BalanceSheetStatement, IncomeStatement } from '../../../services/financeReports.service';
import { parseMoney } from '../../../utils/money';
import { rangeLabel } from '../../reports/format';
import { shortDay } from '../../dashboard/format';
import { cost, lossClass, money, pct } from './format';
import { Part } from './Part';
import type { FinanceBlock } from './useBlock';

/** Income statement (F-922, M5-T25): delivered revenue down to the net result, from the ledger by entry date. */
export function IncomeStatementCard({ block }: { block: FinanceBlock<IncomeStatement> }) {
  return (
    <Part name="Income statement" block={block} height={380}>
      {(s) => (
        <Card title="Income statement" aside={rangeLabel(s.from, s.to)} className="fincard">
          <div className="tablewrap">
            <table className="dt" aria-label="Income statement">
              <tbody>
                <tr><td><b>Delivered revenue</b></td><td className="r num"><b>{money(s.revenue)}</b></td></tr>
                <tr><td>Product cost</td><td className="r num">{cost(s.productCost)}</td></tr>
                <tr className="tot"><td>Gross profit <small>{pct(s.grossMarginPct)} margin</small></td><td className="r num">{money(s.grossProfit)}</td></tr>
                <tr><td>Delivery fees</td><td className="r num">{cost(s.deliveryFees)}</td></tr>
                <tr><td>Meta ad spend</td><td className="r num">{cost(s.metaSpend)}</td></tr>
                <tr><td>Rep commission and rewards</td><td className="r num">{cost(s.repCommission)}</td></tr>
                {parseMoney(s.paystackFees) !== 0 && <tr><td>Payment fees</td><td className="r num">{cost(s.paystackFees)}</td></tr>}
                <tr><td>Other expenses</td><td className="r num">{cost(s.otherExpenses)}</td></tr>
                <tr className="tot"><td>Net result <small>{pct(s.netMarginPct)} margin</small></td><td className={`r num ${lossClass(s.netProfit) ?? ''}`}>{money(s.netProfit)}</td></tr>
              </tbody>
            </table>
          </div>
          {!s.hasData && <p className="note">Nothing is booked in these dates.</p>}
        </Card>
      )}
    </Part>
  );
}

/** Balance sheet (F-922, M5-T25): assets against liabilities and equity, with owner's equity (3010) and the result to date. */
export function BalanceSheetCard({ block }: { block: FinanceBlock<BalanceSheetStatement> }) {
  return (
    <Part name="Balance sheet" block={block} height={380}>
      {(b) => (
        <Card title="Balance sheet" aside={`At ${shortDay(b.asOf)}`} className="fincard">
          <div className="tablewrap">
            <table className="dt" aria-label="Balance sheet">
              <tbody>
                <tr><td><b>Assets</b></td><td /></tr>
                {b.assets.lines.map((l) => <tr key={l.code ?? l.name}><td>{l.name}</td><td className="r num">{money(l.amount)}</td></tr>)}
                <tr className="tot"><td>Total assets</td><td className="r num">{money(b.assets.total)}</td></tr>
                <tr><td><b>Liabilities</b></td><td /></tr>
                {b.liabilities.lines.map((l) => <tr key={l.code ?? l.name}><td>{l.name}</td><td className="r num">{money(l.amount)}</td></tr>)}
                <tr className="tot"><td>Total liabilities</td><td className="r num">{money(b.liabilities.total)}</td></tr>
                <tr><td><b>Equity</b></td><td /></tr>
                <tr>
                  <td>Owner&apos;s equity{b.equity.hint && <small>{b.equity.hint}</small>}</td>
                  <td className="r num">{money(b.equity.ownersEquity)}</td>
                </tr>
                {parseMoney(b.equity.otherEquity) !== 0 && <tr><td>Other equity</td><td className="r num">{money(b.equity.otherEquity)}</td></tr>}
                <tr><td>Result to date</td><td className={`r num ${lossClass(b.equity.resultToDate) ?? ''}`}>{money(b.equity.resultToDate)}</td></tr>
                <tr className="tot"><td>Liabilities and equity</td><td className="r num">{money(b.totalLiabilitiesAndEquity)}</td></tr>
              </tbody>
            </table>
          </div>
          {!b.isBalanced && (
            <p className="note" role="alert"><Tag tone="bad">Out of balance</Tag> by {money(b.outOfBalanceBy)}. Check the ledger entries.</p>
          )}
        </Card>
      )}
    </Part>
  );
}

/** The PDF of the statements is the browser's print dialog, as before (F-922): Save as PDF there. */
export function ExportPdfButton() {
  return <Button onClick={() => window.print()}><Download />Export PDF</Button>;
}
