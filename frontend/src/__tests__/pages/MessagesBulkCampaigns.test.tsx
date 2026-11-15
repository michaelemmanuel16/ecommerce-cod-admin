import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Messages } from '../../pages/Messages';

const comm = vi.hoisted(() => ({
  getRecipients: vi.fn(), bulkSendSms: vi.fn(), bulkSendWhatsApp: vi.fn(), getCampaigns: vi.fn(),
}));
vi.mock('../../services/communication.service', () => ({ communicationService: comm }));
const msgs = vi.hoisted(() => ({ listConversations: vi.fn(), listTemplates: vi.fn() }));
vi.mock('../../services/messages.service', () => ({ messagesService: msgs }));
vi.mock('../../services/products.service', () => ({ productsService: { getProducts: vi.fn().mockResolvedValue([{ id: 3, name: 'Copybook set', isActive: true }]) } }));

let role: 'admin' | 'manager' = 'admin';
let canCreate = true;
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    user: { id: 5, role }, isManager: true, isAdmin: role === 'admin',
    can: (r: string, a: string) => r === 'messages' && (a === 'view' || canCreate),
  }),
}));

const recipient = (id: number, first: string) => ({ id, firstName: first, lastName: 'Test', phoneNumber: `+23324100000${id}`, state: 'Greater Accra', area: 'Accra', smsOptOut: false, whatsappOptOut: false });
const renderTab = (tab: string) => render(
  <ToastProvider>
    <MemoryRouter initialEntries={[`/messages?tab=${tab}`]}>
      <Routes><Route path="/messages" element={<Messages />} /></Routes>
    </MemoryRouter>
  </ToastProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  role = 'admin';
  canCreate = true;
  msgs.listConversations.mockResolvedValue({ items: [], nextCursor: null });
  msgs.listTemplates.mockResolvedValue([{ id: 1, channel: 'sms', name: 'Restock', body: 'Pens are back' }]);
  comm.getRecipients.mockResolvedValue({ recipients: [recipient(1, 'Ama'), recipient(2, 'Kofi')], total: 2, limit: 1000 });
  comm.bulkSendSms.mockResolvedValue({ total: 3, skipped: 1, results: [{ customerId: 1, success: true }, { customerId: 2, success: true }, { customerId: 3, success: false, skipped: true }] });
  comm.bulkSendWhatsApp.mockResolvedValue({ total: 2, skipped: 0, results: [{ customerId: 1, success: true }, { customerId: 2, success: false, error: 'x' }] });
  comm.getCampaigns.mockResolvedValue([]);
});

describe('Messages page: Bulk send', () => {
  it('finds recipients with the filters and sends SMS after a confirm, then shows the skipped count', async () => {
    const user = userEvent.setup();
    renderTab('bulk');
    await user.type(await screen.findByLabelText('Text'), 'Pens are back');
    await user.type(screen.getByLabelText('Region'), 'Greater Accra');
    await user.click(screen.getByRole('button', { name: 'Find recipients' }));
    await waitFor(() => expect(comm.getRecipients).toHaveBeenCalledWith({ channel: 'sms', state: 'Greater Accra' }));
    expect(await screen.findByText('Ama Test')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Send now/ }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(comm.bulkSendSms).toHaveBeenCalledWith([1, 2], 'Pens are back'));
    const last = await screen.findByText('Last send');
    const box = last.closest('[role=status]') as HTMLElement;
    expect(within(box).getByText('Skipped (opted out or not sendable)').nextSibling).toHaveTextContent('1');
    expect(within(box).getByText('Sent').nextSibling).toHaveTextContent('2');
  });

  it('says so when the list is capped: "1,000 of 1,837, the most one send allows"', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 1000 }, (_, i) => recipient(i + 1, 'Ama'));
    comm.getRecipients.mockResolvedValue({ recipients: many, total: 1837, limit: 1000 });
    renderTab('bulk');
    await user.type(await screen.findByLabelText('Text'), 'Pens are back');
    await user.click(screen.getByRole('button', { name: 'Find recipients' }));
    expect(await screen.findByText(/1,000 of 1,837, the most one send allows/)).toBeInTheDocument();
  });

  it('shows no cap note when every match is listed', async () => {
    const user = userEvent.setup();
    renderTab('bulk');
    await user.type(await screen.findByLabelText('Text'), 'Pens are back');
    await user.click(screen.getByRole('button', { name: 'Find recipients' }));
    await screen.findByText('Ama Test');
    expect(screen.queryByText(/the most one send allows/)).not.toBeInTheDocument();
  });

  it('WhatsApp send passes the template key and the link', async () => {
    const user = userEvent.setup();
    renderTab('bulk');
    await user.click(await screen.findByRole('button', { name: 'WhatsApp' }));
    await user.selectOptions(screen.getByLabelText('WhatsApp template'), 'confirmed');
    await user.type(screen.getByLabelText(/Custom link/), 'https://shop.test/x');
    await user.click(screen.getByRole('button', { name: 'Find recipients' }));
    await screen.findByText('Ama Test');
    await user.click(screen.getByRole('button', { name: /Send now/ }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(comm.bulkSendWhatsApp).toHaveBeenCalledWith([1, 2], 'confirmed', 'https://shop.test/x'));
  });

  it('shows the API message when the send is refused', async () => {
    comm.bulkSendSms.mockRejectedValue({ response: { data: { message: 'SMS is not set up' } } });
    const user = userEvent.setup();
    renderTab('bulk');
    await user.type(await screen.findByLabelText('Text'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Find recipients' }));
    await screen.findByText('Ama Test');
    await user.click(screen.getByRole('button', { name: /Send now/ }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Send/ }));
    expect(await screen.findByText('SMS is not set up')).toBeInTheDocument();
  });

  it('shows no Bulk send tab to a manager, or to an admin without messages:create', async () => {
    role = 'manager';
    const { unmount } = renderTab('bulk');
    expect(await screen.findByRole('tab', { name: /Campaigns/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Bulk send/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Find recipients' })).not.toBeInTheDocument();
    unmount();
    role = 'admin';
    canCreate = false;
    renderTab('bulk');
    await screen.findByRole('tab', { name: /Campaigns/ });
    expect(screen.queryByRole('tab', { name: /Bulk send/ })).not.toBeInTheDocument();
  });
});

describe('Messages page: Campaigns', () => {
  it('shows the empty state', async () => {
    renderTab('campaigns');
    expect(await screen.findByText('No campaigns yet')).toBeInTheDocument();
  });

  it('lists campaigns with their delivery counts and no write controls', async () => {
    comm.getCampaigns.mockResolvedValue([{
      id: 1, title: 'October promo', subject: 'Pens are back', body: '', status: 'completed', audienceTotal: 10, noEmailCount: 1, optedOutCount: 2, totalRecipients: 7,
      createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '',
      stats: { audienceTotal: 10, noEmail: 1, optedOut: 2, emailable: 7, waiting: 0, sent: 7, delivered: 6, failed: 1, skipped: 0 },
    }]);
    renderTab('campaigns');
    const row = (await screen.findByText('October promo')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Done')).toBeInTheDocument();
    expect(within(row).getAllByText('7').length).toBeGreaterThan(0);
    expect(within(row).getByText('3')).toBeInTheDocument(); // skipped: 1 no address + 2 opted out
    expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument();
  });
});
