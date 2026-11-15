import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { MessagesBlock } from '../../pages/messages/MessagesBlock';
import { SubjectReminder } from '../../pages/inbox/SubjectReminder';
import { ThreadPanel } from '../../pages/inbox/ThreadPanel';

const inboxSvc = vi.hoisted(() => ({ listReminders: vi.fn(), createReminder: vi.fn(), cancelReminder: vi.fn(), getThread: vi.fn(), mentionable: vi.fn(), addComment: vi.fn() }));
vi.mock('../../services/inbox.service', async (orig) => ({ ...(await orig<typeof import('../../services/inbox.service')>()), inboxService: inboxSvc }));
const messagesSvc = vi.hoisted(() => ({ forSubject: vi.fn() }));
vi.mock('../../services/messages.service', () => ({ messagesService: messagesSvc }));

const wrap = (ui: React.ReactNode) => render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);
const msg = (id: number, over: Record<string, unknown>) => ({ id, channel: 'whatsapp', direction: 'outbound', status: 'sent', at: '2026-11-14T10:00:00.000Z', bodyPreview: `Body ${id}`, inReplyToId: null, errorMessage: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  inboxSvc.listReminders.mockResolvedValue([]);
  inboxSvc.getThread.mockResolvedValue({ id: 1, subjectType: 'order', subjectId: 12, archived: false, unreadCount: 0, comments: [] });
  inboxSvc.mentionable.mockResolvedValue([{ id: 8, name: 'Esi Badu', role: 'manager' }]);
});
afterEach(() => vi.useRealTimers());

describe('MessagesBlock (T36)', () => {
  it('shows channel, status and time for each message, and the opt-outs of a customer', async () => {
    messagesSvc.forSubject.mockResolvedValue({
      items: [
        msg(1, { status: 'delivered' }), msg(2, { channel: 'sms', status: 'failed', errorMessage: 'Number not reachable' }),
        msg(3, { status: 'read' }), msg(4, { direction: 'inbound', status: 'replied', bodyPreview: 'Yes, come at 3' }), msg(5, { channel: 'email', status: 'sent' }),
      ],
      optOut: { whatsapp: false, sms: true, email: false },
    });
    wrap(<MessagesBlock type="customer" id={4} phone="0245550182" canOpenConversation emptyText="none" />);
    expect(await screen.findByText('Delivered')).toBeInTheDocument();
    for (const w of ['Failed', 'Read', 'Replied', 'Sent']) expect(screen.getByText(w)).toBeInTheDocument();
    expect(screen.getByText('Number not reachable')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp reply')).toBeInTheDocument();
    expect(screen.getByText('Opted out of: SMS.')).toBeInTheDocument();
    expect(messagesSvc.forSubject).toHaveBeenCalledWith('customer', 4);
    expect(screen.getByRole('link', { name: 'Open the conversation' })).toHaveAttribute('href', '/messages?tab=conversations&q=0245550182');
  });

  it('shows the empty text, and no conversation link without the Messages permission', async () => {
    messagesSvc.forSubject.mockResolvedValue({ items: [] });
    wrap(<MessagesBlock type="order" id={12} phone="0245550182" canOpenConversation={false} emptyText="No messages yet here." />);
    expect(await screen.findByText('No messages yet here.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('hides the conversation link for a person who may not open Messages', async () => {
    messagesSvc.forSubject.mockResolvedValue({ items: [msg(1, {})] });
    wrap(<MessagesBlock type="order" id={12} phone="0245550182" canOpenConversation={false} emptyText="none" />);
    expect(await screen.findByText('Body 1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open the conversation' })).not.toBeInTheDocument();
  });

  it('says so when the messages do not load', async () => {
    messagesSvc.forSubject.mockRejectedValue(new Error('down'));
    wrap(<MessagesBlock type="order" id={12} canOpenConversation={false} emptyText="none" />);
    expect(await screen.findByText('The messages did not load.')).toBeInTheDocument();
  });
});

describe('SubjectReminder (T36)', () => {
  const open = async () => {
    wrap(<SubjectReminder subject={{ type: 'order', id: 12 }} note="Follow up on #12" />);
    await userEvent.click(await screen.findByRole('button', { name: /Set reminder/ }));
    return screen.getByRole('dialog');
  };

  it('refuses a past time in the picker and sends nothing', async () => {
    const dlg = await open();
    const date = within(dlg).getByLabelText('Due date') as HTMLInputElement;
    expect(date.min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.change(date, { target: { value: '2020-01-01' } });
    expect(within(dlg).getByText('Pick a time that has not passed yet')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Create reminder' })).toBeDisabled();
    expect(inboxSvc.createReminder).not.toHaveBeenCalled();
  });

  it('saves a future reminder linked to the order, then lists it with a cancel', async () => {
    inboxSvc.createReminder.mockResolvedValue({});
    const dlg = await open();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create reminder' }));
    await waitFor(() => expect(inboxSvc.createReminder).toHaveBeenCalledWith(expect.objectContaining({ note: 'Follow up on #12', subjectType: 'order', subjectId: 12, dueAt: expect.any(String) })));
    expect(new Date(inboxSvc.createReminder.mock.calls[0][0].dueAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('shows the pending reminders of this order only, and cancels one', async () => {
    inboxSvc.listReminders.mockResolvedValue([
      { id: 1, subjectType: 'order', subjectId: 12, note: 'Call back', dueAt: '2030-01-02T09:00:00.000Z', status: 'pending' },
      { id: 2, subjectType: 'order', subjectId: 99, note: 'Other order', dueAt: '2030-01-02T09:00:00.000Z', status: 'pending' },
    ]);
    inboxSvc.cancelReminder.mockResolvedValue(undefined);
    wrap(<SubjectReminder subject={{ type: 'order', id: 12 }} note="x" />);
    expect(await screen.findByText(/Call back/)).toBeInTheDocument();
    expect(screen.queryByText(/Other order/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel reminder' }));
    await waitFor(() => expect(inboxSvc.cancelReminder).toHaveBeenCalledWith(1));
  });
});

describe('ThreadPanel inline (T36)', () => {
  it('a note with a mention sends the user id; a reply sends the parent id', async () => {
    inboxSvc.addComment.mockResolvedValue({});
    inboxSvc.getThread.mockResolvedValue({
      id: 1, subjectType: 'order', subjectId: 12, archived: false, unreadCount: 0,
      comments: [{ id: 5, parentId: null, authorId: 3, authorName: 'Ama Boateng', body: 'Check this', mentionIds: [], edited: false, deleted: false, createdAt: '2026-11-14T10:00:00.000Z' }],
    });
    wrap(<ThreadPanel subject={{ type: 'order', id: 12 }} />);
    expect(await screen.findByText('Check this')).toBeInTheDocument();
    const box = screen.getByLabelText('Team note');
    await userEvent.type(box, 'Thanks @');
    await userEvent.click(await screen.findByRole('option', { name: /Esi Badu/ }));
    await userEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(inboxSvc.addComment).toHaveBeenCalledWith('order', 12, { body: 'Thanks @Esi Badu ', mentionIds: [8] }));
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await userEvent.type(screen.getByLabelText('Team note'), 'Done');
    await userEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(inboxSvc.addComment).toHaveBeenLastCalledWith('order', 12, { body: 'Done', parentId: 5 }));
  });
});
