import type { AgingPartner, AgingReport, UnpaidByAge } from '../../services/collections.service';

const buckets = (a: number, b: number, c: number, d: number) => [
  { key: '0-3' as const, label: '0-3 days', late: false, orders: a ? 1 : 0, amount: a },
  { key: '4-7' as const, label: '4-7 days', late: false, orders: b ? 1 : 0, amount: b },
  { key: '8-14' as const, label: '8-14 days', late: true, orders: c ? 1 : 0, amount: c },
  { key: '15+' as const, label: '15+ days', late: true, orders: d ? 1 : 0, amount: d },
];

export const KOFI: AgingPartner = {
  agentId: 7, name: 'Kofi Appiah', email: 'kofi@example.com', cashHeld: 672, negativeCashHeld: false, findingId: null, daysToPay: 2,
  unpaidOrders: 4, unpaidAmount: 672, buckets: buckets(224, 100, 200, 148), overdueOrders: 3, overdueAmount: 448,
  oldestUnpaidDays: 18, oldestDeliveredOn: '2026-10-04', isBlocked: false,
};
export const ESI: AgingPartner = {
  agentId: 8, name: 'Esi Badu', email: null, cashHeld: 100, negativeCashHeld: false, findingId: null, daysToPay: 7,
  unpaidOrders: 1, unpaidAmount: 100, buckets: buckets(100, 0, 0, 0), overdueOrders: 0, overdueAmount: 0,
  oldestUnpaidDays: 1, oldestDeliveredOn: '2026-10-21', isBlocked: true,
};

export const REPORT: AgingReport = {
  summary: {
    totalOutstandingAmount: 772, totalOrders: 5, overdueAmount: 448, overdueOrders: 3, overduePartners: 1, partnersWithCash: 2,
    negativeCashPartners: 0, blockedPartners: 1, bucketTotals: buckets(324, 100, 200, 148),
  },
  partners: [KOFI, ESI],
};

export const CARD: UnpaidByAge = {
  basis: 'net_of_delivery_fee',
  total: { orders: 5, amount: 772 },
  overdue: { orders: 3, amount: 448 },
  buckets: buckets(324, 100, 200, 148),
};
