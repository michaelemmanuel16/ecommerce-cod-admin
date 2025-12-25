import { describe, it, expect, beforeEach } from 'vitest';
import { useNotificationsStore } from '../../stores/notificationsStore';
import { Notification } from '../../types';

describe('Notifications Store', () => {
  beforeEach(() => {
    // Reset store before each test
    useNotificationsStore.setState({
      notifications: [],
      unreadCount: 0,
    });
  });

  describe('addNotification', () => {
    it('should add notification and increment unread count', () => {
      const notification: Notification = {
        id: 1,
        title: 'Test Notification',
        message: 'This is a test',
        type: 'info',
        read: false,
        createdAt: new Date(),
      };

      useNotificationsStore.getState().addNotification(notification);

      const state = useNotificationsStore.getState();
      expect(state.notifications).toHaveLength(1);
      expect(state.notifications[0]).toEqual(notification);
      expect(state.unreadCount).toBe(1);
    });

    it('should add multiple notifications in correct order (newest first)', () => {
      const notification1: Notification = {
        id: 1,
        title: 'First',
        message: 'First message',
        type: 'info',
        read: false,
        createdAt: new Date(),
      };

      const notification2: Notification = {
        id: 2,
        title: 'Second',
        message: 'Second message',
        type: 'success',
        read: false,
        createdAt: new Date(),
      };

      useNotificationsStore.getState().addNotification(notification1);
      useNotificationsStore.getState().addNotification(notification2);

      const state = useNotificationsStore.getState();
      expect(state.notifications).toHaveLength(2);
      expect(state.notifications[0].id).toBe(2); // Newest first
      expect(state.notifications[1].id).toBe(1);
      expect(state.unreadCount).toBe(2);
    });
  });

  describe('markAsRead', () => {
    beforeEach(() => {
      const notifications: Notification[] = [
        {
          id: 1,
          title: 'Notification 1',
          message: 'Message 1',
          type: 'info',
          read: false,
          createdAt: new Date(),
        },
        {
          id: 2,
          title: 'Notification 2',
          message: 'Message 2',
          type: 'warning',
          read: false,
          createdAt: new Date(),
        },
        {
          id: 3,
          title: 'Notification 3',
          message: 'Message 3',
          type: 'error',
          read: false,
          createdAt: new Date(),
        },
      ];

      useNotificationsStore.setState({
        notifications,
        unreadCount: 3,
      });
    });

    it('should mark notification as read and decrement unread count', () => {
      useNotificationsStore.getState().markAsRead(2);

      const state = useNotificationsStore.getState();
      expect(state.notifications[1].read).toBe(true);
      expect(state.unreadCount).toBe(2);
    });

    it('should not decrement unread count below 0', () => {
      useNotificationsStore.setState({ unreadCount: 0 });
      useNotificationsStore.getState().markAsRead(1);

      const state = useNotificationsStore.getState();
      expect(state.unreadCount).toBe(0);
    });

    it('should not affect other notifications', () => {
      useNotificationsStore.getState().markAsRead(2);

      const state = useNotificationsStore.getState();
      expect(state.notifications[0].read).toBe(false);
      expect(state.notifications[1].read).toBe(true);
      expect(state.notifications[2].read).toBe(false);
    });
  });

  describe('markAllAsRead', () => {
    beforeEach(() => {
      const notifications: Notification[] = [
        {
          id: 1,
          title: 'Notification 1',
          message: 'Message 1',
          type: 'info',
          read: false,
          createdAt: new Date(),
        },
        {
          id: 2,
          title: 'Notification 2',
          message: 'Message 2',
          type: 'success',
          read: false,
          createdAt: new Date(),
        },
        {
          id: 3,
          title: 'Notification 3',
          message: 'Message 3',
          type: 'warning',
          read: true, // Already read
          createdAt: new Date(),
        },
      ];

      useNotificationsStore.setState({
        notifications,
        unreadCount: 2,
      });
    });

    it('should mark all notifications as read', () => {
      useNotificationsStore.getState().markAllAsRead();

      const state = useNotificationsStore.getState();
      expect(state.notifications.every(n => n.read)).toBe(true);
    });

    it('should set unread count to 0', () => {
      useNotificationsStore.getState().markAllAsRead();

      const state = useNotificationsStore.getState();
      expect(state.unreadCount).toBe(0);
    });

    it('should work with empty notifications', () => {
      useNotificationsStore.setState({ notifications: [], unreadCount: 0 });
      useNotificationsStore.getState().markAllAsRead();

      const state = useNotificationsStore.getState();
      expect(state.notifications).toHaveLength(0);
      expect(state.unreadCount).toBe(0);
    });
  });

  describe('clearNotifications', () => {
    beforeEach(() => {
      const notifications: Notification[] = [
        {
          id: 1,
          title: 'Notification 1',
          message: 'Message 1',
          type: 'info',
          read: false,
          createdAt: new Date(),
        },
        {
          id: 2,
          title: 'Notification 2',
          message: 'Message 2',
          type: 'success',
          read: true,
          createdAt: new Date(),
        },
      ];

      useNotificationsStore.setState({
        notifications,
        unreadCount: 1,
      });
    });

    it('should clear all notifications', () => {
      useNotificationsStore.getState().clearNotifications();

      const state = useNotificationsStore.getState();
      expect(state.notifications).toHaveLength(0);
    });

    it('should reset unread count to 0', () => {
      useNotificationsStore.getState().clearNotifications();

      const state = useNotificationsStore.getState();
      expect(state.unreadCount).toBe(0);
    });

    it('should work when already empty', () => {
      useNotificationsStore.setState({ notifications: [], unreadCount: 0 });
      useNotificationsStore.getState().clearNotifications();

      const state = useNotificationsStore.getState();
      expect(state.notifications).toHaveLength(0);
      expect(state.unreadCount).toBe(0);
    });
  });
});
