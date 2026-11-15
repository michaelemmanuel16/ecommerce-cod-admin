import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../components/ui-v2';
import { RepInboxPage } from '../../pages/rep/RepInboxPage';
import { inboxService } from '../../services/inbox.service';
import { useAuthStore } from '../../stores/authStore';
import { useInboxStore } from '../../stores/inboxStore';
import { getSocket } from '../../services/socket';
import { COUNTS, fakeSocket, item } from '../fixtures/inboxItems';

vi.mock('../../services/inbox.service', async (orig) => ({
  ...(await orig<typeof import('../../services/inbox.service')>()),
  inboxService: {
    list: vi.fn(), counts: vi.fn(), patch: vi.fn(), markAll: vi.fn(), createReminder: vi.fn(), listReminders: vi.fn(),
    cancelReminder: vi.fn(), getThread: vi.fn(), mentionable: vi.fn(), addComment: vi.fn(),
  },
}));
vi.mock('../../services/socket', () => ({ getSocket: vi.fn() }));

const svc = vi.mocked(inboxService);
const renderPage = () => render(<MemoryRouter><ToastProvider><RepInboxPage /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  useInboxStore.getState().stop();
  useAuthStore.setState({ user: { id: 42, email: 'a@b.c', firstName: 'Adwoa', lastName: 'Darko', role: 'sales_rep', createdAt: '', updatedAt: '' } as never });
  svc.counts.mockResolvedValue(COUNTS);
  useInboxStore.setState({ counts: COUNTS });
  svc.listReminders.mockResolvedValue([]);
  svc.list.mockResolvedValue({ items: [
    item(1, { kind: 'reminder', event: 'reminder_due', title: 'Call Abena back', subject: { type: 'order', id: 12 } }),
    item(2, { kind: 'note', event: 'team_note', title: 'Kofi added a note on order #12', subject: { type: 'order', id: 12 }, actorName: 'Kofi Appiah' }),
    item(3, { kind: 'alert', title: 'Stock arrived', subject: { type: 'product', id: 3 } }),
  ], nextCursor: null });
});
afterEach(() => useInboxStore.getState().stop());

describe('Rep inbox screen (M9-T40)', () => {
  it('shows reminders, mentions, notes and alerts for this rep, from the same feed API', async () => {
    renderPage();
    expect(await screen.findByText('Call Abena back')).toBeInTheDocument();
    expect(svc.list).toHaveBeenCalledWith({ view: 'all', status: 'open', scope: 'mine' });
    const rail = screen.getByRole('navigation', { name: 'Inbox views' });
    for (const name of ['All', 'Reminders', 'Mentions', 'Team notes', 'Alerts']) expect(within(rail).getByRole('button', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: /^Replies/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Everyone' })).not.toBeInTheDocument();
  });

  it('links an order to the rep call screen and has no link for a product (the rep app has no such screen)', async () => {
    renderPage();
    const rows = await screen.findAllByTestId('inbox-row');
    expect(within(rows[0]).getByRole('link', { name: 'Order #12' })).toHaveAttribute('href', '/rep/call/12');
    expect(within(rows[2]).queryByRole('link')).not.toBeInTheDocument();
    expect(within(rows[2]).getByText('Product #3')).toBeInTheDocument();
  });

  it('a note opens its thread; Mark done calls the API', async () => {
    svc.getThread.mockResolvedValue({ id: 1, subjectType: 'order', subjectId: 12, archived: false, unreadCount: 0, comments: [] });
    svc.mentionable.mockResolvedValue([]);
    svc.patch.mockResolvedValue({ item: item(1), counts: { ...COUNTS, all: 2 } });
    renderPage();
    const rows = await screen.findAllByTestId('inbox-row');
    await userEvent.click(within(rows[1]).getByRole('button', { name: 'Open thread' }));
    expect(await screen.findByText('No notes yet. Start the thread below.')).toBeInTheDocument();
    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Mark done' }));
    expect(svc.patch).toHaveBeenCalledWith(1, { done: true });
  });

  it('a new-row event raises the list once even when the same row comes again', async () => {
    const socket = fakeSocket();
    vi.mocked(getSocket).mockReturnValue(socket as never);
    useInboxStore.getState().start();
    renderPage();
    await screen.findByText('Call Abena back');
    act(() => { socket.fire('inbox:new', item(8, { title: 'Mentioned once' })); socket.fire('inbox:new', item(8, { title: 'Mentioned once' })); });
    await waitFor(() => expect(screen.getAllByText('Mentioned once')).toHaveLength(1));
  });
});
