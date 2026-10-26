import { apiClient } from './api';
import { financialService } from './financial.service';

/**
 * The Finance report APIs of M5 (COD-52 part 2): monthly P&L, the two statements, profit by product, the cohort card, the
 * cost of failed deliveries, and the cash flow with its scenario. Money is an API string, or a number once the client
 * has normalized the key; every figure goes through formatCurrency or parseMoney, never `+` (see utils/money).
 */
export type Money = string | number;

// ── Monthly profit and loss (F-923) ─────────────────────────────────────────────────

export interface PlColumn {
  key: string;
  label: string;
  kind: 'month' | 'same_days_last_month' | 'to_date';
  from: string;
  to: string;
  revenue: Money;
  productCost: Money;
  grossProfit: Money;
  grossMarginPct: number | null;
  deliveryFees: Money;
  metaSpend: Money;
  paystackFees: Money;
  otherExpenses: Money;
  totalExpenses: Money;
  netProfit: Money;
  netMarginPct: number | null;
  hasData: boolean;
  note: string | null;
  /** Null when the column was booked before commission had its own line. */
  repCommission: Money | null;
  repCommissionNote: string | null;
  metaRate: { kind: 'none' | 'single' | 'mixed'; ngnPerGhs: number | null };
}

export interface MonthlyPl {
  asOf: string;
  targetNetMargin: number;
  columns: PlColumn[];
}

// ── Statements (F-922) ──────────────────────────────────────────────────────────────

export interface IncomeStatement {
  from: string;
  to: string;
  revenue: Money;
  productCost: Money;
  grossProfit: Money;
  grossMarginPct: number | null;
  deliveryFees: Money;
  repCommission: Money;
  metaSpend: Money;
  paystackFees: Money;
  otherExpenses: Money;
  totalExpenses: Money;
  netProfit: Money;
  netMarginPct: number | null;
  hasData: boolean;
}

export interface StatementLine { code: string | null; name: string; amount: Money }

export interface BalanceSheetStatement {
  asOf: string;
  assets: { lines: StatementLine[]; total: Money };
  liabilities: { lines: StatementLine[]; total: Money };
  equity: { ownersEquity: Money; resultToDate: Money; otherEquity: Money; total: Money; hint: string | null };
  totalLiabilitiesAndEquity: Money;
  isBalanced: boolean;
  outOfBalanceBy: Money | null;
}

// ── Profit by product, cohort, failed deliveries (F-924 to F-926) ───────────────────

export interface ProductProfitRow {
  productId: number;
  sku: string;
  name: string;
  productType: string;
  delivered: number;
  units: number;
  revenue: Money;
  productCost: Money | null;
  costMissing: boolean;
  costNote: string | null;
  fees: Money;
  metaAds: Money;
  profit: Money | null;
  marginPct: number | null;
  profitPerDeliveredOrder: Money | null;
}

export interface ProfitByProduct {
  from: string;
  to: string;
  products: ProductProfitRow[];
  totals: { delivered: number; revenue: Money; productCost: Money; fees: Money; metaAds: Money };
  notMatchedToProductRow: { revenue: Money; productCost: Money; fees: Money };
  metaSpendWithNoProduct: Money;
  repCommission: Money;
  otherExpenses: Money;
  netProfit: Money;
  netMarginPct: number | null;
  targetNetMargin: number;
  profitPerDeliveredOrder: Money | null;
  costMissingProducts: number;
}

/** Profit of each product for the last months, the current one to date (the chart on Profit by product). */
export interface ProfitTrend {
  months: Array<{ key: string; label: string; from: string; to: string }>;
  products: Array<{ productId: number; name: string; revenue: Money; profits: Array<Money | null> }>;
}

export type CohortProfit =
  | { from: string; to: string; available: false; message: string }
  | {
    from: string; to: string; available: true;
    yieldPct: number; yieldLabel: string;
    ordersPlaced: number; projectedDelivered: number;
    revenue: Money; productCost: Money; fees: Money; metaAds: Money; repCommission: Money;
    profitBeforeOtherExpenses: Money; marginPct: number | null;
    profitPerDeliveredOrder: Money | null;
    byDeliveryDate: Money;
  };

export interface FailedCostPartner {
  partnerId: number | null;
  name: string;
  failedOrders: number;
  fees: Money;
  unitsLost: number;
  lostCost: Money;
  total: Money;
  hint: string | null;
}

export interface FailedDeliveryCost {
  from: string;
  to: string;
  partners: FailedCostPartner[];
  fees: Money;
  unitsLost: number;
  lostCost: Money;
  total: Money;
}

// ── Cash flow (F-928) and trend (F-929) ─────────────────────────────────────────────

export type Scenario = 'pace' | 'target';

export interface CashFlowForecastDay {
  date: string;
  expectedCollection: Money;
  expectedExpense: Money;
  projectedBalance: Money;
}

export interface CashFlowForecastReport {
  kpis: {
    /** 1010 */
    cashInHand: Money;
    /** 1015 */
    cashInTransit: Money;
    /** Orders out for delivery: expected, never part of cash. */
    cashExpected: Money;
    cashAvailableNow: Money;
    totalCashPosition: Money;
    totalCashPipeline: Money;
    supplierPayables: Money;
  };
  payDays: { default: number; overall: number; fromHistory: boolean; byPartner: Record<string, number> };
  scenario: { key: Scenario; currentRate: number | null; targetRate: number; multiplier: number };
  forecast: CashFlowForecastDay[];
  summary: {
    cashToday: Money;
    expectedIn: Money;
    expectedOut: Money;
    endDate: string;
    endBalance: Money;
    lowest: { date: string; balance: Money };
    runsOutOn: string | null;
    tightDays: number;
    status: 'safe' | 'tight' | 'runs_out';
  };
  weeks: Array<{ from: string; to: string; moneyIn: Money; moneyOut: Money; net: Money; cashAtEnd: Money }>;
}

export type ExportReport = 'profit-loss' | 'agent-aging' | 'general-ledger' | 'cash-flow';
export type ExportFormat = 'csv' | 'xlsx';

/** A GET whose card shows its own error (so no toast). The answers are cached by useBlock, so the 5 second request cache stays. */
const get = async <T>(url: string, params?: Record<string, string>): Promise<T> => (await apiClient.get<T>(url, { params, quiet: true })).data;

export const financeReportsService = {
  monthlyPl: () => get<MonthlyPl>('/api/financial/monthly-pl'),

  async incomeStatement(from: string, to: string): Promise<IncomeStatement> {
    return (await get<{ statement: IncomeStatement }>('/api/financial/profit-loss', { startDate: from, endDate: to })).statement;
  },

  async balanceSheet(asOf: string): Promise<BalanceSheetStatement> {
    return (await get<{ statement: BalanceSheetStatement }>('/api/financial/balance-sheet', { asOfDate: asOf })).statement;
  },

  profitByProduct: (from: string, to: string) => get<ProfitByProduct>('/api/financial/profit-by-product', { from, to }),
  profitTrend: (months = 3) => get<ProfitTrend>('/api/financial/profit-by-product/trend', { months: String(months) }),
  cohortProfit: (from: string, to: string) => get<CohortProfit>('/api/financial/cohort-profit', { from, to }),
  failedDeliveryCost: (from: string, to: string) => get<FailedDeliveryCost>('/api/financial/failed-delivery-cost', { from, to }),
  cashFlow: (scenario: Scenario) => get<CashFlowForecastReport>('/api/financial/cash-flow', { scenario }),

  /**
   * One Finance export as a real file (F-930). A ledger over the line limit answers 202 with a job id: this waits for the
   * job and downloads its file. Resolves with the blob and the name the server chose.
   */
  async exportFile(
    report: ExportReport,
    params: { startDate?: string; endDate?: string; format: ExportFormat; scenario?: Scenario },
    opts: { onQueued?: () => void } = {},
  ): Promise<{ blob: Blob; filename: string }> {
    const response = await apiClient.get(`/api/financial/export/${report}`, { params, responseType: 'blob', skipCache: true, quiet: true });
    const named = (headers: unknown) => /filename="?([^";]+)"?/.exec(String((headers as Record<string, unknown> | undefined)?.['content-disposition'] ?? ''))?.[1];
    if (response.status !== 202) {
      return { blob: response.data as Blob, filename: named(response.headers) ?? `${report}.${params.format}` };
    }
    const { jobId } = JSON.parse(await (response.data as Blob).text());
    opts.onQueued?.();
    const job = await financialService.waitForFinanceJob(jobId);
    return { blob: await financialService.downloadFinanceJob(job.result!.downloadUrl), filename: job.result!.filename };
  },
};
