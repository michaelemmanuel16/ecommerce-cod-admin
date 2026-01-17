import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, User, MapPin, Phone, Mail, Calendar, DollarSign, CreditCard } from 'lucide-react';
import { ordersService } from '../services/orders.service';
import { callsService } from '../services/calls.service';
import { Order, Call } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Loading } from '../components/ui/Loading';
import { LogCallModal } from '../components/calls/LogCallModal';
import { formatCurrency } from '../utils/format';

export const OrderDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLogCallModalOpen, setIsLogCallModalOpen] = useState(false);
  const [orderCalls, setOrderCalls] = useState<Call[]>([]);

  useEffect(() => {
    if (id) {
      loadOrder(id);
      loadOrderCalls(id);
    }
  }, [id]);

  const loadOrder = async (orderId: string) => {
    try {
      setIsLoading(true);
      const id = parseInt(orderId, 10);
      if (isNaN(id)) throw new Error('Invalid order ID');
      const data = await ordersService.getOrderById(id);
      setOrder(data);
    } catch (error) {
      console.error('Failed to load order:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadOrderCalls = async (orderId: string) => {
    try {
      const calls = await callsService.getCallsByOrder(parseInt(orderId));
      setOrderCalls(calls);
    } catch (error) {
      console.error('Failed to load order calls:', error);
    }
  };

  if (isLoading) {
    return <Loading />;
  }

  if (!order) {
    return (
      <Card>
        <div className="text-center py-12">
          <p className="text-gray-600">Order not found</p>
          <Button variant="primary" onClick={() => navigate('/orders')} className="mt-4">
            Back to Orders
          </Button>
        </div>
      </Card>
    );
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending_confirmation: 'bg-yellow-100 text-yellow-800',
      confirmed: 'bg-blue-100 text-blue-800',
      preparing: 'bg-orange-100 text-orange-800',
      ready_for_pickup: 'bg-cyan-100 text-cyan-800',
      out_for_delivery: 'bg-indigo-100 text-indigo-800',
      delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      returned: 'bg-purple-100 text-purple-800',
      failed_delivery: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getPaymentStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      paid: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      refunded: 'bg-purple-100 text-purple-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Button variant="ghost" onClick={() => navigate('/orders')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div className="flex items-center justify-between mt-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{order.id}</h1>
            <p className="text-sm text-gray-500 mt-1">
              Created {new Date(order.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(order.status)}`}>
              {order.status ? order.status.replace(/_/g, ' ') : 'Unknown'}
            </span>
            <Button
              variant="primary"
              onClick={() => setIsLogCallModalOpen(true)}
              className="flex items-center gap-2"
            >
              <Phone className="w-4 h-4" />
              Log Call
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content - 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Items */}
          <Card>
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Package className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-semibold">Order Items</h2>
              </div>
              <div className="space-y-3">
                {order.items && order.items.length > 0 ? (
                  order.items.map((item, index) => {
                    const isUpsell = item.itemType === 'upsell';
                    const itemName = isUpsell
                      ? (item.metadata?.upsellName || 'Add-on')
                      : (item.productName || 'Product');
                    const hasDiscount = item.metadata?.discountType && item.metadata?.discountType !== 'none';

                    return (
                      <div key={item.id || index} className="py-3 border-b last:border-b-0">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-medium text-gray-900">{itemName}</p>
                              {isUpsell && (
                                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded">
                                  Add-on
                                </span>
                              )}
                            </div>

                            {/* Show upsell description if available */}
                            {isUpsell && item.metadata?.upsellDescription && (
                              <p className="text-sm text-gray-600 mb-1">{item.metadata.upsellDescription}</p>
                            )}

                            <p className="text-sm text-gray-500">Quantity: {item.quantity}</p>

                            {/* Show discount info if available */}
                            {hasDiscount && item.metadata?.originalPrice && (
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-sm text-gray-400 line-through">
                                  {formatCurrency(item.metadata.originalPrice)}
                                </span>
                                <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-medium">
                                  {item.metadata.discountType === 'percentage'
                                    ? `-${item.metadata.discountValue}%`
                                    : `-${formatCurrency(item.metadata.discountValue || 0)}`}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="font-medium text-gray-900">{formatCurrency(item.total || (item.price || 0) * item.quantity)}</p>
                            <p className="text-sm text-gray-500">{formatCurrency(item.price || 0)} each</p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-gray-500 text-center py-4">No items in this order</p>
                )}
              </div>
              <div className="border-t pt-4 mt-4">
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span>{formatCurrency(order.totalAmount)}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Customer Information */}
          <Card>
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <User className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-semibold">Customer Information</h2>
              </div>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <User className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-500">Name</p>
                    <p className="font-medium text-gray-900">{order.customerName}</p>
                  </div>
                </div>
                {order.customerEmail && (
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-500">Email</p>
                      <p className="font-medium text-gray-900">{order.customerEmail}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <Phone className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-500">Phone</p>
                    <p className="font-medium text-gray-900">{order.customerPhone}</p>
                  </div>
                </div>
                {order.shippingAddress?.phone && order.shippingAddress.phone !== order.customerPhone && (
                  <div className="flex items-start gap-3">
                    <Phone className="w-5 h-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-500">Alternative Phone</p>
                      <p className="font-medium text-gray-900">{order.shippingAddress.phone}</p>
                    </div>
                  </div>
                )}
                {order.shippingAddress && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-500">Shipping Address</p>
                      <p className="font-medium text-gray-900">
                        {order.shippingAddress.street}<br />
                        {order.shippingAddress.area}, {order.shippingAddress.state}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Sidebar - 1 column */}
        <div className="space-y-6">
          {/* Payment Information */}
          <Card>
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-semibold">Payment</h2>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Payment Method</p>
                  <div className="flex items-center gap-2 mt-1">
                    <CreditCard className="w-4 h-4 text-gray-400" />
                    <p className="font-medium text-gray-900 uppercase">{order.paymentMethod}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Payment Status</p>
                  <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium mt-1 ${getPaymentStatusColor(order.paymentStatus)}`}>
                    {order.paymentStatus}
                  </span>
                </div>
                <div className="pt-3 border-t">
                  <p className="text-sm text-gray-500">Total Amount</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(order.totalAmount)}</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Order Timeline */}
          <Card>
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-semibold">Timeline</h2>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Created</p>
                  <p className="font-medium text-gray-900">{new Date(order.createdAt).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Last Updated</p>
                  <p className="font-medium text-gray-900">{new Date(order.updatedAt).toLocaleString()}</p>
                </div>
                {order.estimatedDelivery && (
                  <div>
                    <p className="text-sm text-gray-500">Estimated Delivery</p>
                    <p className="font-medium text-gray-900">{new Date(order.estimatedDelivery).toLocaleString()}</p>
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Assigned To */}
          {(order.customerRep || order.deliveryAgent) && (
            <Card>
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <User className="w-5 h-5 text-gray-600" />
                  <h2 className="text-lg font-semibold">Assigned To</h2>
                </div>
                <div className="space-y-4">
                  {order.customerRep && (
                    <div>
                      <p className="text-sm text-gray-500 mb-1">Customer Rep</p>
                      <p className="font-medium text-gray-900">
                        {order.customerRep.firstName} {order.customerRep.lastName}
                      </p>
                    </div>
                  )}
                  {order.deliveryAgent && (
                    <div>
                      <p className="text-sm text-gray-500 mb-1">Delivery Agent</p>
                      <p className="font-medium text-gray-900">
                        {order.deliveryAgent.firstName} {order.deliveryAgent.lastName}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Call History */}
          {orderCalls.length > 0 && (
            <Card>
              <div className="p-6">
                <h2 className="text-lg font-semibold mb-4">Call History</h2>
                <div className="space-y-3">
                  {orderCalls.map((call) => (
                    <div key={call.id} className="border-b pb-3 last:border-b-0">
                      <div className="flex justify-between items-start mb-1">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${call.outcome === 'confirmed' ? 'bg-green-100 text-green-800' :
                          call.outcome === 'rescheduled' ? 'bg-blue-100 text-blue-800' :
                            call.outcome === 'no_answer' ? 'bg-orange-100 text-orange-800' :
                              call.outcome === 'cancelled' ? 'bg-red-100 text-red-800' :
                                'bg-gray-100 text-gray-800'
                          }`}>
                          {call.outcome.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(call.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">
                        By: {call.salesRep.firstName} {call.salesRep.lastName}
                      </p>
                      {call.notes && (
                        <p className="text-sm text-gray-600 mt-1">{call.notes}</p>
                      )}
                      {call.duration && (
                        <p className="text-xs text-gray-500 mt-1">{call.duration}s</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Log Call Modal */}
      {order && (
        <LogCallModal
          isOpen={isLogCallModalOpen}
          onClose={() => {
            setIsLogCallModalOpen(false);
            loadOrderCalls(id!);
          }}
          customerId={order.customerId}
          customerName={order.customerName}
          orderId={order.id}
        />
      )}
    </div>
  );
};
