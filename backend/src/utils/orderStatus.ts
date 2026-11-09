import { OrderStatus } from '@prisma/client';

/**
 * F-771: The single display label source per order status (12 values, mirrors OrderStatus enum).
 * Used across rep, admin, and agent screens.
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_confirmation: 'Pending confirmation',
  payment_pending: 'Payment pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready_for_pickup: 'Ready for pickup',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  digital_delivered: 'Digital delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
  failed_delivery: 'Failed delivery',
  payment_failed: 'Payment failed',
};

export const getOrderStatusLabel = (status: OrderStatus): string => ORDER_STATUS_LABELS[status] ?? status;
