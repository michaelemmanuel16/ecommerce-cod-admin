import type { CustomerDetail, CustomerRow, CustomerSummary } from '../../services/customers.service';

export function customer(id: number, over: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id,
    firstName: 'Abena',
    lastName: 'Owusu',
    email: null,
    phoneNumber: '+233245550182',
    alternatePhone: null,
    address: '12 Ring Road',
    state: 'Ashanti',
    area: 'Kumasi',
    landmark: null,
    notes: null,
    totalOrders: 5,
    deliveredOrders: 4,
    refusedOrders: 0,
    deliveredValue: 996,
    lastOrderAt: '2026-10-17T14:02:00.000Z',
    risk: 'low',
    codBlocked: false,
    notReachable: false,
    smsOptOut: false,
    whatsappOptOut: false,
    emailOptOut: false,
    isActive: true,
    createdAt: '2026-01-05T09:00:00.000Z',
    ...over,
  };
}

export const ROWS: CustomerRow[] = [
  customer(1),
  customer(2, { firstName: 'Yaw', lastName: 'Boateng', phoneNumber: '+233245550103', totalOrders: 4, deliveredOrders: 1, refusedOrders: 2, deliveredValue: 249, risk: 'high', notReachable: true }),
  customer(3, { firstName: 'Selorm', lastName: 'Agbeko', phoneNumber: '+233265550127', area: 'Tema', totalOrders: 6, deliveredOrders: 3, refusedOrders: 3, risk: 'high', codBlocked: true }),
  customer(4, { firstName: 'Efua', lastName: 'Asante', phoneNumber: '+233555550177', area: 'Accra', totalOrders: 0, deliveredOrders: 0, deliveredValue: 0, lastOrderAt: null }),
];

export const SUMMARY: CustomerSummary = {
  tiles: { total: 6420, newThisMonth: 312, firstTime: 4980, firstTimePct: 78, repeat: 1440, repeatPct: 22, blocked: 23 },
  segments: { all: 6420, repeat: 1440, first_time: 4980, refused_before: 612, not_reachable: 318 },
};

export const DETAIL: CustomerDetail = {
  ...customer(1, { email: 'abena@example.com', alternatePhone: '+233200001111', landmark: 'Opposite the bank', notes: 'Calls after 6pm' }),
  averageOrderValue: 249,
  orders: [
    { id: 24117, status: 'delivered', totalAmount: 249, createdAt: '2026-10-17T14:02:00.000Z' },
    { id: 24090, status: 'out_for_delivery', totalAmount: 498, createdAt: '2026-10-12T10:30:00.000Z' },
  ],
};
