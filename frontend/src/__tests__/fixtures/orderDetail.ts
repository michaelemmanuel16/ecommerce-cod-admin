import type { OrderDetail, TimelineEntry } from '../../services/orders.service';

/** GET /api/orders/:id as orderDetailService.getDetail answers it. */
export const DETAIL: OrderDetail = {
  id: 24118,
  displayNumber: '#24118',
  status: 'pending_confirmation',
  orderType: 'physical',
  createdAt: '2026-10-17T14:02:00.000Z',
  updatedAt: '2026-10-17T14:05:00.000Z',
  statusVersion: 0,
  source: 'checkout_form',
  sourceLabel: 'Checkout form: Magic Groove copybook set',
  notes: null,
  deliveryAddress: '14 Adum Road, Adum',
  deliveryState: 'Ashanti',
  deliveryArea: 'Kumasi',
  discount: '0.00',
  subtotal: '249.00',
  totalAmount: '249.00',
  customer: { id: 7, firstName: 'Abena', lastName: 'Owusu', email: null, phoneNumber: '+233245550182', alternatePhone: null },
  items: [{ id: 1, productId: 1, quantity: 1, unitPrice: '249.00', totalPrice: '249.00', itemType: 'package', metadata: null, product: { id: 1, name: 'Copybook set' } }],
  assignees: { customerRep: { id: 2, firstName: 'Adwoa', lastName: 'Darko' }, deliveryAgent: null },
  calls: [{ id: 9, outcome: 'confirmed', notes: 'Wants delivery today.', createdAt: '2026-10-17T14:20:00.000Z', salesRep: { id: 2, firstName: 'Adwoa', lastName: 'Darko' } }],
  messages: [],
  flags: [],
  transitions: { status: 'pending_confirmation', normal: ['confirmed', 'cancelled'], forced: ['delivered'] },
  paymentTag: { code: 'pay_on_delivery', label: 'Pay on delivery' },
  payment: { method: 'cod', status: 'pending', amount: '249.00', deposit: null, cashHeldBy: 'Nobody yet' },
};

export const TIMELINE: TimelineEntry[] = [
  { kind: 'placed', size: 'main', at: '2026-10-17T14:02:00.000Z', title: 'Order placed', actor: null, note: null },
  { kind: 'status', size: 'main', at: '2026-10-17T14:14:00.000Z', title: 'Confirmed', actor: { kind: 'person', userId: 2, name: 'Adwoa Darko' }, note: null, status: 'confirmed', durationChip: 'Confirmed after 12 min' },
  { kind: 'edit', size: 'small', at: '2026-10-17T14:30:00.000Z', title: 'Edited deliveryAddress, totalAmount', actor: { kind: 'person', userId: 2, name: 'Adwoa Darko' }, note: null },
  { kind: 'status', size: 'main', at: '2026-10-18T09:00:00.000Z', title: 'Delivered', actor: { kind: 'ai_agent', userId: null, name: null }, note: null, status: 'delivered', override: true, reason: 'Customer paid at the office', durationChip: 'Delivered after 4.1 days' },
  { kind: 'status', size: 'main', at: '2026-10-19T09:00:00.000Z', title: 'Failed delivery', actor: { kind: 'system', userId: null, name: null }, note: 'Customer not reachable', status: 'failed_delivery' },
  { kind: 'planned', size: 'main', at: '2026-10-25T09:00:00.000Z', title: 'Re-delivery planned', actor: null, note: null },
];
