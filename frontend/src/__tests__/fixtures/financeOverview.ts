import type { FinanceOverview, Tile } from '../../services/finance-overview.service';

/** The NUMBERS.md overview: revenue 92,000 over 376 orders, margin -16%, runway 9 days, Logiswift 840 short. */
const TILES: Tile[] = [
  { status: 'ok', key: 'deliveredRevenue', label: 'Delivered revenue', dateBasis: 'range', value: 92000, badge: null,
    tooltip: 'By delivery date. Orders delivered 1 Oct to 17 Oct.',
    detail: { deliveredOrders: 376, averageOrderValue: 244.68, ofWhichDigital: '59.00', target: { value: 180000, status: 'off_track' } } },
  { status: 'ok', key: 'cashReceived', label: 'Cash received', dateBasis: 'range', value: 13016, badge: { label: 'Paid in', tone: 'ok' },
    tooltip: 'By payment date. Cash that delivery partners paid in 1 Oct to 17 Oct.', detail: { payouts: 2, percentOfDeliveredRevenue: 14 } },
  { status: 'ok', key: 'cashOutstanding', label: 'Cash outstanding', dateBasis: 'today', value: 23400, badge: { label: 'Chase', tone: 'warn' },
    tooltip: 'As of today. Delivered orders whose cash a partner still holds.', detail: { orders: 94, overdueOrders: 38 } },
  { status: 'ok', key: 'netMargin', label: 'Net margin', dateBasis: 'range', value: -15.5, badge: { label: 'Loss', tone: 'bad' },
    tooltip: 'By ledger entry date. Net profit as a share of revenue.',
    detail: { target: 35, netProfit: -14268, expenses: { total: 106268, paystackFees: 1.5 } } },
  { status: 'ok', key: 'profitPerOrder', label: 'Profit per delivered order', dateBasis: 'range', value: -37.95, badge: { label: 'Loss', tone: 'bad' },
    tooltip: 'By delivery date. Net profit divided by delivered orders.',
    detail: { deliveredOrders: 376, topProduct: { name: 'Magic Groove copybook set', profitPerOrder: 180.32 } } },
  { status: 'ok', key: 'cashRunway', label: 'Cash runway, in days of ads', dateBasis: 'today', value: 9, badge: { label: 'Tight', tone: 'warn' },
    tooltip: 'As of today. Cash divided by the average daily Meta spend.', detail: { cash: 41900, adsPerDay: '4500.00', adDays: 7 } },
];

export const OVERVIEW: FinanceOverview = {
  from: '2026-10-01', to: '2026-10-17', currency: 'GHS',
  tiles: TILES,
  reconciliation: {
    rows: [
      { id: 1, date: '2026-10-11', partnerId: 11, partnerName: 'Logiswift 3PL', partnerKind: 'company', paidIn: 9880, expectedAfterFees: 10720, orders: 44,
        status: 'short', shortAmount: 840, overAmount: 0,
        unpaid: { orders: 3, amount: 840, rows: [
          { orderId: 24098, orderNumber: '#24098', customer: 'Ama Nkrumah', area: 'Lapaz', deliveredOn: '2026-10-06', ageDays: 11, orderTotal: 249, fee: 35, amount: 214 },
          { orderId: 24071, orderNumber: '#24071', customer: 'Kojo Osei', area: 'Accra', deliveredOn: '2026-10-05', ageDays: 12, orderTotal: 348, fee: 35, amount: 313 },
          { orderId: 24063, orderNumber: '#24063', customer: 'Akosua Amoah', area: 'Tema', deliveredOn: '2026-10-04', ageDays: 13, orderTotal: 348, fee: 35, amount: 313 },
        ] } },
      { id: 2, date: '2026-10-09', partnerId: 12, partnerName: 'Kofi Appiah', partnerKind: 'person', paidIn: 3136, expectedAfterFees: 3136, orders: 14,
        status: 'matched', shortAmount: 0, overAmount: 0, unpaid: null },
      { id: 3, date: '2026-10-08', partnerId: 13, partnerName: 'Esi Badu', partnerKind: 'person', paidIn: 2788, expectedAfterFees: 2688, orders: 12,
        status: 'over', shortAmount: 0, overAmount: 100, unpaid: null },
    ],
  },
};
