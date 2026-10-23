import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNotificationsStore } from '../../stores/notificationsStore';
import { notificationsService } from '../../services/notifications.service';
import { getSocket } from '../../services/socket';
import { Notification } from '../../types';

vi.mock('../../services/notifications.service', () => ({
  notificationsService: {
    getUnreadCount: vi.fn(),
    getNotifications: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  },
}));
vi.mock('../../services/socket', () => ({ getSocket: vi.fn() }));

const row = (id: number, read = false): Notification => ({
  id, type: 'system', title: `Title ${id}`, message: 'm', read, createdAt: '2026-10-21T10:00:00.000Z',
});

describe('Notifications store (M3-T36)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotificationsStore.setState({ notifications: [], unreadCount: 0 });
  });

  it('reads the unread count from the API, not from memory (survives a reload)', async () => {
    vi.mocked(notificationsService.getUnreadCount).mockResolvedValue(4);
    // a reload gives a fresh store: count 0 in memory
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
    await useNotificationsStore.getState().fetchUnreadCount();
    expect(useNotificationsStore.getState().unreadCount).toBe(4);
  });

  it('keeps the last count when the read fails', async () => {
    useNotificationsStore.setState({ unreadCount: 3 });
    vi.mocked(notificationsService.getUnreadCount).mockRejectedValue(new Error('offline'));
    await useNotificationsStore.getState().fetchUnreadCount();
    expect(useNotificationsStore.getState().unreadCount).toBe(3);
  });

  it('fetchNotifications sets the rows and the count from the database', async () => {
    vi.mocked(notificationsService.getNotifications).mockResolvedValue({ notifications: [row(2), row(1, true)], unreadCount: 1 });
    await useNotificationsStore.getState().fetchNotifications();
    const s = useNotificationsStore.getState();
    expect(s.notifications.map((n) => n.id)).toEqual([2, 1]);
    expect(s.unreadCount).toBe(1);
  });

  it('a socket "notification" event re-reads the count (it is not incremented in memory)', async () => {
    const handlers: Record<string, () => void> = {};
    vi.mocked(getSocket).mockReturnValue({
      off: vi.fn(),
      on: vi.fn((e: string, h: () => void) => { handlers[e] = h; }),
    } as never);
    vi.mocked(notificationsService.getUnreadCount).mockResolvedValue(2);
    useNotificationsStore.getState().setupSocketListeners();
    await vi.waitFor(() => expect(useNotificationsStore.getState().unreadCount).toBe(2));

    vi.mocked(notificationsService.getUnreadCount).mockResolvedValue(3);
    handlers.notification();
    await vi.waitFor(() => expect(useNotificationsStore.getState().unreadCount).toBe(3));
  });

  it('markAsRead lowers the count at once and tells the server', async () => {
    useNotificationsStore.setState({ notifications: [row(1), row(2)], unreadCount: 2 });
    vi.mocked(notificationsService.markAsRead).mockResolvedValue();
    await useNotificationsStore.getState().markAsRead(1);
    const s = useNotificationsStore.getState();
    expect(s.notifications.find((n) => n.id === 1)?.read).toBe(true);
    expect(s.unreadCount).toBe(1);
    expect(notificationsService.markAsRead).toHaveBeenCalledWith(1);
  });

  it('markAsRead on an already read row does not lower the count', async () => {
    useNotificationsStore.setState({ notifications: [row(1, true)], unreadCount: 1 });
    vi.mocked(notificationsService.markAsRead).mockResolvedValue();
    await useNotificationsStore.getState().markAsRead(1);
    expect(useNotificationsStore.getState().unreadCount).toBe(1);
  });

  it('a failed markAsRead re-reads the truth from the server', async () => {
    useNotificationsStore.setState({ notifications: [row(1)], unreadCount: 1 });
    vi.mocked(notificationsService.markAsRead).mockRejectedValue(new Error('x'));
    vi.mocked(notificationsService.getNotifications).mockResolvedValue({ notifications: [row(1)], unreadCount: 1 });
    await useNotificationsStore.getState().markAsRead(1);
    expect(useNotificationsStore.getState().unreadCount).toBe(1);
    expect(notificationsService.getNotifications).toHaveBeenCalled();
  });

  it('markAllAsRead zeroes the count and calls the server', async () => {
    useNotificationsStore.setState({ notifications: [row(1), row(2)], unreadCount: 2 });
    vi.mocked(notificationsService.markAllAsRead).mockResolvedValue();
    await useNotificationsStore.getState().markAllAsRead();
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
    expect(useNotificationsStore.getState().notifications.every((n) => n.read)).toBe(true);
    expect(notificationsService.markAllAsRead).toHaveBeenCalled();
  });

  it('clearNotifications empties the store (sign out)', () => {
    useNotificationsStore.setState({ notifications: [row(1)], unreadCount: 1 });
    useNotificationsStore.getState().clearNotifications();
    expect(useNotificationsStore.getState()).toMatchObject({ notifications: [], unreadCount: 0 });
  });
});
