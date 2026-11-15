import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { act } from 'react';
import { NotificationMenu } from '../../../components/shell/NotificationMenu';
import { useInboxStore } from '../../../stores/inboxStore';
import { inboxService } from '../../../services/inbox.service';
import { getSocket } from '../../../services/socket';
import { COUNTS, fakeSocket, item } from '../../fixtures/inboxItems';

vi.mock('../../../services/inbox.service', async (orig) => ({
  ...(await orig<typeof import('../../../services/inbox.service')>()),
  inboxService: { counts: vi.fn(), list: vi.fn(), patch: vi.fn(), markAll: vi.fn() },
}));
vi.mock('../../../services/socket', () => ({ getSocket: vi.fn() }));

const renderBell = () => render(<MemoryRouter><NotificationMenu /></MemoryRouter>);

describe('Notification bell (M3-T36, M9-T38)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useInboxStore.getState().stop();
    vi.mocked(inboxService.counts).mockResolvedValue({ ...COUNTS, all: 5 });
    vi.mocked(inboxService.list).mockResolvedValue({ items: [], nextCursor: null });
  });

  it('the count survives a reload: a fresh store shows the count the API holds', async () => {
    vi.mocked(getSocket).mockReturnValue(fakeSocket() as never);
    useInboxStore.getState().start();
    const first = renderBell();
    expect(await screen.findByRole('button', { name: 'Notifications, 5 unread' })).toBeInTheDocument();
    first.unmount();

    useInboxStore.getState().stop(); // reload: memory is gone
    useInboxStore.getState().start();
    renderBell();
    expect(await screen.findByRole('button', { name: 'Notifications, 5 unread' })).toBeInTheDocument();
    expect(inboxService.counts).toHaveBeenCalledTimes(2);
  });

  it('a socket event raises the count', async () => {
    const socket = fakeSocket();
    vi.mocked(getSocket).mockReturnValue(socket as never);
    useInboxStore.getState().start();
    renderBell();
    expect(await screen.findByRole('button', { name: 'Notifications, 5 unread' })).toBeInTheDocument();
    act(() => socket.fire('inbox:counts', { ...COUNTS, all: 6 }));
    expect(await screen.findByRole('button', { name: 'Notifications, 6 unread' })).toBeInTheDocument();
  });

  it('shows no dot at zero, and the popover lists the rows from the database', async () => {
    vi.mocked(inboxService.counts).mockResolvedValue({ ...COUNTS, all: 0 });
    vi.mocked(inboxService.list).mockResolvedValue({ items: [item(1, { title: 'Order assigned', message: 'ORD-9' })], nextCursor: null });
    vi.mocked(getSocket).mockReturnValue(fakeSocket() as never);
    useInboxStore.getState().start();
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Order assigned')).toBeInTheDocument();
    expect(inboxService.list).toHaveBeenCalledWith({ view: 'all', status: 'open', limit: 10 });
    expect(screen.getByRole('menuitem', { name: 'Open Inbox' })).toHaveAttribute('href', '/inbox');
  });

  it('mark as read and mark all as read go to the API', async () => {
    vi.mocked(inboxService.list).mockResolvedValue({ items: [item(1, { title: 'One' })], nextCursor: null });
    vi.mocked(inboxService.patch).mockResolvedValue({ item: item(1, { title: 'One', isRead: true }), counts: { ...COUNTS, all: 4 } });
    vi.mocked(inboxService.markAll).mockResolvedValue({ updated: 4, counts: { ...COUNTS, all: 0 } });
    vi.mocked(getSocket).mockReturnValue(fakeSocket() as never);
    useInboxStore.getState().start();
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await userEvent.click(await screen.findByText('One'));
    expect(inboxService.patch).toHaveBeenCalledWith(1, { read: true });
    expect(await screen.findByRole('button', { name: 'Notifications, 4 unread' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    expect(inboxService.markAll).toHaveBeenCalledWith('all');
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });
});
