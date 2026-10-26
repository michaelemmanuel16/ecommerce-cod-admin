// The October fixture of the M5 reports (docs/mockups/v2/NUMBERS.md): 376 delivered orders, revenue GH₵92,000, net -GH₵14,268.
// Shapes follow GET /api/financial/monthly-pl, /profit-loss, /balance-sheet, /profit-by-product, /cohort-profit and
// /failed-delivery-cost. Money is an API string.
import type {
  BalanceSheetStatement, CohortProfit, FailedDeliveryCost, IncomeStatement, MonthlyPl, PlColumn, ProfitByProduct,
} from '../../services/financeReports.service';

const col = (over: Partial<PlColumn>): PlColumn => ({
  key: 'to-date', label: '1-17 Oct', kind: 'to_date', from: '2026-10-01', to: '2026-10-17',
  revenue: '92000.00', productCost: '12000.00', grossProfit: '80000.00', grossMarginPct: 87, deliveryFees: '12200.00',
  metaSpend: '76200.00', paystackFees: '0.00', otherExpenses: '3100.00', totalExpenses: '94268.00',
  netProfit: '-14268.00', netMarginPct: -15.5, hasData: true, note: null, repCommission: '2768.00', repCommissionNote: null,
  metaRate: { kind: 'single', ngnPerGhs: 112 },
  ...over,
});

export const AUG_SEP_NOTE = 'Booked with the older cost per set. Not restated.';

export const monthlyPl = (): MonthlyPl => ({
  asOf: '2026-10-17', targetNetMargin: 35,
  columns: [
    col({ key: '2026-08', label: 'Aug', kind: 'month', from: '2026-08-01', to: '2026-08-31', revenue: '166000.00', netProfit: '20700.00', netMarginPct: 12.5, note: AUG_SEP_NOTE, repCommission: null, repCommissionNote: 'not split out' }),
    col({ key: '2026-09', label: 'Sep', kind: 'month', from: '2026-09-01', to: '2026-09-30', revenue: '173000.00', netProfit: '21300.00', netMarginPct: 12.3, note: AUG_SEP_NOTE, repCommission: null, repCommissionNote: 'not split out' }),
    col({ key: 'same-days-last-month', label: '1-17 Sep', kind: 'same_days_last_month', from: '2026-09-01', to: '2026-09-17', revenue: '96000.00', netProfit: '11800.00', netMarginPct: 12.3, repCommission: null, repCommissionNote: 'not split out' }),
    col({}),
  ],
});

export const incomeStatement = (): IncomeStatement => ({
  from: '2026-10-01', to: '2026-10-17', revenue: '92000.00', productCost: '12000.00', grossProfit: '80000.00', grossMarginPct: 87,
  deliveryFees: '12200.00', repCommission: '2768.00', metaSpend: '76200.00', paystackFees: '0.00', otherExpenses: '3100.00',
  totalExpenses: '94268.00', netProfit: '-14268.00', netMarginPct: -15.5, hasData: true,
});

export const balanceSheet = (): BalanceSheetStatement => ({
  asOf: '2026-10-17',
  assets: { lines: [{ code: '1010', name: 'Cash at bank and MoMo', amount: '41900.00' }, { code: '1015', name: 'Cash with delivery partners', amount: '23400.00' }, { code: '1200', name: 'Inventory', amount: '41600.00' }], total: '106900.00' },
  liabilities: { lines: [{ code: '2050', name: 'Supplier payables', amount: '9800.00' }, { code: '2020', name: 'Commissions payable', amount: '2168.00' }], total: '11968.00' },
  equity: { ownersEquity: '109200.00', resultToDate: '-14268.00', otherEquity: '0.00', total: '94932.00', hint: 'Set so the books balance with the October rep commission booked in 5050' },
  totalLiabilitiesAndEquity: '106900.00', isBalanced: true, outOfBalanceBy: null,
});

export const profitByProduct = (): ProfitByProduct => ({
  from: '2026-10-01', to: '2026-10-17',
  products: [
    { productId: 1, sku: 'COPY', name: 'Magic Groove copybook set', productType: 'physical', delivered: 376, units: 376, revenue: '92000.00', productCost: '12000.00', costMissing: false, costNote: null, fees: '12200.00', metaAds: '0.00', profit: '67800.00', marginPct: 73.7, profitPerDeliveredOrder: '180.32' },
    { productId: 2, sku: 'PENS', name: 'Refill pens', productType: 'physical', delivered: 12, units: 12, revenue: '480.00', productCost: null, costMissing: true, costNote: 'Cost missing', fees: '0.00', metaAds: '0.00', profit: null, marginPct: null, profitPerDeliveredOrder: null },
  ],
  totals: { delivered: 376, revenue: '92000.00', productCost: '12000.00', fees: '12200.00', metaAds: '0.00' },
  notMatchedToProductRow: { revenue: '0.00', productCost: '0.00', fees: '0.00' },
  metaSpendWithNoProduct: '76200.00', repCommission: '2768.00', otherExpenses: '3100.00',
  netProfit: '-14268.00', netMarginPct: -15.5, profitPerDeliveredOrder: '-37.95', costMissingProducts: 1,
});

export const cohortProfit = (): CohortProfit => ({
  from: '2026-10-01', to: '2026-10-17', available: true, yieldPct: 34, yieldLabel: 'Projected at 34% yield',
  ordersPlaced: 1445, projectedDelivered: 491, revenue: '120300.00', productCost: '14700.00', fees: '15900.00', metaAds: '76200.00',
  repCommission: '3600.00', profitBeforeOtherExpenses: '9900.00', marginPct: 8.2, profitPerDeliveredOrder: '20.16', byDeliveryDate: '-14268.00',
});

export const failedCost = (): FailedDeliveryCost => ({
  from: '2026-10-01', to: '2026-10-17',
  partners: [
    { partnerId: 1, name: 'Kofi Appiah', failedOrders: 70, fees: '350.00', unitsLost: 0, lostCost: '0.00', total: '350.00', hint: null },
    { partnerId: 2, name: 'Logiswift', failedOrders: 5, fees: '0.00', unitsLost: 5, lostCost: '150.00', total: '150.00', hint: null },
    { partnerId: 3, name: 'Kwesi Amoah', failedOrders: 22, fees: '110.00', unitsLost: 0, lostCost: '0.00', total: '110.00', hint: null },
    { partnerId: 4, name: 'Kasapa Express', failedOrders: 1, fees: '0.00', unitsLost: 0, lostCost: '0.00', total: '0.00', hint: 'No fee rule for this partner. The failed fee is 0.' },
  ],
  fees: '460.00', unitsLost: 5, lostCost: '150.00', total: '610.00',
});
