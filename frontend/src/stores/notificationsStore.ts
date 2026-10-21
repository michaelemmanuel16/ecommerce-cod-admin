import { create } from 'zustand';
import { Notification } from '../types';
import { notificationsService } from '../services/notifications.service';
import { getSocket } from '../services/socket';

interface NotificationsState {
  /** The latest rows for the bell popover, read from the database. */
  notifications: Notification[];
  /** Unread rows of the signed-in user, counted by the database. Never counted in memory (F-106). */
  unreadCount: number;
  fetchUnreadCount: () => Promise<void>;
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  clearNotifications: () => void;
  setupSocketListeners: () => void;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: [],
  unreadCount: 0,

  // A failed read keeps the last count on screen: the bell never shows a wrong zero because the network blinked.
  fetchUnreadCount: async () => {
    try {
      set({ unreadCount: await notificationsService.getUnreadCount() });
    } catch {
      /* keep the last count */
    }
  },

  fetchNotifications: async () => {
    try {
      const { notifications, unreadCount } = await notificationsService.getNotifications();
      set({ notifications, unreadCount });
    } catch {
      /* keep what is on screen */
    }
  },

  markAsRead: async (id: number) => {
    const row = get().notifications.find((n) => n.id === id);
    if (row && !row.read) {
      set((s) => ({
        notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        unreadCount: Math.max(0, s.unreadCount - 1),
      }));
    }
    try {
      await notificationsService.markAsRead(id);
    } catch {
      await get().fetchNotifications(); // the server is the truth
    }
  },

  markAllAsRead: async () => {
    set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })), unreadCount: 0 }));
    try {
      await notificationsService.markAllAsRead();
    } catch {
      await get().fetchNotifications();
    }
  },

  clearNotifications: () => {
    set({ notifications: [], unreadCount: 0 });
  },

  // The server emits `notification` to the user's own room (tenant-scoped) after it writes the row.
  // The event is a signal: the count is re-read from the database, never incremented here.
  setupSocketListeners: () => {
    const socket = getSocket();
    if (!socket) return;

    socket.off('notification');
    socket.on('notification', () => {
      void get().fetchUnreadCount();
    });
    void get().fetchUnreadCount();
  },
}));
