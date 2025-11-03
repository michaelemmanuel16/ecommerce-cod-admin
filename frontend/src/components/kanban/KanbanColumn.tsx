import React from 'react';
import { Order, OrderStatus } from '../../types';
import { OrderCard } from './OrderCard';
import { useDroppable } from '@dnd-kit/core';

interface KanbanColumnProps {
  status: OrderStatus;
  title: string;
  orders: Order[];
  color: string;
}

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  status,
  title,
  orders,
  color,
}) => {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex-shrink-0 w-80">
      <div className={`bg-gray-100 rounded-lg p-4 h-full flex flex-col transition-colors ${
        isOver ? 'bg-blue-50 ring-2 ring-blue-400' : ''
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${color}`} />
            <h3 className="font-semibold text-gray-900">{title}</h3>
          </div>
          <span className="bg-gray-200 text-gray-700 px-2 py-1 rounded-full text-xs font-medium">
            {orders.length}
          </span>
        </div>
        <div
          ref={setNodeRef}
          className="flex-1 space-y-3 overflow-y-auto"
        >
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      </div>
    </div>
  );
};
