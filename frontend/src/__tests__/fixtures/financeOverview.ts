import type { FinanceOverview, OkTile } from '../../services/finance-overview.service';

const ok = (t: Partial<OkTile> & Pick<OkTile, 'key' | 'label' | 'value' | 'unit'>): OkTile =>
  ({ status: 'ok', tooltip: `${t.label} tooltip`, dateBasis: 'range', available: t.value !== 'n/a', tone: 'neutral', detail: {}, ...t });

/** The NUMBERS.md overview: revenue 92,000 over 376 orders, margin -16%, runway 9 days, Logiswift 840 short. */
export const OVERVIEW: FinanceOverview = {
  from: '2026-10-01', to: '2026-10-17', asOf: '2026-10-17', currency: 'GHS',
  tiles: [
    ok({ key: 'deliveredRevenue', label: 'Delivered revenue', unit: 'money', value: 92000, tooltip: 'Orders delivered 1 Oct to 17 Oct, counted on the delivery date.',
      detail: { deliveredOrders: 376, averageOrderValue: 244.68, ofWhichDigital: 59 } }),
    ok({ key: 'cashReceived', label: 'Cash received', unit: 'money', value: 13016, tone: 'ok', detail: { payouts: 2, percentOfDeliveredRevenue: 14 } }),
    ok({ key: 'cashOutstanding', label: 'Cash outstanding', unit: 'money', value: 23400, dateBasis: 'today', tone: 'warn', detail: { orders: 94, overdueOrders: 38, overdueAmount: 17300 } }),
    ok({ key: 'netMargin', label: 'Net margin', unit: 'percent', value: -15.5, tone: 'bad',
      detail: { target: 35, netProfit: -14268, revenue: 92000, expenses: { total: 106268, paystackFees: 1.5 } } }),
    ok({ key: 'profitPerOrder', label: 'Profit per delivered order', unit: 'money', value: -37.95, tone: 'bad', detail: { netProfit: -14268, deliveredOrders: 376 } }),
    ok({ key: 'cashRunway', label: 'Cash runway', unit: 'days', value: 9, dateBasis: 'today', tone: 'warn', detail: { level: 'tight', cash: 41900, adsPerDay: 4500, adDays: 7 } }),
  ],
  reconciliation: {
    basis: 'expected_cash_after_fees', from: '2026-10-01', to: '2026-10-17',
    counts: { matched: 1, short: 1, over: 1, unmatched: 0 },
    rows: [
      { id: 1, date: '2026-10-11', reference: 'LS-11OCT', partnerId: 7, partnerName: 'Logiswift 3PL', partnerKind: 'company', paidIn: 9880, expectedAfterFees: 10720, orders: 44,
        status: 'short', shortAmount: 840, overAmount: 0, unappliedAmount: 0,
        unpaid: { orders: 3, amount: 840, rows: [
          { orderId: 24098, orderNumber: '#24098', customer: 'Ama Nkrumah', area: 'Lapaz', deliveredOn: '2026-10-06', ageDays: 11, orderTotal: 249, fee: 35, amount: 214 },
          { orderId: 24071, orderNumber: '#24071', customer: 'Kojo Osei', area: 'Accra', deliveredOn: '2026-10-05', ageDays: 12, orderTotal: 348, fee: 35, amount: 313 },
          { orderId: 24063, orderNumber: '#24063', customer: 'Akosua Amoah', area: 'Tema', deliveredOn: '2026-10-04', ageDays: 13, orderTotal: 348, fee: 35, amount: 313 },
        ] } },
      { id: 2, date: '2026-10-09', reference: 'KA-9OCT', partnerId: 8, partnerName: 'Kofi Appiah', partnerKind: 'person', paidIn: 3136, expectedAfterFees: 3136, orders: 14,
        status: 'matched', shortAmount: 0, overAmount: 0, unappliedAmount: 0, unpaid: null },
      { id: 3, date: '2026-10-08', reference: 'EB-8OCT', partnerId: 9, partnerName: 'Esi Badu', partnerKind: 'person', paidIn: 2788, expectedAfterFees: 2688, orders: 12,
        status: 'over', shortAmount: 0, overAmount: 100, unappliedAmount: 0, unpaid: null },
    ],
  },
};
