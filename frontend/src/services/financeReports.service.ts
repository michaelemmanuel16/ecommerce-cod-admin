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
  profitPerDeliveredOrder: Money | null;
  costMissingProducts: number;
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
    status: 'safe' | 'tight' | 'runs_out';
  };
  weeks: Array<{ from: string; to: string; moneyIn: Money; moneyOut: Money; net: Money; cashAtEnd: Money }>;
}

export interface TrendRow { date: string; revenue: Money; expenses: Money; profit: Money; orders: number }
export interface Trend { reports: TrendRow[]; grouping: 'day' | 'week' | 'month' }

export type ExportReport = 'profit-loss' | 'agent-aging' | 'general-ledger' | 'cash-flow';
export type ExportFormat = 'csv' | 'xlsx';

const quiet = { quiet: true } as const; // each card shows its own error with Retry, so no second toast

export const financeReportsService = {
  async monthlyPl(): Promise<MonthlyPl> {
    const { data } = await apiClient.get<MonthlyPl>('/api/financial/monthly-pl', { ...quiet, skipCache: true });
    return data;
  },

  async incomeStatement(from: string, to: string): Promise<IncomeStatement> {
    const { data } = await apiClient.get<{ statement: IncomeStatement }>('/api/financial/profit-loss', { params: { startDate: from, endDate: to }, ...quiet, skipCache: true });
    return data.statement;
  },

  async balanceSheet(asOf: string): Promise<BalanceSheetStatement> {
    const { data } = await apiClient.get<{ statement: BalanceSheetStatement }>('/api/financial/balance-sheet', { params: { asOfDate: asOf }, ...quiet, skipCache: true });
    return data.statement;
  },

  async profitByProduct(from: string, to: string): Promise<ProfitByProduct> {
    const { data } = await apiClient.get<ProfitByProduct>('/api/financial/profit-by-product', { params: { from, to }, ...quiet, skipCache: true });
    return data;
  },

  async cohortProfit(from: string, to: string): Promise<CohortProfit> {
    const { data } = await apiClient.get<CohortProfit>('/api/financial/cohort-profit', { params: { from, to }, ...quiet, skipCache: true });
    return data;
  },

  async failedDeliveryCost(from: string, to: string): Promise<FailedDeliveryCost> {
    const { data } = await apiClient.get<FailedDeliveryCost>('/api/financial/failed-delivery-cost', { params: { from, to }, ...quiet, skipCache: true });
    return data;
  },

  async cashFlow(scenario: Scenario): Promise<CashFlowForecastReport> {
    const { data } = await apiClient.get<CashFlowForecastReport>('/api/financial/cash-flow', { params: { scenario }, ...quiet, skipCache: true });
    return data;
  },

  async trend(from: string, to: string): Promise<Trend> {
    const { data } = await apiClient.get<Trend>('/api/financial/reports', { params: { period: 'daily', startDate: from, endDate: to }, ...quiet, skipCache: true });
    return data;
  },

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
