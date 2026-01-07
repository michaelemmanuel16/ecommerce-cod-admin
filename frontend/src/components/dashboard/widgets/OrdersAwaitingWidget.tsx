/**
 * Orders Awaiting Action Widget
 * Displays the 5 most recent orders with status pending_confirmation
 */

import React from 'react';
import { Clock, Phone, MapPin, DollarSign, ChevronRight } from 'lucide-react';
import { formatCurrency } from '../../../utils/format';
import { WidgetProps } from '../../../config/types/dashboard';
import { formatDistanceToNow } from 'date-fns';

interface OrdersAwaitingWidgetProps extends WidgetProps {
  config: {
    id: string;
    type: 'ordersAwaiting';
    title: string;
    height: number;
    dataSource: string;
  };
}

interface OrderData {
  id: number;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerArea: string;
  totalAmount: number;
  createdAt: string;
  repName: string;
}

export const OrdersAwaitingWidget: React.FC<OrdersAwaitingWidgetProps> = ({
  config,
  data,
  loading = false,
}) => {
  const orders = Array.isArray(data) ? data : [];

  // Format time ago
  const getTimeAgo = (dateString: string) => {
    try {
      return formatDistanceToNow(new Date(dateString), { addSuffix: true });
    } catch {
      return 'Recently';
    }
  };

  // Handle empty state
  if (!loading && orders.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4">{config.title}</h3>
        <div
          className="flex flex-col items-center justify-center bg-gray-50 rounded-lg"
          style={{ minHeight: config.height }}
        >
          <svg
            className="w-16 h-16 text-gray-300 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-gray-500 text-sm">No orders awaiting confirmation</p>
          <p className="text-gray-400 text-xs mt-1">All caught up!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{config.title}</h3>
        {!loading && orders.length > 0 && (
          <span className="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded-full font-medium">
            {orders.length} pending
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-24 bg-gray-100 rounded-lg" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3" style={{ maxHeight: config.height, overflowY: 'auto' }}>
          {orders.map((order: OrderData) => (
            <div
              key={order.id}
              className="p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer group"
              onClick={() => {
                // Navigate to order detail page
                window.location.href = `/orders/${order.id}`;
              }}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-900">{order.orderNumber}</span>
                    <span className="w-1.5 h-1.5 bg-gray-300 rounded-full" />
                    <span className="text-sm text-gray-600">{order.customerName}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {order.customerPhone}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {order.customerArea}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
              </div>

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 text-green-600 font-semibold">
                    {formatCurrency(order.totalAmount)}
                  </span>
                  <span className="flex items-center gap-1 text-gray-500">
                    <Clock className="w-3 h-3" />
                    {getTimeAgo(order.createdAt)}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  Rep: {order.repName}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && orders.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <button
            onClick={() => {
              window.location.href = '/orders?status=pending_confirmation';
            }}
            className="w-full text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center justify-center gap-1 py-2 hover:bg-blue-50 rounded-md transition-colors"
          >
            View all pending orders
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
