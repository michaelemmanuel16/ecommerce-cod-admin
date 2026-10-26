import type { FailureReasons, PartnerList, PartnerRow, PartnerSummary, RateResult, ReturnsSummary, WaitingList } from '../../services/delivery-partners.service';

const rate = (value: number | null, delivered = 0, failed = 0, returned = 0): RateResult => ({
  value,
  detail: { delivered, failed, returned, closed: delivered + failed + returned },
});

const row = (p: Partial<PartnerRow> & Pick<PartnerRow, 'partnerId' | 'name' | 'type'>): PartnerRow => ({
  isActive: true, isAvailable: true, isTrial: false, baseTown: null,
  assigned: 0, delivered: 0, failed: 0, returned: 0, failedOrReturned: 0, outNow: 0, notYetDispatched: 0,
  deliverySuccessRate: rate(null), confirmedToDispatchedDays: null, dispatchedToDeliveredDays: null,
  dataSource: 'app', daysToPay: null, feeRule: null, cashHeld: null, oldestUnpaidDays: null, ...p,
});

/** The partner table of docs/mockups/v2/NUMBERS.md. */
export const PARTNERS: PartnerRow[] = [
  row({ partnerId: 1, name: 'Logiswift', type: '3pl', baseTown: 'Accra', assigned: 590, delivered: 220, failed: 250, returned: 20, failedOrReturned: 270, outNow: 100, deliverySuccessRate: rate(44.9, 220, 250, 20), confirmedToDispatchedDays: 1.4, dispatchedToDeliveredDays: 3.8, dataSource: 'csv', daysToPay: 9, feeRule: { delivered: '35.00', failed: '0.00', returned: '0.00' } }),
  row({ partnerId: 2, name: 'Kofi Appiah', type: 'agent', baseTown: 'Kumasi', assigned: 172, delivered: 82, failed: 66, returned: 4, failedOrReturned: 70, outNow: 20, deliverySuccessRate: rate(53.9, 82, 66, 4), confirmedToDispatchedDays: 0.6, dispatchedToDeliveredDays: 1.2, daysToPay: 2, feeRule: { delivered: '25.00', failed: '5.00', returned: null } }),
  row({ partnerId: 3, name: 'Kasapa Express', type: '3pl', isTrial: true, assigned: 8, outNow: 8, dataSource: 'csv', feeRule: null }),
  row({ partnerId: 4, name: 'Esi Badu', type: 'agent', isAvailable: false, assigned: 102, delivered: 48, failedOrReturned: 40, failed: 38, returned: 2, outNow: 14, deliverySuccessRate: rate(54.5, 48, 38, 2) }),
];

export const LIST: PartnerList = {
  from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z', type: 'all',
  counts: { all: 5, agent: 3, '3pl': 2 },
  rows: PARTNERS,
  total: { assigned: 926, delivered: 376, failed: 354, returned: 48, failedOrReturned: 402, outNow: 148, notYetDispatched: 0, deliverySuccessRate: rate(48.3, 376, 354, 48) },
};

export const SUMMARY: PartnerSummary = {
  outNow: { orders: 148, partners: 5 },
  waiting: { orders: 100, oldestDays: 3 },
  delivered: { orders: 376, revenue: '92000.00', currency: 'GHS' },
  deliverySuccess: { rate: rate(48.3, 376, 354, 48), target: 60, gapPoints: 11.7 },
};

export const RETURNS: ReturnsSummary = {
  partners: [{ locationId: 7, partnerId: 1, name: 'Logiswift', sent: 41, received: 36, missing: 5 }],
  total: { sent: 41, received: 36, missing: 5 },
};

export const REASONS: FailureReasons = {
  total: 402, failed: 354, returned: 48,
  reasons: [
    { reason: 'not_reachable', count: 165, percent: 41 },
    { reason: 'refused', count: 96, percent: 23.9 },
    { reason: 'wrong_address', count: 84, percent: 20.9 },
    { reason: 'rescheduled', count: 57, percent: 14.2 },
    { reason: 'other', count: 0, percent: 0 },
  ],
};

export const WAITING: WaitingList = {
  orders: 100, oldestDays: 3, overdueAfterDays: 2,
  list: [
    { orderId: 24086, orderNumber: '24086', status: 'confirmed', customerName: 'Efua Quaye', region: 'Ashanti', area: 'Adum', ageDays: 3, overdue: true, partner: null, total: '249.00' },
    { orderId: 24085, orderNumber: '24085', status: 'preparing', customerName: 'Efua Amoah', region: 'Greater Accra', area: 'East Legon', ageDays: 1, overdue: false, partner: { id: 4, name: 'Esi Badu' }, total: '249.00' },
  ],
};
