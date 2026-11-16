import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { RepChatProvider, useRepChat } from '../../components/rep/RepChatPanel';
import { WhatsAppButton } from '../../components/rep/WhatsAppButton';
import { resetWhatsappConnected } from '../../hooks/useWhatsappConnected';
import { messagesService } from '../../services/messages.service';
import { customersService } from '../../services/customers.service';
import { useAuthStore } from '../../stores/authStore';

vi.mock('../../services/messages.service', () => ({
  messagesService: {
    getConversation: vi.fn(), getThread: vi.fn(), forOrder: vi.fn(), start: vi.fn(),
    approvedTemplates: vi.fn(), whatsappConnected: vi.fn(), reply: vi.fn(), update: vi.fn(), assignees: vi.fn(),
  },
}));
vi.mock('../../services/customers.service', () => ({ customersService: { getCustomerById: vi.fn() } }));
vi.mock('../../pages/inbox/ThreadPanel', () => ({ ThreadPanel: () => null }));
const svc = vi.mocked(messagesService);

const ROW = {
  id: 47, channel: 'whatsapp', phone: '+233245550103', customerId: 5, customerName: 'Abena Owusu', displayName: 'Abena Owusu',
  lastMessagePreview: 'Is it ready?', lastMessageDirection: 'inbound', lastMessageAt: new Date().toISOString(), unanswered: true,
  status: 'open', assignedTo: null, windowOpen: true, windowExpiresAt: null,
} as never;
const MESSAGE = { id: 1, direction: 'inbound', messageBody: 'Is it ready?', status: 'delivered', createdAt: new Date().toISOString(), orderId: null, inReplyToId: null };

const renderButton = () => render(
  <MemoryRouter><ToastProvider><RepChatProvider><WhatsAppButton orderId={12} customerName="Abena" /></RepChatProvider></ToastProvider></MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  resetWhatsappConnected();
  useAuthStore.setState({ user: { id: 98, email: 'r@b.c', firstName: 'Qa', lastName: 'Rep', role: 'sales_rep', createdAt: '', updatedAt: '' } as never });
  svc.whatsappConnected.mockResolvedValue(true);
  svc.getConversation.mockResolvedValue(ROW);
  svc.getThread.mockResolvedValue({ conversation: { id: 47, phone: '+233245550103', customerId: 5, status: 'open', unanswered: true, windowOpen: true }, messages: [MESSAGE] } as never);
  svc.approvedTemplates.mockResolvedValue([]);
});

describe('Rep chat panel', () => {
  it('the button opens the existing chat of the order over the page, with a reply box, no Assign select, and closes', async () => {
    svc.forOrder.mockResolvedValue({ conversationId: 47, orderId: 12, phone: '+233245550103', customerName: 'Abena Owusu', windowOpen: true });
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'WhatsApp Abena' }));
    const panel = await screen.findByTestId('rep-chat-panel');
    expect(svc.forOrder).toHaveBeenCalledWith(12);
    expect(await within(panel).findByText('Is it ready?')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Reply')).toBeEnabled();
    expect(within(panel).queryByRole('combobox', { name: 'Assign to' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Mark done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'WhatsApp Abena' })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('rep-chat-close'));
    expect(screen.queryByTestId('rep-chat-panel')).not.toBeInTheDocument();
  });

  it('with no WhatsApp connection the button still opens the panel: history shows, reply box disabled with the hint', async () => {
    svc.whatsappConnected.mockResolvedValue(false);
    svc.forOrder.mockResolvedValue({ conversationId: 47, orderId: 12, phone: '+233245550103', customerName: 'Abena Owusu', windowOpen: true });
    renderButton();
    const button = screen.getByRole('button', { name: 'WhatsApp Abena' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    const panel = await screen.findByTestId('rep-chat-panel');
    expect(await within(panel).findByText('Is it ready?')).toBeInTheDocument();
    await waitFor(() => expect(within(panel).getByLabelText('Reply')).toBeDisabled());
    expect(within(panel).getByText('WhatsApp is not connected')).toBeInTheDocument();
    expect(document.querySelector('a[href*="wa.me"]')).toBeNull();
  });

  it('with no chat yet it shows an empty chat; the first template send starts the conversation and the panel moves to it', async () => {
    svc.forOrder.mockResolvedValue({ conversationId: null, orderId: 12, phone: '+233245550103', customerName: 'Abena Owusu', windowOpen: false });
    svc.approvedTemplates.mockResolvedValue([{ id: 3, name: 'order_hello', body: 'Hello', variables: [], sendable: true }] as never);
    svc.start.mockResolvedValue(47);
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'WhatsApp Abena' }));
    expect(await screen.findByText('No messages yet')).toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByLabelText('Template'), '3');
    await userEvent.click(screen.getByRole('button', { name: /Send template/ }));
    expect(svc.start).toHaveBeenCalledWith(12, { templateId: 3, variables: [] });
    await waitFor(() => expect(svc.getConversation).toHaveBeenCalledWith(47));
    expect(await screen.findByText('Is it ready?')).toBeInTheDocument();
  });

  it('says so when the chat is not available', async () => {
    svc.forOrder.mockRejectedValue(new Error('404'));
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'WhatsApp Abena' }));
    expect(await screen.findByText('This chat is not available')).toBeInTheDocument();
  });

  it('a blocked chat shows the manager message and a disabled reply box', async () => {
    svc.forOrder.mockResolvedValue({ conversationId: null, blocked: true, orderId: 12, phone: '+233245550103', customerName: 'Abena Owusu', windowOpen: false });
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'WhatsApp Abena' }));
    const panel = await screen.findByTestId('rep-chat-panel');
    expect(await within(panel).findByText('A chat with this number already exists. Ask a manager to link it to this customer.')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Reply')).toBeDisabled();
    expect(svc.start).not.toHaveBeenCalled();
  });
});

describe('Team notes title', () => {
  const NotesButton = () => { const { openNotes } = useRepChat(); return <button onClick={() => openNotes({ type: 'customer', id: 5 })}>notes</button>; };
  const open = async () => {
    render(<MemoryRouter><ToastProvider><RepChatProvider><NotesButton /></RepChatProvider></ToastProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'notes' }));
    return screen.findByTestId('rep-notes-panel');
  };

  it('keeps a real name that contains "null"', async () => {
    vi.mocked(customersService.getCustomerById).mockResolvedValue({ firstName: 'Null', lastName: 'Anderson' } as never);
    const panel = await open();
    expect(await within(panel).findByText(/Null Anderson/)).toBeInTheDocument();
  });

  it('falls back to the numbered label for a name built from missing parts', async () => {
    vi.mocked(customersService.getCustomerById).mockResolvedValue({} as never);
    const panel = await open();
    await waitFor(() => expect(customersService.getCustomerById).toHaveBeenCalled());
    expect(within(panel).getByText(/Customer/)).toBeInTheDocument();
    expect(within(panel).queryByText(/Null Anderson/)).not.toBeInTheDocument();
  });
});
