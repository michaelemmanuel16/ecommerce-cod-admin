import { financeReportsService } from '../../../services/financeReports.service';
import { useBlock } from './useBlock';

// One hook per report block, keyed by the range, so a screen asks only for the blocks it shows and Finance and Reports
// use the very same calls for the same range.
export const useMonthlyPl = () => useBlock('monthly-pl', () => financeReportsService.monthlyPl());
export const useIncomeStatement = (from: string, to: string) => useBlock(`income|${from}|${to}`, () => financeReportsService.incomeStatement(from, to));
export const useBalanceSheet = (asOf: string) => useBlock(`balance|${asOf}`, () => financeReportsService.balanceSheet(asOf));
export const useProfitByProduct = (from: string, to: string) => useBlock(`profit|${from}|${to}`, () => financeReportsService.profitByProduct(from, to));
export const useCohortProfit = (from: string, to: string) => useBlock(`cohort|${from}|${to}`, () => financeReportsService.cohortProfit(from, to));
export const useFailedCost = (from: string, to: string) => useBlock(`failed|${from}|${to}`, () => financeReportsService.failedDeliveryCost(from, to));
