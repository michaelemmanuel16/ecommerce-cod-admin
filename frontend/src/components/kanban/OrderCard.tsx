import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Order } from '../../types';
import { Phone, MapPin, DollarSign, Package } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';

interface OrderCardProps {
  order: Order;
}

export const OrderCard: React.FC<OrderCardProps> = ({ order }) => {
  const navigate = useNavigate();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: order.id });

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleClick = (e: React.MouseEvent) => {
    // Only navigate if not dragging
    if (!isDragging) {
      navigate(`/orders/${order.id}`);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-move"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <h4 className="font-semibold text-gray-900">{order.id}</h4>
          <p className="text-sm text-gray-600">{order.customerName}</p>
        </div>
      </div>

      <div className="space-y-2 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <Phone className="w-4 h-4" />
          <span>{order.customerPhone}</span>
        </div>
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4" />
          <span>{order.items?.length || 0} items</span>
        </div>
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4" />
          <span className="font-semibold text-gray-900">
            ${typeof order.totalAmount === 'number' ? order.totalAmount.toFixed(2) : order.totalAmount}
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
