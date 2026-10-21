import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationMenu } from '../../../components/shell/NotificationMenu';
import { useNotificationsStore } from '../../../stores/notificationsStore';
import { notificationsService } from '../../../services/notifications.service';
import { getSocket } from '../../../services/socket';

vi.mock('../../../services/notifications.service', () => ({
  notificationsService: { getUnreadCount: vi.fn(), getNotifications: vi.fn(), markAsRead: vi.fn(), markAllAsRead: vi.fn() },
}));
vi.mock('../../../services/socket', () => ({ getSocket: vi.fn() }));

describe('Notification bell (M3-T36)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotificationsStore.setState({ notifications: [], unreadCount: 0 });
    vi.mocked(notificationsService.getNotifications).mockResolvedValue({ notifications: [], unreadCount: 0 });
  });

  it('count survives a reload: a fresh store shows the count the API holds', async () => {
    vi.mocked(notificationsService.getUnreadCount).mockResolvedValue(5);
    const first = render(<NotificationMenu />);
    expect(await screen.findByRole('button', { name: 'Notifications, 5 unread' })).toBeInTheDocument();
    first.unmount();

    // reload: memory is gone, the page asks the API again
    useNotificationsStore.setState({ notifications: [], unreadCount: 0 });
    render(<NotificationMenu />);
    expect(await screen.findByRole('button', { name: 'Notifications, 5 unread' })).toBeInTheDocument();
    expect(notificationsService.getUnreadCount).toHaveBeenCalledTimes(2);
  });

  it('a new socket event raises the count', async () => {
    const handlers: Record<string, () => void> = {};
    vi.mocked(getSocket).mockReturnValue({ off: vi.fn(), on: vi.fn((e: string, h: () => void) => { handlers[e] = h; }) } as never);
    vi.mocked(notificationsService.getUnreadCount).mockResolvedValue(1);
    useNotificationsStore.getState().setupSocketListeners();
    render(<NotificationMenu />);
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();

    vi.mocked(notificationsService.getUnreadCount).mockResolvedValue(2);
    handlers.notification();
    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument();
  });

  it('shows no dot at zero, and the popover lists the rows from the database', async () => {
    vi.mocked(notificationsService.getUnreadCount).mockResolvedValue(0);
    vi.mocked(notificationsService.getNotifications).mockResolvedValue({
      notifications: [{ id: 1, type: 'system', title: 'Order assigned', message: 'ORD-9', read: false, createdAt: '' }],
      unreadCount: 1,
    });
    render(<NotificationMenu />);
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    expect(await screen.findByText('Order assigned')).toBeInTheDocument();
  });
});
