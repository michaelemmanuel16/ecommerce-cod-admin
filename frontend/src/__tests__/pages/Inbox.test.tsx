import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import { ToastProvider } from '../../components/ui-v2';
import { Inbox } from '../../pages/Inbox';
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
const setRole = (role: string) => useAuthStore.setState({ user: { id: 1, email: 'a@b.c', firstName: 'A', lastName: 'B', role, createdAt: '', updatedAt: '' } as never });
const renderPage = () => render(<MemoryRouter><ToastProvider><Inbox /></ToastProvider></MemoryRouter>);

const ORDER_ROW = item(1, { title: 'Order 12 was assigned to you', actorName: 'Kofi Appiah', subject: { type: 'order', id: 12 } });
const MENTION_ROW = item(2, { kind: 'mention', event: 'mention', title: 'Ama mentioned you on order #12', message: 'please check', isRead: true, actorName: 'Ama Boateng', subject: { type: 'order', id: 12 } });

beforeEach(() => {
  vi.clearAllMocks();
  useInboxStore.getState().stop();
  vi.mocked(getSocket).mockReturnValue(null);
  setRole('sales_rep');
  svc.counts.mockResolvedValue(COUNTS);
  useInboxStore.setState({ counts: COUNTS });
  svc.list.mockResolvedValue({ items: [ORDER_ROW, MENTION_ROW], nextCursor: null });
  svc.listReminders.mockResolvedValue([]);
  svc.patch.mockResolvedValue({ item: ORDER_ROW, counts: { ...COUNTS, all: 2 } });
});
afterEach(() => useInboxStore.getState().stop());

describe('Inbox page: the feed', () => {
  it('lists the rows with type, title, who, link and the unread mark', async () => {
    renderPage();
    expect(await screen.findByText('Order 12 was assigned to you')).toBeInTheDocument();
    expect(svc.list).toHaveBeenCalledWith({ view: 'all', status: 'open', scope: 'mine' });
    const rows = screen.getAllByTestId('inbox-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Kofi Appiah')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Alert')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Unread')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('link', { name: 'Order #12' })).toHaveAttribute('href', '/orders/12');
    expect(within(rows[1]).queryByText('Unread')).not.toBeInTheDocument();
  });

  it('offers only the views the API serves, with their counts', async () => {
    renderPage();
    const rail = await screen.findByRole('navigation', { name: 'Inbox views' });
    for (const name of ['All', 'Assigned to me', 'Mentions', 'Replies', 'Reminders', 'Team notes', 'Alerts', 'Snoozed', 'Done']) {
      expect(within(rail).getByRole('button', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    expect(within(rail).getByRole('button', { name: /^Mentions/ })).toHaveTextContent('1');
    await userEvent.click(within(rail).getByRole('button', { name: /^Team notes/ }));
    await waitFor(() => expect(svc.list).toHaveBeenLastCalledWith({ view: 'notes', status: 'open', scope: 'mine' }));
  });

  it('shows an empty state for each section', async () => {
    svc.list.mockResolvedValue({ items: [], nextCursor: null });
    renderPage();
    expect(await screen.findByText('Nothing needs you right now.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Mentions/ }));
    expect(await screen.findByText('Nobody has mentioned you.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Done/ }));
    expect(await screen.findByText('Nothing is marked done yet.')).toBeInTheDocument();
    expect(svc.list).toHaveBeenLastCalledWith({ view: 'all', status: 'done', scope: 'mine' });
  });

  it('a failed read says so and offers Try again', async () => {
    svc.list.mockRejectedValueOnce(new Error('down'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Order 12 was assigned to you')).toBeInTheDocument();
  });

  it('a greyed link for an item that is gone', async () => {
    svc.list.mockResolvedValue({ items: [item(3, { subject: { type: 'order', id: 99 }, subjectDeleted: true, subjectAccessible: false })], nextCursor: null });
    renderPage();
    expect(await screen.findByText('Order #99, deleted')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Order #99/ })).not.toBeInTheDocument();
  });

  it('a row that arrives by socket twice is listed once', async () => {
    const socket = fakeSocket();
    vi.mocked(getSocket).mockReturnValue(socket as never);
    useInboxStore.getState().start();
    renderPage();
    await screen.findByText('Order 12 was assigned to you');
    act(() => { socket.fire('inbox:new', item(9, { title: 'Fresh one' })); socket.fire('inbox:new', item(9, { title: 'Fresh one' })); });
    expect(await screen.findAllByText('Fresh one')).toHaveLength(1);
  });
});

describe('Inbox page: row actions', () => {
  it('Mark done calls the API and the row leaves the list', async () => {
    renderPage();
    const row = (await screen.findAllByTestId('inbox-row'))[0];
    await userEvent.click(within(row).getByRole('button', { name: 'Mark done' }));
    expect(svc.patch).toHaveBeenCalledWith(1, { done: true });
    await waitFor(() => expect(screen.queryByText('Order 12 was assigned to you')).not.toBeInTheDocument());
    expect(useInboxStore.getState().counts?.all).toBe(2); // the server's count
  });

  it('a snoozed row has Mark done (and Stop snooze), and Mark done sends done', async () => {
    const snoozed = { ...ORDER_ROW, snoozedUntil: new Date(Date.now() + 3600_000).toISOString() };
    svc.list.mockImplementation(async (q) => ({ items: q.status === 'snoozed' ? [snoozed] : [ORDER_ROW, MENTION_ROW], nextCursor: null }));
    renderPage();
    await screen.findByText('Order 12 was assigned to you');
    await userEvent.click(screen.getByRole('button', { name: /^Snoozed/ }));
    await waitFor(() => expect(svc.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'snoozed' })));
    const row = await screen.findByTestId('inbox-row');
    expect(within(row).getByRole('button', { name: 'Stop snooze' })).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Mark done' }));
    expect(svc.patch).toHaveBeenCalledWith(1, { done: true });
  });

  it('Snooze offers future times and sends the chosen one', async () => {
    renderPage();
    const row = (await screen.findAllByTestId('inbox-row'))[0];
    await userEvent.click(within(row).getByRole('button', { name: 'Snooze' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Tomorrow, 09:00' }));
    const [, body] = svc.patch.mock.calls[0];
    expect(new Date(body.snoozedUntil as string).getTime()).toBeGreaterThan(Date.now());
  });

  it('shows the API error when a write is refused', async () => {
    svc.patch.mockRejectedValue(new AxiosError('Request failed', '400', undefined, undefined, { status: 400, data: { error: 'Notification not found' } } as never));
    renderPage();
    const row = (await screen.findAllByTestId('inbox-row'))[0];
    await userEvent.click(within(row).getByRole('button', { name: 'Mark done' }));
    expect(await screen.findByText('Notification not found')).toBeInTheDocument();
    expect(screen.getByText('Order 12 was assigned to you')).toBeInTheDocument();
  });

  it('Mark all read calls the API for the view', async () => {
    svc.markAll.mockResolvedValue({ updated: 3, counts: { ...COUNTS, all: 0 } });
    renderPage();
    await screen.findByText('Order 12 was assigned to you');
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(svc.markAll).toHaveBeenCalledWith('all');
  });
});

describe('Inbox page: set reminder', () => {
  const openDialog = async () => {
    renderPage();
    const row = (await screen.findAllByTestId('inbox-row'))[0];
    await userEvent.click(within(row).getByRole('button', { name: 'Set reminder' }));
    return screen.findByRole('dialog', { name: 'New reminder' });
  };

  it('creates a reminder linked to the row, with the due time as an ISO date', async () => {
    svc.createReminder.mockResolvedValue({} as never);
    const dlg = await openDialog();
    expect(within(dlg).getByText('Order #12')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create reminder' }));
    await waitFor(() => expect(svc.createReminder).toHaveBeenCalledTimes(1));
    const arg = svc.createReminder.mock.calls[0][0];
    expect(arg).toMatchObject({ note: 'Order 12 was assigned to you', subjectType: 'order', subjectId: 12 });
    expect(new Date(arg.dueAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a past date: the picker starts at today, a past time shows a message and Create stays off', async () => {
    const dlg = await openDialog();
    const date = within(dlg).getByLabelText('Due date') as HTMLInputElement;
    expect(date.min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.change(date, { target: { value: '2020-01-01' } });
    expect(await within(dlg).findByText('Pick a time that has not passed yet')).toBeInTheDocument();
    const create = within(dlg).getByRole('button', { name: 'Create reminder' });
    expect(create).toBeDisabled();
    await userEvent.click(create);
    expect(svc.createReminder).not.toHaveBeenCalled();
  });

  it('New reminder in the header makes one with no link', async () => {
    svc.createReminder.mockResolvedValue({} as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'New reminder' }));
    const dlg = await screen.findByRole('dialog', { name: 'New reminder' });
    await userEvent.type(within(dlg).getByLabelText('What'), 'Call the agent');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create reminder' }));
    await waitFor(() => expect(svc.createReminder).toHaveBeenCalledWith(expect.objectContaining({ note: 'Call the agent' })));
    expect(svc.createReminder.mock.calls[0][0]).not.toHaveProperty('subjectType');
  });

  it('the Reminders view lists upcoming reminders and cancels one', async () => {
    svc.listReminders.mockResolvedValue([{ id: 7, createdById: 1, assignedToId: 1, subjectType: null, subjectId: null, note: 'Chase Logiswift', dueAt: '2030-01-01T09:00:00.000Z', status: 'pending' }]);
    svc.cancelReminder.mockResolvedValue();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Reminders/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel reminder: Chase Logiswift' }));
    expect(svc.cancelReminder).toHaveBeenCalledWith(7);
    await waitFor(() => expect(screen.queryByText('Chase Logiswift')).not.toBeInTheDocument());
  });
});

describe('Inbox page: team note thread', () => {
  const thread = { id: 4, subjectType: 'order', subjectId: 12, archived: false, unreadCount: 0, comments: [
    { id: 1, parentId: null, authorId: 5, authorName: 'Ama Boateng', body: '<b>please check</b>', mentionIds: [], edited: false, deleted: false, createdAt: '2026-11-14T10:00:00.000Z',
      replies: [{ id: 2, parentId: 1, authorId: 6, authorName: 'Kofi Appiah', body: 'on it', mentionIds: [], edited: false, deleted: false, createdAt: '2026-11-14T11:00:00.000Z' }] },
  ] };

  it('opens the thread with replies (as plain text), lists only the people the API allows, and sends the mention', async () => {
    svc.getThread.mockResolvedValue(thread);
    svc.mentionable.mockResolvedValue([{ id: 6, name: 'Kofi Appiah', role: 'sales_rep' }, { id: 8, name: 'Esi Badu', role: 'manager' }]);
    svc.addComment.mockResolvedValue({} as never);
    renderPage();
    const row = (await screen.findAllByTestId('inbox-row'))[1];
    await userEvent.click(within(row).getByRole('button', { name: 'Open thread' }));
    const drawer = await screen.findByRole('dialog', { name: 'Order #12 thread' });
    expect(svc.getThread).toHaveBeenCalledWith('order', 12);
    expect(await within(drawer).findByText('<b>please check</b>')).toBeInTheDocument(); // text, not HTML
    expect(within(drawer).getByText('on it')).toBeInTheDocument();

    const box = within(drawer).getByLabelText('Team note');
    await userEvent.type(box, 'Thanks @');
    const picker = await within(drawer).findByRole('listbox', { name: 'People you can mention' });
    expect(within(picker).getAllByRole('option').map((o) => o.textContent?.replace(/\s+/g, ' '))).toEqual(['Kofi Appiahsales rep', 'Esi Badumanager']);
    await userEvent.click(within(picker).getByRole('option', { name: /Esi Badu/ }));
    expect(box).toHaveValue('Thanks @Esi Badu ');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(svc.addComment).toHaveBeenCalledWith('order', 12, { body: 'Thanks @Esi Badu ', mentionIds: [8] }));
  });

  it('a closed thread has no note box', async () => {
    svc.getThread.mockResolvedValue({ ...thread, archived: true });
    svc.mentionable.mockResolvedValue([]);
    renderPage();
    const row = (await screen.findAllByTestId('inbox-row'))[1];
    await userEvent.click(within(row).getByRole('button', { name: 'Open thread' }));
    expect(await screen.findByText('This thread is closed because the item was deleted.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Team note')).not.toBeInTheDocument();
  });
});

describe('Inbox page: whose rows', () => {
  it('a rep has no Everyone switch; the owner can read everyone but has no write controls there', async () => {
    renderPage();
    await screen.findByText('Order 12 was assigned to you');
    expect(screen.queryByRole('button', { name: 'Everyone' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Mark done' }).length).toBe(2);
  });

  it('owner: Everyone asks the API for scope=all and shows rows without write controls', async () => {
    setRole('super_admin');
    renderPage();
    await screen.findByText('Order 12 was assigned to you');
    await userEvent.click(screen.getByRole('button', { name: 'Everyone' }));
    await waitFor(() => expect(svc.list).toHaveBeenLastCalledWith({ view: 'all', status: 'open', scope: 'all' }));
    await screen.findByText('Order 12 was assigned to you');
    expect(screen.queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Snooze' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New reminder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument();
  });
  it('owner: in Everyone each row says who it is for', async () => {
    setRole('super_admin');
    renderPage();
    await screen.findByText('Order 12 was assigned to you');
    expect(screen.queryByText('For Ama Mensah')).not.toBeInTheDocument();
    svc.list.mockResolvedValue({ items: [{ ...ORDER_ROW, recipientName: 'Ama Mensah' }], nextCursor: null });
    await userEvent.click(screen.getByRole('button', { name: 'Everyone' }));
    expect(await screen.findByText('For Ama Mensah')).toBeInTheDocument();
  });
});
