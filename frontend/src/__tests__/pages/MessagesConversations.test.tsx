import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Messages } from '../../pages/Messages';
import { conversation, message, thread } from '../fixtures/messages';

const svc = vi.hoisted(() => ({
  listConversations: vi.fn(), getThread: vi.fn(), reply: vi.fn(), update: vi.fn(), approvedTemplates: vi.fn(), assignees: vi.fn(),
  overview: vi.fn(), log: vi.fn(),
}));
vi.mock('../../services/messages.service', () => ({ messagesService: svc }));

let canWrite = true;
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ user: { id: 5, role: 'admin' }, isManager: true, can: (r: string, a: string) => r === 'messages' && (a === 'view' || canWrite) }),
}));

const renderPage = (path = '/messages?tab=conversations') => render(
  <ToastProvider>
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/messages" element={<Messages />} /></Routes>
    </MemoryRouter>
  </ToastProvider>,
);

const openFirst = async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: /Ama Mensah/ }));
  return user;
};

beforeEach(() => {
  vi.clearAllMocks();
  canWrite = true;
  svc.listConversations.mockResolvedValue({ items: [conversation()], nextCursor: null });
  svc.getThread.mockResolvedValue(thread([
    message({ id: 1, direction: 'inbound', status: 'delivered', messageBody: 'Where is my order?' }),
    message({ id: 2, status: 'read', messageBody: 'It leaves today', inReplyToId: 1 }),
    message({ id: 3, status: 'failed', messageBody: 'Did you get it?', errorMessage: 'Number is not on WhatsApp' }),
    message({ id: 4, status: 'replied', messageBody: 'Order update' }),
    message({ id: 5, status: 'delivered', messageBody: 'Delivered one' }),
  ]));
  svc.update.mockResolvedValue(undefined);
  svc.reply.mockResolvedValue(undefined);
  svc.assignees.mockResolvedValue([{ id: 5, name: 'Owner One' }, { id: 6, name: 'Adwoa Boateng' }]);
  svc.approvedTemplates.mockResolvedValue([{ id: 9, name: 'Order update', body: 'Hello {{1}}, your order ships today', variables: ['1'], status: 'approved', sendable: true }]);
});

describe('Messages page: Conversations', () => {
  it('lists conversations with the unanswered dot and asks for the Unanswered filter first', async () => {
    renderPage();
    const row = await screen.findByRole('button', { name: /Ama Mensah/ });
    expect(within(row).getByRole('img', { name: 'Not answered' })).toBeInTheDocument();
    expect(within(row).getByText('Where is my order?')).toBeInTheDocument();
    expect(svc.listConversations).toHaveBeenCalledWith({ status: 'open', unanswered: true });
  });

  it('shows *text* in a bubble as bold (T51)', async () => {
    svc.getThread.mockResolvedValue(thread([message({ id: 1, status: 'delivered', messageBody: 'Order *#55* is ready' })]));
    await openFirst();
    const strong = await screen.findByText('#55');
    expect(strong.tagName).toBe('STRONG');
  });

  it('the Mine and All filters change the request', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: /Ama Mensah/ });
    await user.click(screen.getByRole('button', { name: 'Mine' }));
    await waitFor(() => expect(svc.listConversations).toHaveBeenLastCalledWith({ status: 'open', assignedTo: 'me' }));
    await user.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(svc.listConversations).toHaveBeenLastCalledWith({}));
  });

  it('shows the empty state', async () => {
    svc.listConversations.mockResolvedValue({ items: [], nextCursor: null });
    renderPage();
    expect(await screen.findByText('Nobody is waiting for an answer')).toBeInTheDocument();
  });

  it('shows each message status in the thread and the message a reply answers', async () => {
    await openFirst();
    const messages = await screen.findByLabelText('Conversation messages');
    expect(await within(messages).findByText('Read')).toBeInTheDocument();
    expect(within(messages).getByText('Failed')).toBeInTheDocument();
    expect(within(messages).getByText('Replied')).toBeInTheDocument();
    expect(within(messages).getByText('Delivered')).toBeInTheDocument();
    expect(within(messages).getByText('Number is not on WhatsApp')).toBeInTheDocument();
    expect(within(messages).getByText(/Replying to: Where is my order\?/)).toBeInTheDocument();
  });

  it('a reply with the window open calls the reply endpoint with the text', async () => {
    const user = await openFirst();
    await user.type(await screen.findByLabelText('Reply'), 'It leaves today');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(svc.reply).toHaveBeenCalledWith(1, { body: 'It leaves today' }));
    expect(await screen.findByText('Reply sent')).toBeInTheDocument();
  });

  it('with the window closed says so and offers only approved templates', async () => {
    svc.getThread.mockResolvedValue(thread([message({ direction: 'inbound', messageBody: 'Hi' })], { windowOpen: false }));
    const user = await openFirst();
    expect(await screen.findByText('The 24 hour window is closed. Send an approved template.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reply')).not.toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText('Template'), '9');
    await user.type(screen.getByLabelText('Value for 1'), 'Ama');
    await user.click(screen.getByRole('button', { name: /Send template/ }));
    await waitFor(() => expect(svc.reply).toHaveBeenCalledWith(1, { templateId: 9, variables: ['Ama'] }));
  });

  it('shows the API message when a reply is refused', async () => {
    svc.reply.mockRejectedValue({ response: { data: { message: 'The customer opted out of WhatsApp' } } });
    const user = await openFirst();
    await user.type(await screen.findByLabelText('Reply'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));
    expect(await screen.findByText('The customer opted out of WhatsApp')).toBeInTheDocument();
  });

  it('Assign and Mark done call the update endpoint', async () => {
    const user = await openFirst();
    await user.selectOptions(await screen.findByLabelText('Assign to'), '6');
    await waitFor(() => expect(svc.update).toHaveBeenCalledWith(1, { assignedToId: 6 }));
    await user.click(screen.getByRole('button', { name: /Mark done/ }));
    await waitFor(() => expect(svc.update).toHaveBeenCalledWith(1, { status: 'done' }));
  });

  it('a user without messages:create sees the thread but no reply box, Assign or Mark done', async () => {
    canWrite = false;
    await openFirst();
    await screen.findByLabelText('Conversation messages');
    expect(screen.queryByLabelText('Reply')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Assign to')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark done/ })).not.toBeInTheDocument();
  });
});
