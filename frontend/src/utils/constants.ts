import { OrderStatus, OrderPriority } from '../types';

export const ORDER_STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; bgColor: string }> = {
  pending_confirmation: {
    label: 'Pending Confirmation',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-100',
  },
  confirmed: {
    label: 'Confirmed',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
  },
  preparing: {
    label: 'Preparing',
    color: 'text-purple-700',
    bgColor: 'bg-purple-100',
  },
  ready_for_pickup: {
    label: 'Ready for Pickup',
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-100',
  },
  out_for_delivery: {
    label: 'Out for Delivery',
    color: 'text-orange-700',
    bgColor: 'bg-orange-100',
  },
  delivered: {
    label: 'Delivered',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-100',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
  },
  returned: {
    label: 'Returned',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
  },
  failed_delivery: {
    label: 'Failed Delivery',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
  },
};

export const PRIORITY_CONFIG: Record<OrderPriority, { label: string; color: string; bgColor: string }> = {
  urgent: {
    label: 'Urgent',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
  },
  high: {
    label: 'High',
    color: 'text-orange-700',
    bgColor: 'bg-orange-100',
  },
  medium: {
    label: 'Medium',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-100',
  },
  low: {
    label: 'Low',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
  },
};

export const KANBAN_COLUMNS: OrderStatus[] = [
  'pending_confirmation',
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
  'failed_delivery',
];

export const ITEMS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

export const DEFAULT_PAGINATION = {
  page: 1,
  limit: 25,
};
