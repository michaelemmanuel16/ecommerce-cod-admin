import React, { useEffect } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core';
import { KanbanColumn } from './KanbanColumn';
import { OrderCard } from './OrderCard';
import { useOrdersStore } from '../../stores/ordersStore';
import { Order, OrderStatus } from '../../types';
import { Loading } from '../ui/Loading';
import toast from 'react-hot-toast';

const columns: { status: OrderStatus; title: string; color: string }[] = [
  { status: 'pending_confirmation', title: 'Pending Confirmation', color: 'bg-yellow-500' },
  { status: 'confirmed', title: 'Confirmed', color: 'bg-blue-500' },
  { status: 'preparing', title: 'Preparing', color: 'bg-orange-500' },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    const order = orders.find((o) => o.id === event.active.id);
    setActiveOrder(order || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveOrder(null);

    if (!over) return;

    const orderId = active.id as number;

    // Check if over.id is a column (status) or an order
    let newStatus: OrderStatus;
    const validStatuses: OrderStatus[] = [
      'pending_confirmation', 'confirmed', 'preparing', 'ready_for_pickup',
      'out_for_delivery', 'delivered', 'cancelled', 'returned', 'failed_delivery'
    ];

    if (validStatuses.includes(over.id as OrderStatus)) {
      // Dropped on a column
      newStatus = over.id as OrderStatus;
    } else {
      // Dropped on another order - find the column that contains it
      const targetOrder = orders.find(o => o.id === over.id);
      if (!targetOrder) return;
      newStatus = targetOrder.status;
    }

    const order = orders.find((o) => o.id === orderId);
    if (!order || order.status === newStatus) return;

    try {
      console.log('Updating order status:', { orderId, newStatus });
      await updateOrderStatus(orderId, newStatus);
      toast.success('Order status updated successfully');
    } catch (error: any) {
      console.error('Failed to update order status:', error);
      console.error('Error response:', error.response?.data);
      const errorMsg = error.response?.data?.details?.[0]?.msg || error.response?.data?.error || 'Failed to update order status';
      toast.error(errorMsg);
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
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 pb-4 h-full">
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
