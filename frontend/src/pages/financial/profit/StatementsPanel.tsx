import { BalanceSheetCard, IncomeStatementCard } from './StatementCards';
import { MonthlyPlCard } from './MonthlyPlCard';
import { useBalanceSheet, useIncomeStatement, useMonthlyPl } from './blocks';
import { useFinanceRange } from './range';

/** Statements (M5-T40, F-922, F-923): the income statement and balance sheet for the range, and the monthly profit and loss. */
export function StatementsPanel() {
  const { from, to } = useFinanceRange();
  const income = useIncomeStatement(from, to);
  const balance = useBalanceSheet(to);
  const monthly = useMonthlyPl();
  return (
    <div className="fin">
      <div className="grid two even">
        <IncomeStatementCard block={income} />
        <BalanceSheetCard block={balance} />
      </div>
      <MonthlyPlCard block={monthly} />
    </div>
  );
}
