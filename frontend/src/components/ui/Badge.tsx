import React from 'react';
import { cn } from '../../utils/cn';
import { OrderStatus, OrderPriority } from '../../types';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'status' | 'priority' | 'default';
  status?: OrderStatus;
  priority?: OrderPriority;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  status,
  priority,
  className,
}) => {
  const statusColors: Record<OrderStatus, string> = {
    new_orders: 'bg-purple-100 text-purple-800',
    confirmation_pending: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-blue-100 text-blue-800',
    being_prepared: 'bg-orange-100 text-orange-800',
    ready_for_pickup: 'bg-cyan-100 text-cyan-800',
    out_for_delivery: 'bg-indigo-100 text-indigo-800',
    delivered: 'bg-green-100 text-green-800',
    returned: 'bg-red-100 text-red-800',
  };

  const priorityColors: Record<OrderPriority, string> = {
    low: 'bg-gray-100 text-gray-800',
    medium: 'bg-blue-100 text-blue-800',
    high: 'bg-orange-100 text-orange-800',
    urgent: 'bg-red-100 text-red-800',
  };

  let colorClass = 'bg-gray-100 text-gray-800';

  if (variant === 'status' && status) {
    colorClass = statusColors[status];
  } else if (variant === 'priority' && priority) {
    colorClass = priorityColors[priority];
  }

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        colorClass,
        className
      )}
    >
      {children}
    </span>
  );
};
