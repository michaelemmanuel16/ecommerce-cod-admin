import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useOrdersStore } from '../stores/ordersStore';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Loading } from '../components/ui/Loading';

export const OrderDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { selectedOrder, isLoading, fetchOrderById } = useOrdersStore();

  useEffect(() => {
    if (id) {
      fetchOrderById(id);
    }
  }, [id, fetchOrderById]);

  if (isLoading) return <Loading />;
  if (!selectedOrder) return <div>Order not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Order {selectedOrder.orderNumber}</h1>
        <Badge variant="status" status={selectedOrder.status}>
          {selectedOrder.status}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-lg font-semibold mb-4">Customer Information</h3>
          <div className="space-y-2">
            <p><span className="font-medium">Name:</span> {selectedOrder.customerName}</p>
            <p><span className="font-medium">Email:</span> {selectedOrder.customerEmail}</p>
            <p><span className="font-medium">Phone:</span> {selectedOrder.customerPhone}</p>
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-semibold mb-4">Order Information</h3>
          <div className="space-y-2">
            <p><span className="font-medium">Total Amount:</span> ${selectedOrder.totalAmount}</p>
            <p><span className="font-medium">Payment Method:</span> {selectedOrder.paymentMethod}</p>
            <p>
              <span className="font-medium">Priority:</span>{' '}
              <Badge variant="priority" priority={selectedOrder.priority}>
                {selectedOrder.priority}
              </Badge>
            </p>
          </div>
        </Card>
      </div>

      <Card>
        <h3 className="text-lg font-semibold mb-4">Items</h3>
        <div className="space-y-2">
          {selectedOrder.items.map((item) => (
            <div key={item.id} className="flex justify-between py-2 border-b">
              <div>
                <p className="font-medium">{item.productName}</p>
                <p className="text-sm text-gray-600">Quantity: {item.quantity}</p>
              </div>
              <p className="font-medium">${item.total}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
