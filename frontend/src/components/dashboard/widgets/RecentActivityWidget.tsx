/**
 * Recent Activity Widget
 * Displays the 5-10 most recent notifications/activity feed
 */

import React from 'react';
import {
  Bell,
  Package,
  Truck,
  DollarSign,
  Users,
  CheckCircle,
  XCircle,
  AlertCircle,
  Info,
} from 'lucide-react';
import { WidgetProps } from '../../../config/types/dashboard';
import { formatDistanceToNow } from 'date-fns';

interface RecentActivityWidgetProps extends WidgetProps {
  config: {
    id: string;
    type: 'recentActivity';
    title: string;
    height: number;
    dataSource: string;
  };
}

interface ActivityData {
  id: number;
  type: string;
  title: string;
  message: string;
  userName: string;
  userRole: string;
  isRead: boolean;
  createdAt: string;
  data?: any;
}

export const RecentActivityWidget: React.FC<RecentActivityWidgetProps> = ({
  config,
  data,
  loading = false,
}) => {
  const activities = Array.isArray(data) ? data : [];

  // Get icon based on activity type
  const getActivityIcon = (type: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      order_created: <Package className="w-4 h-4" />,
      order_updated: <Package className="w-4 h-4" />,
      order_delivered: <CheckCircle className="w-4 h-4" />,
      order_cancelled: <XCircle className="w-4 h-4" />,
      payment_received: <DollarSign className="w-4 h-4" />,
      delivery_assigned: <Truck className="w-4 h-4" />,
      customer_added: <Users className="w-4 h-4" />,
      system_alert: <AlertCircle className="w-4 h-4" />,
      info: <Info className="w-4 h-4" />,
    };

    return iconMap[type] || <Bell className="w-4 h-4" />;
  };

  // Get icon background color based on activity type
  const getIconColor = (type: string) => {
    const colorMap: Record<string, string> = {
      order_created: 'bg-blue-100 text-blue-600',
      order_updated: 'bg-purple-100 text-purple-600',
      order_delivered: 'bg-green-100 text-green-600',
      order_cancelled: 'bg-red-100 text-red-600',
      payment_received: 'bg-emerald-100 text-emerald-600',
      delivery_assigned: 'bg-orange-100 text-orange-600',
      customer_added: 'bg-indigo-100 text-indigo-600',
      system_alert: 'bg-yellow-100 text-yellow-600',
      info: 'bg-gray-100 text-gray-600',
    };

    return colorMap[type] || 'bg-gray-100 text-gray-600';
  };

  // Format time ago
  const getTimeAgo = (dateString: string) => {
    try {
      return formatDistanceToNow(new Date(dateString), { addSuffix: true });
    } catch {
      return 'Recently';
    }
  };

  // Format user role for display
  const formatRole = (role: string) => {
    return role
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Handle empty state
  if (!loading && activities.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4">{config.title}</h3>
        <div
          className="flex flex-col items-center justify-center bg-gray-50 rounded-lg"
          style={{ minHeight: config.height }}
        >
          <Bell className="w-16 h-16 text-gray-300 mb-4" />
          <p className="text-gray-500 text-sm">No recent activity</p>
          <p className="text-gray-400 text-xs mt-1">Activity will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{config.title}</h3>
        {!loading && activities.length > 0 && (
          <Bell className="w-5 h-5 text-gray-400" />
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse flex gap-3">
              <div className="w-10 h-10 bg-gray-100 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-100 rounded w-3/4" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4" style={{ maxHeight: config.height, overflowY: 'auto' }}>
          {activities.map((activity: ActivityData, index: number) => (
            <div
              key={activity.id}
              className={`flex gap-3 ${
                index !== activities.length - 1 ? 'pb-4 border-b border-gray-100' : ''
              }`}
            >
              {/* Activity Icon */}
              <div
                className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${getIconColor(
                  activity.type
                )}`}
              >
                {getActivityIcon(activity.type)}
              </div>

              {/* Activity Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 mb-1">
                  {activity.title}
                </p>
                <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                  {activity.message}
                </p>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="font-medium">{activity.userName}</span>
                  <span className="w-1 h-1 bg-gray-300 rounded-full" />
                  <span>{formatRole(activity.userRole)}</span>
                  <span className="w-1 h-1 bg-gray-300 rounded-full" />
                  <span>{getTimeAgo(activity.createdAt)}</span>
                </div>
              </div>

              {/* Unread Indicator */}
              {!activity.isRead && (
                <div className="flex-shrink-0">
                  <div className="w-2 h-2 bg-blue-600 rounded-full" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && activities.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <button
            onClick={() => {
              window.location.href = '/notifications';
            }}
            className="w-full text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center justify-center gap-1 py-2 hover:bg-blue-50 rounded-md transition-colors"
          >
            View all activity
          </button>
        </div>
      )}
    </div>
  );
};
