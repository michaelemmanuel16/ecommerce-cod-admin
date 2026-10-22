import type { OrderCounts, OrderListRow } from '../../services/orders.service';

const person = (id: number, firstName: string, lastName: string) => ({ id, firstName, lastName });

export function row(id: number, over: Partial<OrderListRow> = {}): OrderListRow {
  return {
    id,
    status: 'pending_confirmation',
    totalAmount: 249,
    createdAt: '2026-10-17T14:02:00.000Z',
    customer: { id: id % 7, firstName: 'Abena', lastName: `Owusu${id}`, phoneNumber: '+233245550182', alternatePhone: null },
    customerRep: null,
    deliveryAgent: null,
    orderItems: [{ id: id * 10, quantity: 1, product: { id: 1, name: 'Copybook set' } }],
    flags: [],
    reminder: null,
    threadCount: null,
    ...over,
  };
}

export const ROWS: OrderListRow[] = [
  row(24117, { status: 'delivered', customerRep: person(2, 'Adwoa', 'Darko'), deliveryAgent: person(5, 'Kofi', 'Appiah'), orderItems: [{ id: 1, quantity: 2, product: { id: 1, name: 'Copybook set' } }, { id: 2, quantity: 1, product: { id: 2, name: 'Refill pens' } }] }),
  row(24113, { status: 'pending_confirmation', flags: [{ code: 'no_call_rep', label: 'No call rep' }, { code: 'waiting_too_long', label: 'Waiting too long' }], threadCount: 4, reminder: { dueAt: '2026-10-20T16:00:00.000Z' } }),
  row(24112, { status: 'confirmed', customerRep: person(2, 'Adwoa', 'Darko') }),
];

/** The October fixture: 21 + 41 + 38 waiting to dispatch, no digital orders, two payment orders. */
export const COUNTS: OrderCounts = {
  all: 1000,
  byStatus: {
    pending_confirmation: 64, payment_pending: 1, confirmed: 21, preparing: 41, ready_for_pickup: 38, out_for_delivery: 148,
    delivered: 376, digital_delivered: 0, cancelled: 355, returned: 48, failed_delivery: 354, payment_failed: 1,
  } as OrderCounts['byStatus'],
  waitingToDispatch: 100,
};
