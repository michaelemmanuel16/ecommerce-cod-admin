import React, { useEffect } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { KanbanColumn } from './KanbanColumn';
import { OrderCard } from './OrderCard';
import { useOrdersStore } from '../../stores/ordersStore';
import { Order, OrderStatus } from '../../types';
import { Loading } from '../ui/Loading';
import toast from 'react-hot-toast';

const columns: { status: OrderStatus; title: string; color: string }[] = [
  { status: 'new_orders', title: 'New Orders', color: 'bg-purple-500' },
  { status: 'confirmation_pending', title: 'Confirmation Pending', color: 'bg-yellow-500' },
  { status: 'confirmed', title: 'Confirmed', color: 'bg-blue-500' },
  { status: 'being_prepared', title: 'Being Prepared', color: 'bg-orange-500' },
  { status: 'ready_for_pickup', title: 'Ready for Pickup', color: 'bg-cyan-500' },
  { status: 'out_for_delivery', title: 'Out for Delivery', color: 'bg-indigo-500' },
  { status: 'delivered', title: 'Delivered', color: 'bg-green-500' },
  { status: 'returned', title: 'Returned', color: 'bg-red-500' },
];

export const KanbanBoard: React.FC = () => {
  const { orders, isLoading, fetchOrders, updateOrderStatus } = useOrdersStore();
  const [activeOrder, setActiveOrder] = React.useState<Order | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleDragStart = (event: DragStartEvent) => {
    const order = orders.find((o) => o.id === event.active.id);
    setActiveOrder(order || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveOrder(null);

    if (!over) return;

    const orderId = active.id as string;
    const newStatus = over.id as OrderStatus;

    const order = orders.find((o) => o.id === orderId);
    if (!order || order.status === newStatus) return;

    try {
      await updateOrderStatus(orderId, newStatus);
      toast.success('Order status updated successfully');
    } catch (error) {
      toast.error('Failed to update order status');
    }
  };

  if (isLoading) {
    return <Loading />;
  }

  const getOrdersByStatus = (status: OrderStatus) =>
    orders.filter((order) => order.status === status);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((column) => (
          <KanbanColumn
            key={column.status}
            status={column.status}
            title={column.title}
            orders={getOrdersByStatus(column.status)}
            color={column.color}
          />
        ))}
      </div>
      <DragOverlay>
        {activeOrder ? <OrderCard order={activeOrder} /> : null}
      </DragOverlay>
    </DndContext>
  );
};
