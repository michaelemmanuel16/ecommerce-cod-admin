import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../components/ui-v2';
import { RepInboxPage } from '../../pages/rep/RepInboxPage';
import { RepChatProvider } from '../../components/rep/RepChatPanel';
import { messagesService } from '../../services/messages.service';
import { productsService } from '../../services/products.service';
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
vi.mock('../../services/messages.service', () => ({
  messagesService: { getConversation: vi.fn(), getThread: vi.fn(), approvedTemplates: vi.fn(), whatsappConnected: vi.fn(), assignees: vi.fn() },
}));
vi.mock('../../services/products.service', () => ({ productsService: { detail: vi.fn() } }));
vi.mock('../../services/socket', () => ({ getSocket: vi.fn() }));

const svc = vi.mocked(inboxService);
const msg = vi.mocked(messagesService);
const products = vi.mocked(productsService);
const renderPage = () => render(<MemoryRouter><ToastProvider><RepChatProvider><RepInboxPage /></RepChatProvider></ToastProvider></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  useInboxStore.getState().stop();
  useAuthStore.setState({ user: { id: 42, email: 'a@b.c', firstName: 'Adwoa', lastName: 'Darko', role: 'sales_rep', createdAt: '', updatedAt: '' } as never });
  msg.getConversation.mockResolvedValue({ id: 47, channel: 'whatsapp', phone: '+233245550103', customerId: 5, customerName: 'Abena Owusu', displayName: 'Abena Owusu', lastMessagePreview: 'Hi', lastMessageDirection: 'inbound', lastMessageAt: new Date().toISOString(), unanswered: true, status: 'open', assignedTo: null, windowOpen: true, windowExpiresAt: null } as never);
  msg.getThread.mockResolvedValue({ conversation: { id: 47, phone: '+233245550103', customerId: 5, status: 'open', unanswered: true, windowOpen: true }, messages: [] } as never);
  msg.approvedTemplates.mockResolvedValue([]);
  msg.whatsappConnected.mockResolvedValue(true);
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

  it('a conversation row opens the chat panel over the Inbox, with no assign select', async () => {
    svc.list.mockResolvedValue({ items: [
      item(7, { kind: 'reply', event: 'customer_reply', title: 'Abena replied on WhatsApp', subject: { type: 'conversation', id: 47 } }),
    ], nextCursor: null });
    renderPage();
    const rows = await screen.findAllByTestId('inbox-row');
    expect(within(rows[0]).queryByRole('link', { name: 'Conversation #47' })).not.toBeInTheDocument();
    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Conversation #47' }));
    const panel = await screen.findByTestId('rep-chat-panel');
    expect(msg.getConversation).toHaveBeenCalledWith(47);
    expect(await within(panel).findByLabelText('Reply')).toBeInTheDocument();
    expect(within(panel).queryByRole('combobox', { name: 'Assign to' })).not.toBeInTheDocument();
    expect(msg.assignees).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('rep-chat-close'));
    expect(screen.queryByTestId('rep-chat-panel')).not.toBeInTheDocument();
  });

  it('a team note row on an order opens the team-notes panel for that order; a reminder row keeps its link', async () => {
    svc.getThread.mockResolvedValue({ id: 1, subjectType: 'order', subjectId: 12, archived: false, unreadCount: 0, comments: [] });
    svc.mentionable.mockResolvedValue([]);
    renderPage();
    const rows = await screen.findAllByTestId('inbox-row');
    expect(within(rows[0]).getByRole('link', { name: 'Order #12' })).toBeInTheDocument();
    await userEvent.click(within(rows[1]).getByRole('button', { name: 'Order #12' }));
    const panel = await screen.findByTestId('rep-notes-panel');
    expect(within(panel).getByRole('link', { name: 'Order #12' })).toBeInTheDocument();
    await waitFor(() => expect(svc.getThread).toHaveBeenCalledWith('order', 12));
    await userEvent.click(screen.getByTestId('rep-chat-close'));
    expect(screen.queryByTestId('rep-notes-panel')).not.toBeInTheDocument();
  });

  it('a product note row opens the rep team-notes panel titled with the product name, not the staff drawer', async () => {
    products.detail.mockResolvedValue({ id: 1, name: 'Dictamni Cream' } as never);
    svc.getThread.mockResolvedValue({ id: 2, subjectType: 'product', subjectId: 1, archived: false, unreadCount: 0, comments: [] });
    svc.mentionable.mockResolvedValue([]);
    svc.list.mockResolvedValue({ items: [
      item(9, { kind: 'note', event: 'team_note', title: 'Kofi added a note on product #1', subject: { type: 'product', id: 1 } }),
    ], nextCursor: null });
    renderPage();
    const rows = await screen.findAllByTestId('inbox-row');
    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Product #1' }));
    const panel = await screen.findByTestId('rep-notes-panel');
    expect(await within(panel).findByText('Team notes · Dictamni Cream')).toBeInTheDocument();
    expect(products.detail).toHaveBeenCalledWith(1);
    await waitFor(() => expect(svc.getThread).toHaveBeenCalledWith('product', 1));
    expect(screen.queryByText('Product #1 thread')).not.toBeInTheDocument();
  });

  it('falls back to "Product #1" when the name cannot be fetched', async () => {
    products.detail.mockRejectedValue(new Error('no'));
    svc.getThread.mockResolvedValue({ id: 2, subjectType: 'product', subjectId: 1, archived: false, unreadCount: 0, comments: [] });
    svc.mentionable.mockResolvedValue([]);
    svc.list.mockResolvedValue({ items: [
      item(9, { kind: 'note', event: 'team_note', title: 'Kofi added a note on product #1', subject: { type: 'product', id: 1 } }),
    ], nextCursor: null });
    renderPage();
    const rows = await screen.findAllByTestId('inbox-row');
    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Open' }));
    const panel = await screen.findByTestId('rep-notes-panel');
    expect(within(panel).getByText('Team notes · Product #1')).toBeInTheDocument();
  });

  it('has no Open thread icon in the rep app: the Open icon opens the same notes panel', async () => {
    products.detail.mockResolvedValue({ id: 1, name: 'Dictamni Cream' } as never);
    svc.getThread.mockResolvedValue({ id: 2, subjectType: 'product', subjectId: 1, archived: false, unreadCount: 0, comments: [] });
    svc.mentionable.mockResolvedValue([]);
    svc.list.mockResolvedValue({ items: [
      item(9, { kind: 'mention', event: 'mention', title: 'Kofi mentioned you on product #1', subject: { type: 'product', id: 1 } }),
    ], nextCursor: null });
    renderPage();
    const rows = await screen.findAllByTestId('inbox-row');
    expect(within(rows[0]).queryByRole('button', { name: 'Open thread' })).not.toBeInTheDocument();
    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Open' }));
    const panel = await screen.findByTestId('rep-notes-panel');
    expect(await within(panel).findByText('Team notes · Dictamni Cream')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /thread/i })).not.toBeInTheDocument();
  });

  it('the order title in the notes panel links to the rep order page and closes the panel', async () => {
    svc.getThread.mockResolvedValue({ id: 1, subjectType: 'order', subjectId: 12, archived: false, unreadCount: 0, comments: [] });
    svc.mentionable.mockResolvedValue([]);
    renderPage();
    const rows = await screen.findAllByTestId('inbox-row');
    await userEvent.click(within(rows[1]).getByRole('button', { name: 'Order #12' }));
    const panel = await screen.findByTestId('rep-notes-panel');
    const link = within(panel).getByRole('link', { name: 'Order #12' });
    expect(link).toHaveAttribute('href', '/rep/call/12');
    await userEvent.click(link);
    expect(screen.queryByTestId('rep-notes-panel')).not.toBeInTheDocument();
  });

  it('a product title in the notes panel stays plain text', async () => {
    products.detail.mockResolvedValue({ id: 1, name: 'Dictamni Cream' } as never);
    svc.getThread.mockResolvedValue({ id: 2, subjectType: 'product', subjectId: 1, archived: false, unreadCount: 0, comments: [] });
    svc.mentionable.mockResolvedValue([]);
    svc.list.mockResolvedValue({ items: [
      item(9, { kind: 'note', event: 'team_note', title: 'Kofi added a note on product #1', subject: { type: 'product', id: 1 } }),
    ], nextCursor: null });
    renderPage();
    const rows = await screen.findAllByTestId('inbox-row');
    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Product #1' }));
    const panel = await screen.findByTestId('rep-notes-panel');
    expect(await within(panel).findByText('Team notes · Dictamni Cream')).toBeInTheDocument();
    expect(within(panel).queryByRole('link')).not.toBeInTheDocument();
  });

  it('a note opens its thread; Mark done calls the API', async () => {
    svc.getThread.mockResolvedValue({ id: 1, subjectType: 'order', subjectId: 12, archived: false, unreadCount: 0, comments: [] });
    svc.mentionable.mockResolvedValue([]);
    svc.patch.mockResolvedValue({ item: item(1), counts: { ...COUNTS, all: 2 } });
    renderPage();
    const rows = await screen.findAllByTestId('inbox-row');
    await userEvent.click(within(rows[1]).getByRole('button', { name: 'Open' }));
    expect(await screen.findByTestId('rep-notes-panel')).toBeInTheDocument();
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
