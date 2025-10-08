import React from 'react';
import { Order } from '../../types';
import { Badge } from '../ui/Badge';
import { Phone, MapPin, DollarSign, Package } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface OrderCardProps {
  order: Order;
}

export const OrderCard: React.FC<OrderCardProps> = ({ order }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: order.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-move"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <h4 className="font-semibold text-gray-900">{order.orderNumber}</h4>
          <p className="text-sm text-gray-600">{order.customerName}</p>
        </div>
        <Badge variant="priority" priority={order.priority}>
          {order.priority}
        </Badge>
      </div>

      <div className="space-y-2 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <Phone className="w-4 h-4" />
          <span>{order.customerPhone}</span>
        </div>
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4" />
          <span>{order.items.length} items</span>
        </div>
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4" />
          <span className="font-semibold text-gray-900">
            ${order.totalAmount}
          </span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          {new Date(order.createdAt).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
};
