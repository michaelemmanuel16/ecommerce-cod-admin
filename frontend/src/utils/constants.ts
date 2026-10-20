import { OrderStatus, OrderPriority } from '../types';
import { ORDER_STATUS_LABELS } from './orderStatus';

type StatusStyle = { color: string; bgColor: string };

const ORDER_STATUS_STYLES: Record<OrderStatus, StatusStyle> = {
  pending_confirmation: {
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-100',
  },
  confirmed: {
    color: 'text-green-700',
    bgColor: 'bg-green-100',
  },
  preparing: {
    color: 'text-purple-700',
    bgColor: 'bg-purple-100',
  },
  ready_for_pickup: {
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-100',
  },
  out_for_delivery: {
    color: 'text-orange-700',
    bgColor: 'bg-orange-100',
  },
  delivered: {
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-100',
  },
  cancelled: {
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
  },
  returned: {
    color: 'text-red-700',
    bgColor: 'bg-red-100',
  },
  payment_pending: {
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-100',
  },
  digital_delivered: {
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-100',
  },
  payment_failed: {
    color: 'text-red-700',
    bgColor: 'bg-red-100',
  },
  failed_delivery: {
    color: 'text-red-700',
    bgColor: 'bg-red-100',
  },
};

export const ORDER_STATUS_CONFIG = Object.fromEntries(
  (Object.keys(ORDER_STATUS_STYLES) as OrderStatus[]).map((status) => [
    status,
    { label: ORDER_STATUS_LABELS[status], ...ORDER_STATUS_STYLES[status] },
  ])
) as Record<OrderStatus, StatusStyle & { label: string }>;

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
