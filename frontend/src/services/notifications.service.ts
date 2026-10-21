import apiClient from './api';
import type { Notification } from '../types';

/** A row of GET /api/notifications. The table calls the flag `isRead`; the bell's type calls it `read`. */
interface NotificationRow {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  data?: unknown;
}

export const notificationsService = {
  /** The signed-in user's unread rows, counted by the database (F-106). */
  async getUnreadCount(): Promise<number> {
    const response = await apiClient.get('/api/notifications/unread-count');
    return Number(response.data?.unreadCount) || 0;
  },

  async getNotifications(limit = 10): Promise<{ notifications: Notification[]; unreadCount: number }> {
    const response = await apiClient.get('/api/notifications', { params: { limit } });
    const rows: NotificationRow[] = response.data?.notifications ?? [];
    return {
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type as Notification['type'],
        title: n.title,
        message: n.message,
        read: n.isRead,
        createdAt: n.createdAt,
        data: n.data,
      })),
      unreadCount: Number(response.data?.unreadCount) || 0,
    };
  },

  async markAsRead(id: number): Promise<void> {
    await apiClient.patch(`/api/notifications/${id}/read`);
  },

  async markAllAsRead(): Promise<void> {
    await apiClient.patch('/api/notifications/read-all');
  },
};
