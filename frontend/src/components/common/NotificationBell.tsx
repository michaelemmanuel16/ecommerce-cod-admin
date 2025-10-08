import React from 'react';
import { Bell } from 'lucide-react';
import { useNotificationsStore } from '../../stores/notificationsStore';
import { Dropdown, DropdownItem } from '../ui/Dropdown';

export const NotificationBell: React.FC = () => {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotificationsStore();

  return (
    <Dropdown
      trigger={
        <button className="relative p-2 text-gray-600 hover:text-gray-900">
          <Bell className="w-6 h-6" />
          {unreadCount > 0 && (
            <span className="absolute top-0 right-0 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </button>
      }
      align="right"
    >
      <div className="max-h-96 overflow-y-auto w-80">
        <div className="px-4 py-2 border-b flex items-center justify-between">
          <span className="font-semibold">Notifications</span>
          <button
            onClick={markAllAsRead}
            className="text-xs text-blue-600 hover:underline"
          >
            Mark all as read
          </button>
        </div>
        {notifications.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-500">
            No notifications
          </div>
        ) : (
          notifications.slice(0, 10).map((notification) => (
            <DropdownItem
              key={notification.id}
              onClick={() => markAsRead(notification.id)}
              className={notification.read ? 'opacity-60' : ''}
            >
              <div>
                <p className="font-medium">{notification.title}</p>
                <p className="text-xs text-gray-600">{notification.message}</p>
              </div>
            </DropdownItem>
          ))
        )}
      </div>
    </Dropdown>
  );
};
