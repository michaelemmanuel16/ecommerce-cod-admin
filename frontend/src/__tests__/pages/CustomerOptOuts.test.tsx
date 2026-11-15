import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CustomerDetails } from '../../pages/CustomerDetails';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { DETAIL } from '../fixtures/customersList';

const getCustomerDetail = vi.fn();
const setOptOut = vi.fn();
vi.mock('../../services/locations.service', () => ({ locationsService: { getTowns: () => Promise.resolve([]) } }));
vi.mock('../../services/customers.service', () => ({
  customersService: { getCustomerDetail: (...a: unknown[]) => getCustomerDetail(...a), setOptOut: (...a: unknown[]) => setOptOut(...a) },
}));

const renderPage = () => render(
  <MemoryRouter initialEntries={['/customers/1']}>
    <ToastProvider>
      <Routes><Route path="/customers/:id" element={<CustomerDetails />} /></Routes>
    </ToastProvider>
  </MemoryRouter>,
);
const as = (role: string, customers: string[]) => useAuthStore.setState({ user: { id: 1, role, firstName: 'A', lastName: 'B' } as never, permissions: { customers, orders: ['view'] } });

beforeEach(() => {
  getCustomerDetail.mockReset().mockResolvedValue({ ...DETAIL, smsOptOut: true });
  setOptOut.mockReset().mockResolvedValue({ flags: { sms: true, whatsapp: true, email: false } });
  useConfigStore.setState({ currency: 'GHS', loaded: true });
});

describe('Customer page: opt-out flags', () => {
  it('staff with customers:update toggle a channel through the API and the page shows the new flags', async () => {
    as('admin', ['view', 'update']);
    const user = userEvent.setup();
    renderPage();
    const sms = await screen.findByRole('switch', { name: 'SMS opt-out' });
    expect(sms).toHaveAttribute('aria-checked', 'true');
    const wa = screen.getByRole('switch', { name: 'WhatsApp opt-out' });
    expect(wa).toHaveAttribute('aria-checked', 'false');
    await user.click(wa);
    await waitFor(() => expect(setOptOut).toHaveBeenCalledWith(1, 'whatsapp', true));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'WhatsApp opt-out' })).toHaveAttribute('aria-checked', 'true'));
  });

  it('turning a flag off sends optedOut false', async () => {
    as('admin', ['view', 'update']);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('switch', { name: 'SMS opt-out' }));
    await waitFor(() => expect(setOptOut).toHaveBeenCalledWith(1, 'sms', false));
  });

  it('shows the API sentence and keeps the flag when the change is refused', async () => {
    as('admin', ['view', 'update']);
    setOptOut.mockRejectedValue(Object.assign(new Error('x'), { isAxiosError: true, response: { data: { error: 'Customer not found' } } }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('switch', { name: 'WhatsApp opt-out' }));
    expect(await screen.findByText('Customer not found')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'WhatsApp opt-out' })).toHaveAttribute('aria-checked', 'false');
  });

  it('a user without customers:update only reads the flags: no switch', async () => {
    as('manager', ['view']);
    renderPage();
    expect(await screen.findByText('Opted out')).toBeInTheDocument();
    expect(screen.getAllByText('Receives')).toHaveLength(2);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(setOptOut).not.toHaveBeenCalled();
  });
});
