import React, { useEffect } from 'react';
import { useOrdersStore } from '../stores/ordersStore';
import { Table, TableHead, TableBody, TableRow, TableCell } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { Loading } from '../components/ui/Loading';
import { Card } from '../components/ui/Card';

export const OrdersList: React.FC = () => {
  const { orders, isLoading, fetchOrders } = useOrdersStore();

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  if (isLoading) return <Loading />;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Orders List</h1>
      <Card padding="none">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell isHeader>Order #</TableCell>
              <TableCell isHeader>Customer</TableCell>
              <TableCell isHeader>Status</TableCell>
              <TableCell isHeader>Priority</TableCell>
              <TableCell isHeader>Amount</TableCell>
              <TableCell isHeader>Date</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell>{order.orderNumber}</TableCell>
                <TableCell>{order.customerName}</TableCell>
                <TableCell>
                  <Badge variant="status" status={order.status}>
                    {order.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="priority" priority={order.priority}>
                    {order.priority}
                  </Badge>
                </TableCell>
                <TableCell>${order.totalAmount}</TableCell>
                <TableCell>{new Date(order.createdAt).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};
