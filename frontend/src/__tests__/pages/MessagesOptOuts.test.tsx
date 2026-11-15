import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Messages } from '../../pages/Messages';

const svc = vi.hoisted(() => ({ listConversations: vi.fn(), listOptOuts: vi.fn(), setOptOut: vi.fn() }));
vi.mock('../../services/messages.service', () => ({ messagesService: svc }));
vi.mock('../../services/communication.service', () => ({ communicationService: { getCampaigns: vi.fn().mockResolvedValue([]) } }));

let role: 'admin' | 'manager' = 'admin';
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    user: { id: 5, role }, isManager: true, isAdmin: role === 'admin',
    can: (r: string, a: string) => r === 'messages' && (a === 'view' || role === 'admin'),
  }),
}));

const row = (over: Record<string, unknown> = {}) => ({
  key: 'c1:sms', channel: 'sms', customerId: 1, name: 'Esther Nyarko', phone: '+233241110001', email: null, area: 'Accra',
  since: '2026-11-10T09:00:00.000Z', reason: 'stop_reply', ...over,
});
const PAGE = {
  items: [
    row(),
    row({ key: 'c2:whatsapp', channel: 'whatsapp', customerId: 2, name: 'Kojo Bonsu', phone: '+233241110002', area: 'Kumasi', reason: 'staff' }),
    row({ key: 'p+233271234567:sms', customerId: null, name: null, phone: '+233271234567', area: null, reason: 'unsubscribe_link' }),
  ],
  total: 3, page: 1, limit: 50,
};

const renderTab = () => render(
  <ToastProvider>
    <MemoryRouter initialEntries={['/messages?tab=optouts']}>
      <Routes><Route path="/messages" element={<Messages />} /></Routes>
    </MemoryRouter>
  </ToastProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  role = 'admin';
  svc.listConversations.mockResolvedValue({ items: [], nextCursor: null });
  svc.listOptOuts.mockResolvedValue(PAGE);
  svc.setOptOut.mockResolvedValue(undefined);
});

describe('Messages page: Opt-outs', () => {
  it('lists each opted-out customer and channel, and a phone that is not a customer', async () => {
    renderTab();
    expect(await screen.findByText('Esther Nyarko')).toBeInTheDocument();
    expect(screen.getByText('Kojo Bonsu')).toBeInTheDocument();
    expect(screen.getByText('Not a customer')).toBeInTheDocument();
    expect(screen.getByText('+233271234567')).toBeInTheDocument();
    expect(screen.getByText('Replied STOP')).toBeInTheDocument();
    expect(screen.getByText('Unsubscribe link')).toBeInTheDocument();
    expect(screen.getByText(/3 opted out/)).toBeInTheDocument();
  });

  it('asks the API again with the channel and the search', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Esther Nyarko');
    await user.selectOptions(screen.getByLabelText('Channel'), 'whatsapp');
    await waitFor(() => expect(svc.listOptOuts).toHaveBeenLastCalledWith({ channel: 'whatsapp', page: 1, limit: 50 }));
    await user.type(screen.getByLabelText('Search opt-outs'), 'kojo');
    await waitFor(() => expect(svc.listOptOuts).toHaveBeenLastCalledWith({ channel: 'whatsapp', q: 'kojo', page: 1, limit: 50 }));
  });

  it('shows an empty state', async () => {
    svc.listOptOuts.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 });
    renderTab();
    expect(await screen.findByText('Nobody has opted out')).toBeInTheDocument();
  });

  it('adds an opt-out by phone through the API', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: /Add opt-out/ }));
    const dlg = screen.getByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'WhatsApp' }));
    await user.type(within(dlg).getByLabelText('Phone number'), '024 555 0182');
    await user.click(within(dlg).getByRole('button', { name: 'Add opt-out' }));
    await waitFor(() => expect(svc.setOptOut).toHaveBeenCalledWith({ channel: 'whatsapp', optedOut: true, phone: '024 555 0182' }));
    await waitFor(() => expect(svc.listOptOuts).toHaveBeenCalledTimes(2));
  });

  it('shows the API sentence under the phone field when the number is refused', async () => {
    svc.setOptOut.mockRejectedValue({ response: { data: { message: 'That phone number is not valid.' } } });
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: /Add opt-out/ }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText('Phone number'), '12');
    await user.click(within(dlg).getByRole('button', { name: 'Add opt-out' }));
    expect(await within(dlg).findByText('That phone number is not valid.')).toBeInTheDocument();
  });

  it('removes an opt-out after a confirm, by the phone of the row', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: /Remove opt-out of Esther Nyarko on SMS/ }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(svc.setOptOut).toHaveBeenCalledWith({ channel: 'sms', optedOut: false, phone: '+233241110001' }));
    await waitFor(() => expect(svc.listOptOuts).toHaveBeenCalledTimes(2));
  });

  it('removes an email opt-out by its address', async () => {
    svc.listOptOuts.mockResolvedValue({ items: [row({ key: 'c3:email', channel: 'email', name: 'Ama', email: 'ama@example.test' })], total: 1, page: 1, limit: 50 });
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: /Remove opt-out of Ama on Email/ }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(svc.setOptOut).toHaveBeenCalledWith({ channel: 'email', optedOut: false, email: 'ama@example.test' }));
  });

  it('a manager reads the list and has no add or remove', async () => {
    role = 'manager';
    renderTab();
    expect(await screen.findByText('Esther Nyarko')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add opt-out/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });
});
