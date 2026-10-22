import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CustomerDetails } from '../../pages/CustomerDetails';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { DETAIL } from '../fixtures/customersList';

const getCustomerDetail = vi.fn();
const deleteCustomer = vi.fn();
const updateCustomer = vi.fn();
vi.mock('../../services/customers.service', () => ({
  customersService: {
    getCustomerDetail: (...a: unknown[]) => getCustomerDetail(...a),
    deleteCustomer: (...a: unknown[]) => deleteCustomer(...a),
    updateCustomer: (...a: unknown[]) => updateCustomer(...a),
  },
}));

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderPage(url = '/customers/1') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Where />
        <Routes>
          <Route path="/customers" element={<div>CUSTOMERS LIST</div>} />
          <Route path="/customers/:id" element={<CustomerDetails />} />
          <Route path="/orders/:id" element={<div>ORDER PAGE</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const ALL = { customers: ['view', 'create', 'update', 'delete', 'export'], orders: ['view', 'create'] };

beforeEach(() => {
  [getCustomerDetail, deleteCustomer, updateCustomer].forEach((m) => m.mockReset());
  getCustomerDetail.mockResolvedValue(DETAIL);
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  useAuthStore.setState({ user: { id: 1, role: 'admin', firstName: 'Manny', lastName: 'A' } as never, permissions: ALL });
});

describe('Customer detail: header, tiles, blocks (F-354)', () => {
  it('shows the name, local phone, Call and WhatsApp links and the risk tag', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Abena Owusu' })).toBeInTheDocument();
    expect(screen.getByText(/024 555 0182 · Kumasi/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Call/ })).toHaveAttribute('href', 'tel:+233245550182');
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/233245550182');
    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it('shows the six tiles', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Abena Owusu' });
    const tile = (label: string) => screen.getByText(label, { selector: '.l' }).closest('.kpi') as HTMLElement;
    expect(tile('Orders')).toHaveTextContent('5');
    expect(tile('Delivered')).toHaveTextContent('4');
    expect(tile('Refused')).toHaveTextContent('0');
    expect(tile('Delivered value')).toHaveTextContent('GH₵996');
    expect(tile('Average order value')).toHaveTextContent('GH₵249');
    expect(tile('Last order')).toHaveTextContent('17 Oct');
  });

  it('shows a dash for the average order value when nothing was delivered', async () => {
    getCustomerDetail.mockResolvedValue({ ...DETAIL, deliveredOrders: 0, averageOrderValue: null, lastOrderAt: null });
    renderPage();
    await screen.findByRole('heading', { name: 'Abena Owusu' });
    expect(screen.getByText('Average order value', { selector: '.l' }).closest('.kpi')).toHaveTextContent('—');
    expect(screen.getByText('Last order', { selector: '.l' }).closest('.kpi')).toHaveTextContent('—');
  });

  it('shows contact, opt-outs, address, landmark and internal notes', async () => {
    getCustomerDetail.mockResolvedValue({ ...DETAIL, whatsappOptOut: true });
    renderPage();
    await screen.findByRole('heading', { name: 'Abena Owusu' });
    expect(screen.getByText('abena@example.com')).toBeInTheDocument();
    expect(screen.getByText('020 000 1111')).toBeInTheDocument();
    expect(screen.getByText('Opted out')).toBeInTheDocument();
    expect(screen.getByText('12 Ring Road')).toBeInTheDocument();
    expect(screen.getByText('Ashanti')).toBeInTheDocument();
    expect(screen.getByText('Opposite the bank')).toBeInTheDocument();
    expect(screen.getByText('Calls after 6pm')).toBeInTheDocument();
  });

  it('a blocked customer shows the COD off tag and the banner with the reason', async () => {
    getCustomerDetail.mockResolvedValue({ ...DETAIL, refusedOrders: 3, risk: 'high', codBlocked: true });
    renderPage();
    expect(await screen.findByText('COD off')).toBeInTheDocument();
    expect(screen.getByText('Refused 3 deliveries. New orders go to a manual call.')).toBeInTheDocument();
  });

  it('a deleted customer shows the banner and no Edit, Delete or New order', async () => {
    getCustomerDetail.mockResolvedValue({ ...DETAIL, isActive: false });
    renderPage();
    expect(await screen.findByText('This customer was deleted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /New order/ })).toBeNull();
  });

  it('a customer who cannot be opened says so', async () => {
    getCustomerDetail.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    renderPage();
    expect(await screen.findByText('This customer could not be found.')).toBeInTheDocument();
  });
});

describe('Customer detail: tabs (F-354)', () => {
  it('Orders lists number, date, status and amount; a click opens the order', async () => {
    renderPage();
    const row = (await screen.findByText('#24117')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Delivered')).toBeInTheDocument();
    expect(within(row).getByText('GH₵249')).toBeInTheDocument();
    expect(screen.getByText('Showing the last 2 of 5 orders')).toBeInTheDocument();
    await userEvent.click(within(row).getByText('#24117'));
    expect(screen.getByText('ORDER PAGE')).toBeInTheDocument();
  });

  it.each([
    ['Messages', 'No messages yet'],
    ['Calls', 'No calls yet'],
    ['Notes', 'No notes yet'],
  ])('%s shows an empty state until M9', async (tab, title) => {
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: tab }));
    expect(screen.getByText(title)).toBeInTheDocument();
  });

  it('a customer with no orders says so', async () => {
    getCustomerDetail.mockResolvedValue({ ...DETAIL, totalOrders: 0, orders: [] });
    renderPage();
    expect(await screen.findByText('No orders yet')).toBeInTheDocument();
  });
});

describe('Customer detail: actions (F-355, F-356)', () => {
  it('"New order for this customer" goes to /orders?new=1&customerId=', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: /New order for this customer/ });
    expect(link).toHaveAttribute('href', '/orders?new=1&customerId=1');
  });

  it('Edit opens the form with the customer and saves', async () => {
    updateCustomer.mockResolvedValue({ id: 1 });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Edit/ }));
    const dlg = screen.getByRole('dialog', { name: 'Edit customer' });
    expect(within(dlg).getByLabelText('First name')).toHaveValue('Abena');
    expect(within(dlg).getByLabelText('Phone')).toHaveValue('024 555 0182');
    expect(within(dlg).getByLabelText('Region')).toHaveValue('Ashanti');
    await userEvent.clear(within(dlg).getByLabelText(/^Landmark/));
    await userEvent.type(within(dlg).getByLabelText(/^Landmark/), 'By the church');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateCustomer).toHaveBeenCalledWith(1, expect.objectContaining({ landmark: 'By the church', firstName: 'Abena' })));
    expect(await screen.findByText('Abena Owusu saved')).toBeInTheDocument();
  });

  it('Delete asks first, with the PRD sentence, and goes back to the list', async () => {
    deleteCustomer.mockResolvedValue(undefined);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Delete/ }));
    const dlg = screen.getByRole('alertdialog');
    expect(within(dlg).getByRole('heading', { name: 'Delete Abena Owusu?' })).toBeInTheDocument();
    expect(within(dlg).getByText('Their 5 orders stay. They disappear from the customer list.')).toBeInTheDocument();
    expect(deleteCustomer).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteCustomer).toHaveBeenCalledWith(1));
    expect(await screen.findByText('CUSTOMERS LIST')).toBeInTheDocument();
  });

  it('a customer with an order out for delivery cannot be deleted: the 409 text shows and they stay', async () => {
    const why = 'This customer has an order out for delivery. Delete them after it is delivered or returned.';
    deleteCustomer.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { code: 'CUSTOMER_HAS_ORDER_IN_FLIGHT', message: why } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Delete/ }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(why)).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/customers/1');
  });

  it('a rep without the delete permission sees Edit but not Delete', async () => {
    useAuthStore.setState({ user: { id: 9, role: 'sales_rep' } as never, permissions: { customers: ['view', 'create', 'update'], orders: ['view', 'create'] } });
    renderPage();
    await screen.findByRole('heading', { name: 'Abena Owusu' });
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  });
});
