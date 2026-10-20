import { OrderStatus } from '../types';

/**
 * The one display label per order status (12 values, mirrors the backend OrderStatus enum).
 * Typed as a full Record, so adding a status to `OrderStatus` without a label is a type error.
 * Role-specific labels (rep, agent) are views over this map.
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_confirmation: 'Pending Confirmation',
  payment_pending: 'Payment Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready_for_pickup: 'Ready for Pickup',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  digital_delivered: 'Digital Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
  failed_delivery: 'Failed Delivery',
  payment_failed: 'Payment Failed',
};
