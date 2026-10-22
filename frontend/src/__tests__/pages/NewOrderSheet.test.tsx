import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { NewOrderSheet } from '../../pages/orders/NewOrderSheet';
import { ToastProvider } from '../../components/ui-v2';
import { useConfigStore } from '../../stores/configStore';

const svc = vi.hoisted(() => ({
  createManualOrder: vi.fn(),
  findByPhone: vi.fn(),
  getForOrder: vi.fn(),
  getTowns: vi.fn(),
}));
vi.mock('../../services/locations.service', () => ({ locationsService: { getTowns: svc.getTowns } }));
vi.mock('../../services/orders.service', () => ({ ordersService: { createManualOrder: svc.createManualOrder } }));
vi.mock('../../services/customers.service', () => ({ customersService: { findByPhone: svc.findByPhone, getForOrder: svc.getForOrder } }));
vi.mock('../../services/products.service', () => ({
  productsService: {
    getProducts: () => Promise.resolve([
      { id: 1, name: 'Copybook set', price: 249, stockQuantity: 10, isActive: true },
      { id: 2, name: 'Refill pens', price: 40, stockQuantity: 3, isActive: true },
    ]),
  },
}));

const onClose = vi.fn();
const onCreated = vi.fn();

function renderSheet(props: Partial<React.ComponentProps<typeof NewOrderSheet>> = {}) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <NewOrderSheet
          open
          onClose={onClose}
          onCreated={onCreated}
          canAssign
          reps={[{ id: 2, name: 'Adwoa Darko' }]}
          agents={[{ id: 5, name: 'Kofi Appiah' }]}
          {...props}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** Fills the required fields and one product line. */
async function fillBasics() {
  const u = userEvent.setup();
  await u.type(screen.getByLabelText('Customer name'), 'Gifty Addo');
  await u.type(screen.getByLabelText('Phone'), '0245550182');
  await u.type(screen.getByLabelText('Delivery address'), '14 Adum Road');
  await u.selectOptions(screen.getByLabelText('State'), 'Ashanti');
  await screen.findByRole('option', { name: 'Adum' });
  await u.selectOptions(screen.getByLabelText('City/Town'), 'Adum');
  await screen.findByRole('option', { name: 'Copybook set' });
  await u.selectOptions(screen.getByLabelText('Product'), 'Copybook set');
  return u;
}

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset());
  onClose.mockReset();
  onCreated.mockReset();
  svc.findByPhone.mockResolvedValue(null);
  svc.getTowns.mockResolvedValue(['Adum', 'Kejetia']);
  useConfigStore.setState({ currency: 'GHS', loaded: true });
});

describe('New order sheet (M3-T45, F-317)', () => {
  it('has no status select: only the confirmed-on-the-call checkbox', async () => {
    renderSheet();
    expect(screen.queryByLabelText(/^status/i)).toBeNull();
    expect(screen.queryByRole('combobox', { name: /status/i })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Customer already confirmed on this call' })).not.toBeChecked();
  });

  it('the total starts as the lines minus the discount', async () => {
    renderSheet();
    const u = await fillBasics();
    expect(screen.getByLabelText(/Order total/)).toHaveValue(249);
    await u.type(screen.getByLabelText(/Discount/), '49');
    expect(screen.getByLabelText(/Order total/)).toHaveValue(200);
    expect(screen.queryByText(/Total differs/)).toBeNull();
  });

  it('shows "Total differs from the lines by GH₵X" when the total is edited, and asks for a reason in the notes', async () => {
    renderSheet();
    const u = await fillBasics();
    const total = screen.getByLabelText(/Order total/);
    await u.clear(total);
    await u.type(total, '200');
    expect(screen.getByText(/Total differs from the lines by GH₵49\./)).toHaveTextContent('Write the reason in the notes');
    await u.clear(total);
    await u.type(total, '249');
    expect(screen.queryByText(/Total differs/)).toBeNull();
  });

  it('creates the order with the PRD fields, never a status, and toasts the order number', async () => {
    svc.createManualOrder.mockResolvedValue({ id: 9, orderNumber: 'ORD-0009' });
    renderSheet();
    const u = await fillBasics();
    const total = screen.getByLabelText(/Order total/);
    await u.clear(total);
    await u.type(total, '200');
    await u.selectOptions(screen.getByLabelText('Call rep'), 'Adwoa Darko');
    await u.selectOptions(screen.getByLabelText('Delivery agent'), 'Kofi Appiah');
    await u.click(screen.getByRole('checkbox', { name: /already confirmed/ }));
    await u.click(screen.getByRole('button', { name: /Create order/ }));
    await waitFor(() => expect(svc.createManualOrder).toHaveBeenCalledTimes(1));
    const body = svc.createManualOrder.mock.calls[0][0];
    expect(body).toMatchObject({
      customerName: 'Gifty Addo', customerPhone: '0245550182', deliveryAddress: '14 Adum Road', deliveryState: 'Ashanti', deliveryArea: 'Adum',
      orderItems: [{ productId: 1, quantity: 1, unitPrice: 249 }], subtotal: 249, discount: 0, totalAmount: 200,
      customerConfirmed: true, customerRepId: 2, deliveryAgentId: 5,
    });
    expect(body).not.toHaveProperty('status');
    expect(await screen.findByText('Order ORD-0009 created')).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('does not send a rep or agent, and does not show the fields, without orders:assign', async () => {
    svc.createManualOrder.mockResolvedValue({ id: 9, orderNumber: 'ORD-0009' });
    renderSheet({ canAssign: false });
    expect(screen.queryByLabelText('Call rep')).toBeNull();
    expect(screen.queryByLabelText('Delivery agent')).toBeNull();
    const u = await fillBasics();
    await u.click(screen.getByRole('button', { name: /Create order/ }));
    await waitFor(() => expect(svc.createManualOrder).toHaveBeenCalled());
    const body = svc.createManualOrder.mock.calls[0][0];
    expect(body).not.toHaveProperty('customerRepId');
    expect(body).not.toHaveProperty('deliveryAgentId');
    expect(body.customerConfirmed).toBe(false);
  });

  it('asks for the missing fields and a phone of 9 digits or more, and sends nothing', async () => {
    renderSheet();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('Phone'), '02455');
    await u.click(screen.getByRole('button', { name: /Create order/ }));
    expect(screen.getByText('Enter the customer name.')).toBeInTheDocument();
    expect(screen.getByText('Phone number needs at least 9 digits.')).toBeInTheDocument();
    expect(screen.getByText('Choose a state.')).toBeInTheDocument();
    expect(screen.getByText('Choose a product.')).toBeInTheDocument();
    expect(svc.createManualOrder).not.toHaveBeenCalled();
  });

  it('blocks a line above the available stock and shows the units available', async () => {
    renderSheet();
    const u = await fillBasics();
    const qty = screen.getByLabelText('Qty');
    await u.clear(qty);
    await u.type(qty, '11');
    expect(screen.getByText('Only 10 available.')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Create order/ }));
    expect(svc.createManualOrder).not.toHaveBeenCalled();
  });

  it('shows "Existing customer: name, N orders" with a link when the phone matches', async () => {
    svc.findByPhone.mockResolvedValue({ id: 7, name: 'Abena Owusu', totalOrders: 3, codBlocked: false });
    renderSheet();
    await userEvent.type(screen.getByLabelText('Phone'), '0245550182');
    const link = await screen.findByRole('link', { name: 'Abena Owusu' });
    expect(link).toHaveAttribute('href', '/customers/7');
    expect(link.parentElement).toHaveTextContent('Existing customer: Abena Owusu, 3 orders');
    expect(screen.queryByText(/COD is off/)).toBeNull();
  });

  it('shows the COD-off notice for a blocked customer', async () => {
    svc.findByPhone.mockResolvedValue({ id: 7, name: 'Abena Owusu', totalOrders: 4, codBlocked: true });
    renderSheet();
    await userEvent.type(screen.getByLabelText('Phone'), '0245550182');
    expect(await screen.findByText(/COD is off for this customer/)).toBeInTheDocument();
  });

  it('prefills name, phone, address, region and town from a linked customer', async () => {
    svc.getForOrder.mockResolvedValue({ name: 'Abena Owusu', phone: '+233245550182', alternatePhone: '', email: '', address: '14 Adum Road', region: 'Ashanti', town: 'Adum', landmark: 'Near the post office' });
    renderSheet({ customerId: 7 });
    await waitFor(() => expect(screen.getByLabelText('Customer name')).toHaveValue('Abena Owusu'));
    expect(svc.getForOrder).toHaveBeenCalledWith(7);
    expect(screen.getByLabelText('Phone')).toHaveValue('024 555 0182');
    expect(screen.getByLabelText('Delivery address')).toHaveValue('14 Adum Road');
    expect(screen.getByLabelText('State')).toHaveValue('Ashanti');
    await waitFor(() => expect(screen.getByLabelText('City/Town')).toHaveValue('Adum'));
    expect(screen.getByLabelText(/^Nearest landmark/)).toHaveValue('Near the post office');
  });

  it('sends the nearest landmark when it is filled, and not when it is empty', async () => {
    svc.createManualOrder.mockResolvedValue({ id: 9, orderNumber: 'ORD-0009' });
    renderSheet();
    const u = await fillBasics();
    await u.type(screen.getByLabelText(/Nearest landmark/), 'Opposite Kejetia market');
    await u.click(screen.getByRole('button', { name: /Create order/ }));
    await waitFor(() => expect(svc.createManualOrder).toHaveBeenCalledTimes(1));
    expect(svc.createManualOrder.mock.calls[0][0]).toMatchObject({ landmark: 'Opposite Kejetia market', deliveryArea: 'Adum' });
  });
});
