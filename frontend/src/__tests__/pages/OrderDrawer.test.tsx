import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OrderDrawer } from '../../pages/orders/drawer/OrderDrawer';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { DETAIL, TIMELINE } from '../fixtures/orderDetail';

const getOrderDetail = vi.fn();
const getTimeline = vi.fn();
const editOrder = vi.fn();
const createCall = vi.fn();
vi.mock('../../services/orders.service', () => ({
  ordersService: {
    getOrderDetail: (...a: unknown[]) => getOrderDetail(...a),
    getTimeline: (...a: unknown[]) => getTimeline(...a),
    editOrder: (...a: unknown[]) => editOrder(...a),
    updateOrderStatus: vi.fn(),
  },
}));
vi.mock('../../services/calls.service', () => ({ callsService: { createCall: (...a: unknown[]) => createCall(...a) } }));
vi.mock('../../services/products.service', () => ({ productsService: { getProducts: () => Promise.resolve([{ id: 1, name: 'Copybook set', isActive: true }, { id: 2, name: 'Refill pens', isActive: true }]) } }));
vi.mock('../../services/delivery-agents.service', () => ({ deliveryAgentsService: { getDeliveryAgents: () => Promise.resolve([{ id: '5', name: 'Kofi Appiah', isActive: true, isAvailable: true }]) } }));
vi.mock('../../services/customer-reps.service', () => ({ customerRepsService: { getCustomerReps: () => Promise.resolve([{ id: '2', name: 'Adwoa Darko', isActive: true, isAvailable: true }]) } }));

const axiosError = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error('request failed'), { isAxiosError: true, response: { status, data } });

function renderDrawer(onClose = vi.fn(), id: number | null = 24118) {
  render(
    <MemoryRouter>
      <ToastProvider>
        <OrderDrawer id={id} onClose={onClose} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return onClose;
}

beforeEach(() => {
  getOrderDetail.mockReset().mockResolvedValue(DETAIL);
  getTimeline.mockReset().mockResolvedValue(TIMELINE);
  editOrder.mockReset().mockResolvedValue(undefined);
  createCall.mockReset().mockResolvedValue({});
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  useAuthStore.setState({ user: { id: 1, role: 'admin', firstName: 'Manny', lastName: 'A' } as never, permissions: { orders: ['view', 'update', 'assign'] } });
});

const openEdit = async () => {
  const user = userEvent.setup();
  await screen.findByText('Order status');
  await user.click(await screen.findByRole('button', { name: /Edit/ }));
  return user;
};

describe('Order drawer: an order the person cannot open (QA-02)', () => {
  it.each([404, 403])('shows one no-access state for HTTP %i and a way back', async (status) => {
    getOrderDetail.mockRejectedValue(axiosError(status, { error: 'Order not found' }));
    const onClose = renderDrawer();
    expect(await screen.findByText('You have no access to this order, or it does not exist.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back to orders' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Order drawer: frame and blocks (M3-T46, F-321)', () => {
  it('shows the number, the date and source line, the payment tag and the blocks in order', async () => {
    renderDrawer();
    expect(await screen.findByRole('heading', { name: '#24118' })).toBeInTheDocument();
    expect(await screen.findByText(/17 Oct, 14:02 · Checkout form: Magic Groove copybook set/)).toBeInTheDocument();
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getAllByText('Pay on delivery').length).toBeGreaterThan(0);
    const heads = within(dlg).getAllByRole('heading', { level: 4 }).map((h) => h.textContent?.replace(/\s*\(\d+\)/, '').replace(/Log call|Unassign both/, '').trim());
    expect(heads).toEqual(['Items', 'Customer', 'Payment', 'Assigned to', 'Timeline', 'Call history', 'Messages', 'Team notes']);
  });

  it('the status menu offers the normal moves and, apart, the forced ones', async () => {
    renderDrawer();
    const select = (await screen.findByLabelText('Order status')) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Pending confirmation', 'Confirmed', 'Cancelled', 'Delivered']);
    expect(select.querySelector('optgroup')?.getAttribute('label')).toMatch(/Outside the normal flow/);
  });

  it('shows the empty states for calls, messages and team notes', async () => {
    getOrderDetail.mockResolvedValue({ ...DETAIL, calls: [] });
    renderDrawer();
    expect(await screen.findByText('No calls yet. Log the first one.')).toBeInTheDocument();
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
    expect(screen.getByText(/No notes yet/)).toBeInTheDocument();
  });

  it('Escape closes it, and so does the Close button', async () => {
    const onClose = renderDrawer();
    const user = userEvent.setup();
    await screen.findByText('Order status');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    const [header, footer] = screen.getAllByRole('button', { name: 'Close' });
    await user.click(footer);
    expect(onClose).toHaveBeenCalledTimes(2);
    await user.click(header);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('a deleted order shows the server message', async () => {
    getOrderDetail.mockRejectedValue(axiosError(404, { message: 'This order was deleted.' }));
    renderDrawer();
    expect(await screen.findByText('This order was deleted.')).toBeInTheDocument();
  });

  it('logs a call from the inline form', async () => {
    renderDrawer();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Log call/ }));
    await user.selectOptions(screen.getByLabelText('Outcome'), 'no_answer');
    await user.type(screen.getByLabelText('Note'), 'Phone off');
    await user.click(screen.getByRole('button', { name: 'Save call' }));
    await waitFor(() => expect(createCall).toHaveBeenCalledWith({ customerId: 7, orderId: 24118, outcome: 'no_answer', notes: 'Phone off' }));
  });
});

describe('Order drawer: edit mode (M3-T47, F-318)', () => {
  it('saves a changed address with the updatedAt it read, and only that field', async () => {
    renderDrawer();
    const user = await openEdit();
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    const addr = screen.getByLabelText('Delivery address');
    await user.clear(addr);
    await user.type(addr, '9 New Road');
    await user.click(save);
    await waitFor(() => expect(editOrder).toHaveBeenCalledWith(24118, { deliveryAddress: '9 New Road', updatedAt: DETAIL.updatedAt }));
  });

  it('on a delivered order only the notes are open', async () => {
    getOrderDetail.mockResolvedValue({ ...DETAIL, status: 'delivered', transitions: { status: 'delivered', normal: [], forced: [] } });
    renderDrawer();
    await openEdit();
    expect(screen.getByLabelText('Notes')).toBeEnabled();
    expect(screen.getByLabelText('Delivery address')).toBeDisabled();
    expect(screen.getByLabelText('Phone')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Add product line/ })).toBeNull();
  });

  it('a save refused as stale shows "This order changed. Reload to see the new data."', async () => {
    editOrder.mockRejectedValue(axiosError(409, { code: 'STALE_ORDER', message: 'This order changed. Reload to see the new data.' }));
    renderDrawer();
    const user = await openEdit();
    await user.type(screen.getByLabelText('Notes'), 'Gate is blue');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This order changed. Reload to see the new data.');
    getOrderDetail.mockClear();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(getOrderDetail).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closing with unsaved edits asks "Discard changes?"; Keep editing stays, Discard closes', async () => {
    const onClose = renderDrawer();
    const user = await openEdit();
    await user.type(screen.getByLabelText('Notes'), 'x');
    await user.keyboard('{Escape}');
    const ask = await screen.findByRole('dialog', { name: 'Discard changes?' });
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(ask).getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await user.click(within(await screen.findByRole('dialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a total change on a confirmed order needs the confirm tick', async () => {
    getOrderDetail.mockResolvedValue({ ...DETAIL, status: 'confirmed', transitions: { status: 'confirmed', normal: [], forced: [] } });
    renderDrawer();
    const user = await openEdit();
    const qty = screen.getByLabelText('Qty');
    await user.clear(qty);
    await user.type(qty, '2');
    expect(screen.getByText(/The customer confirmed GH₵249\. The new total is GH₵498\./)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(save);
    await waitFor(() => expect(editOrder).toHaveBeenCalledWith(24118, expect.objectContaining({ confirmTotalChange: true, orderItems: [{ productId: 1, quantity: 2, unitPrice: 249 }] })));
  });

  it('a phone that belongs to another customer is blocked with that name and a link', async () => {
    editOrder.mockRejectedValue(axiosError(409, { code: 'PHONE_BELONGS_TO_OTHER_CUSTOMER', message: 'This number belongs to Kojo Agyeman', customerName: 'Kojo Agyeman', customerId: 11 }));
    renderDrawer();
    const user = await openEdit();
    const phone = screen.getByLabelText('Phone');
    await user.clear(phone);
    await user.type(phone, '0245550301');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dlg = await screen.findByRole('dialog', { name: 'This number belongs to Kojo Agyeman' });
    expect(within(dlg).getByRole('link', { name: 'Kojo Agyeman' })).toHaveAttribute('href', '/customers/11');
  });

  it('a phone change for a customer with other orders asks, and Yes saves with confirmPhoneChange', async () => {
    editOrder.mockRejectedValueOnce(axiosError(409, { code: 'PHONE_CHANGE_NEEDS_CONFIRMATION', message: "Update the number for all of this customer's orders?", otherOrders: 2 }));
    renderDrawer();
    const user = await openEdit();
    const phone = screen.getByLabelText('Phone');
    await user.clear(phone);
    await user.type(phone, '0245550303');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const ask = await screen.findByRole('dialog', { name: "Update the number for all of this customer's orders?" });
    await user.click(within(ask).getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(editOrder).toHaveBeenLastCalledWith(24118, expect.objectContaining({ customerPhone: '0245550303', confirmPhoneChange: true })));
  });

  it('a delivery agent sees no Edit button', async () => {
    useAuthStore.setState({ user: { id: 9, role: 'delivery_agent', firstName: 'Kofi', lastName: 'A' } as never, permissions: { orders: ['view', 'update'] } });
    renderDrawer();
    await screen.findByText('Order status');
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
  });
});
