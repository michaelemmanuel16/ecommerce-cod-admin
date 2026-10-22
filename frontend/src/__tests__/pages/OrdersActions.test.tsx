import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Orders } from '../../pages/Orders';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { COUNTS, ROWS, row } from '../fixtures/ordersList';

const svc = vi.hoisted(() => ({
  listOrders: vi.fn(), getCounts: vi.fn(), exportOrders: vi.fn(), getTransitions: vi.fn(), updateOrderStatus: vi.fn(),
  bulkStatus: vi.fn(), bulkAssign: vi.fn(), assignRep: vi.fn(), assignAgent: vi.fn(), unassignBoth: vi.fn(), bulkDeleteOrders: vi.fn(),
}));
vi.mock('../../services/orders.service', () => ({ ordersService: svc }));
vi.mock('../../services/socket', () => ({ getSocket: () => null }));
vi.mock('../../services/products.service', () => ({ productsService: { getProducts: () => Promise.resolve([]) } }));
vi.mock('../../services/delivery-agents.service', () => ({
  deliveryAgentsService: {
    getDeliveryAgents: () => Promise.resolve([
      { id: '5', name: 'Kofi Appiah', isActive: true, isAvailable: true },
      { id: '6', name: 'Esi Badu', isActive: true, isAvailable: true },
      { id: '7', name: 'Kwesi Amoah', isActive: true, isAvailable: false },
    ]),
  },
}));
vi.mock('../../services/customer-reps.service', () => ({
  customerRepsService: { getCustomerReps: () => Promise.resolve([{ id: '2', name: 'Adwoa Darko', isActive: true }, { id: '3', name: 'Nana Kyei', isActive: true }]) },
}));
vi.mock('../../components/forms/OrderForm', () => ({ OrderForm: () => null }));

const refused = (status: number, data: Record<string, unknown>) =>
  new AxiosError('refused', 'ERR_BAD_REQUEST', undefined, undefined, { status, data } as never);

let rows = ROWS;
const answer = (r = ROWS) => {
  rows = r;
  svc.listOrders.mockImplementation(() => Promise.resolve({ rows, pagination: { page: 1, limit: 25, total: rows.length, pages: 1 } }));
  svc.getCounts.mockResolvedValue(COUNTS);
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/orders']}>
      <ToastProvider>
        <Routes>
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<div>ORDER PAGE</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const pick = async (id: number) => userEvent.click(await screen.findByLabelText(`Select order #${id}`));
const toast = () => screen.getByRole('status');

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset());
  localStorage.clear();
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  useAuthStore.setState({
    user: { id: 1, role: 'admin', firstName: 'Manny', lastName: 'A' } as never,
    permissions: { orders: ['view', 'update', 'assign', 'delete', 'create', 'bulk_import'] },
  });
  answer();
  svc.getTransitions.mockResolvedValue({ status: 'pending_confirmation', normal: ['confirmed', 'cancelled'], forced: ['delivered'] });
});

describe('Orders actions: row status menu (M3-T44, F-313)', () => {
  it('lists the moves from /transitions and runs one that needs no reason', async () => {
    svc.updateOrderStatus.mockResolvedValue({});
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Change status of #24113, now Pending confirmation' }));
    expect(svc.getTransitions).toHaveBeenCalledWith(24113);
    const menu = await screen.findByRole('menu', { name: 'Moves for #24113' });
    expect(await within(menu).findByRole('menuitem', { name: 'Confirmed' })).toBeInTheDocument();
    expect(within(menu).getByText('Outside the normal flow (needs a reason)')).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Confirmed' }));
    await waitFor(() => expect(svc.updateOrderStatus).toHaveBeenCalledWith(24113, 'confirmed', undefined, {}));
    expect(toast()).toHaveTextContent('#24113 is now Confirmed');
  });

  it('the status tag does not open the order', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Change status of #24113/ }));
    expect(screen.queryByText('ORDER PAGE')).toBeNull();
  });

  it('cancel opens the decline reason dialog; a pending order needs a reason', async () => {
    svc.updateOrderStatus.mockResolvedValue({});
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Change status of #24113/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancelled' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move #24113 to Cancelled' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move to Cancelled' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose why the order is cancelled.');
    expect(svc.updateOrderStatus).not.toHaveBeenCalled();
    await userEvent.selectOptions(within(dialog).getByLabelText('Why is it cancelled?'), 'Price too high');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move to Cancelled' }));
    await waitFor(() => expect(svc.updateOrderStatus).toHaveBeenCalledWith(24113, 'cancelled', undefined, { declineReason: 'price_too_high' }));
  });

  it('failed delivery asks the failure reason and the next attempt; "Rescheduled" fills tomorrow', async () => {
    svc.getTransitions.mockResolvedValue({ status: 'out_for_delivery', normal: ['failed_delivery', 'delivered'], forced: [] });
    svc.updateOrderStatus.mockResolvedValue({});
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Change status of #24112/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Failed delivery' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move #24112 to Failed delivery' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move to Failed delivery' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose why the delivery failed.');
    await userEvent.selectOptions(within(dialog).getByLabelText('Why did the delivery fail?'), 'Rescheduled');
    const next = within(dialog).getByLabelText(/Next attempt/) as HTMLInputElement;
    expect(next.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move to Failed delivery' }));
    await waitFor(() => expect(svc.updateOrderStatus).toHaveBeenCalledWith(24112, 'failed_delivery', undefined, { failureReason: 'rescheduled', nextAttemptDate: next.value }));
  });

  it('a forced move needs a written reason of 5 characters', async () => {
    svc.updateOrderStatus.mockResolvedValue({});
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Change status of #24113/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delivered' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move #24113 to Delivered' });
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'oops');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move to Delivered' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('at least 5 characters');
    await userEvent.type(within(dialog).getByLabelText('Reason'), ', fixed by hand');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move to Delivered' }));
    await waitFor(() => expect(svc.updateOrderStatus).toHaveBeenCalledWith(24113, 'delivered', undefined, { force: true, reason: 'oops, fixed by hand' }));
  });

  it('a refused move shows the server sentence', async () => {
    svc.updateOrderStatus.mockRejectedValue(refused(409, { error: 'A pre-dispatch order needs a delivery agent.' }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Change status of #24113/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Confirmed' }));
    await waitFor(() => expect(toast()).toHaveTextContent('A pre-dispatch order needs a delivery agent.'));
  });
});

describe('Orders actions: bulk bar (M3-T44, F-313 to F-315)', () => {
  it('appears with the count and goes away on Clear selection', async () => {
    renderPage();
    await pick(24113);
    await pick(24112);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByText('2 selected')).toBeNull();
  });

  it('Change status offers only the moves the selected orders share', async () => {
    svc.getTransitions.mockImplementation((id: number) =>
      Promise.resolve(id === 24113 ? { status: 'a', normal: ['confirmed', 'cancelled'], forced: [] } : { status: 'b', normal: ['cancelled', 'preparing'], forced: [] }));
    renderPage();
    await pick(24113);
    await pick(24112);
    await userEvent.click(screen.getByRole('button', { name: 'Change status' }));
    const menu = await screen.findByRole('menu', { name: 'Change status' });
    expect(await within(menu).findByRole('menuitem', { name: 'Cancelled' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Confirmed' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Preparing' })).toBeNull();
  });

  it('says so when the selected orders have no move in common', async () => {
    svc.getTransitions.mockImplementation((id: number) =>
      Promise.resolve(id === 24113 ? { status: 'a', normal: ['confirmed'], forced: [] } : { status: 'b', normal: ['preparing'], forced: [] }));
    renderPage();
    await pick(24113);
    await pick(24112);
    await userEvent.click(screen.getByRole('button', { name: 'Change status' }));
    expect(await screen.findByText('These orders have no move in common.')).toBeInTheDocument();
  });

  it('18 moved, 2 could not: the toast text, "Show the 2", and the 2 stay selected', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => row(500 + i));
    answer(twenty);
    svc.getTransitions.mockResolvedValue({ status: 'pending_confirmation', normal: ['confirmed'], forced: [] });
    svc.bulkStatus.mockResolvedValue({
      succeeded: twenty.slice(0, 18).map((r) => r.id),
      failed: [{ id: 518, code: 'INVALID_TRANSITION', message: 'It cannot move to confirmed.' }, { id: 519, code: 'ERROR', message: 'This order could not be changed.' }],
    });
    renderPage();
    await userEvent.click(await screen.findByLabelText('Select all orders on this page'));
    expect(screen.getByText('20 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change status' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Confirmed' }));
    await waitFor(() => expect(svc.bulkStatus).toHaveBeenCalledWith({ orderIds: twenty.map((r) => r.id), status: 'confirmed' }));
    await waitFor(() => expect(toast()).toHaveTextContent('18 orders moved to Confirmed. 2 could not move'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByLabelText('Select order #518')).toBeChecked();
    expect(screen.getByLabelText('Select order #500')).not.toBeChecked();

    await userEvent.click(within(toast()).getByRole('button', { name: 'Show the 2' }));
    expect(screen.getByText('2 orders could not move.')).toBeInTheDocument();
    expect(screen.getByText('#518: It cannot move to confirmed.')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Orders' });
    expect(within(table).getAllByRole('row')).toHaveLength(3); // header + 2
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(within(table).getAllByRole('row').length).toBe(21);
  });

  it('a bulk cancel asks one reason for all', async () => {
    svc.getTransitions.mockResolvedValue({ status: 'pending_confirmation', normal: ['cancelled'], forced: [] });
    svc.bulkStatus.mockResolvedValue({ succeeded: [24113, 24112], failed: [] });
    renderPage();
    await pick(24113);
    await pick(24112);
    await userEvent.click(screen.getByRole('button', { name: 'Change status' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancelled' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move 2 orders to Cancelled' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Why is it cancelled?'), 'Wrong number');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move to Cancelled' }));
    await waitFor(() => expect(svc.bulkStatus).toHaveBeenCalledWith({ orderIds: [24113, 24112], status: 'cancelled', declineReason: 'wrong_number' }));
    await waitFor(() => expect(toast()).toHaveTextContent('Changed 2 orders to Cancelled'));
  });

  it('Delete 3 orders? asks first; Cancel deletes nothing; Delete sends the ids', async () => {
    svc.bulkDeleteOrders.mockResolvedValue({ message: 'ok', deletedCount: 3, deleted: 3, skipped: [] });
    renderPage();
    await pick(24117);
    await pick(24113);
    await pick(24112);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: 'Delete 3 orders?' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('3 orders will be deleted. You cannot undo this.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(svc.bulkDeleteOrders).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(svc.bulkDeleteOrders).toHaveBeenCalledWith([24117, 24113, 24112]));
    await waitFor(() => expect(toast()).toHaveTextContent('Deleted 3 orders'));
  });

  it('orders the rules keep are listed and stay selected', async () => {
    svc.bulkDeleteOrders.mockResolvedValue({ message: 'ok', deletedCount: 1, deleted: 1, skipped: [{ id: 24117, reason: 'A delivered order cannot be deleted.' }] });
    renderPage();
    await pick(24117);
    await pick(24112);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toast()).toHaveTextContent('Deleted 1 order. 1 could not be deleted'));
    expect(screen.getByLabelText('Select order #24117')).toBeChecked();
    await userEvent.click(within(toast()).getByRole('button', { name: 'Show it' }));
    expect(screen.getByText('#24117: A delivered order cannot be deleted.')).toBeInTheDocument();
  });

  it('says "None of these orders can be deleted." when nothing was deleted', async () => {
    svc.bulkDeleteOrders.mockResolvedValue({ message: 'ok', deletedCount: 0, deleted: 0, skipped: [{ id: 24117, reason: 'x' }] });
    renderPage();
    await pick(24117);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toast()).toHaveTextContent('None of these orders can be deleted.'));
  });

  it('bulk assign to a call rep and to a delivery agent', async () => {
    svc.bulkAssign.mockResolvedValue({ succeeded: [24113, 24112], failed: [] });
    renderPage();
    await pick(24113);
    await pick(24112);
    await userEvent.click(screen.getByRole('button', { name: /Assign to call rep/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Adwoa Darko' }));
    await waitFor(() => expect(svc.bulkAssign).toHaveBeenCalledWith({ orderIds: [24113, 24112], confirmBlocked: false, customerRepId: 2 }));
    await waitFor(() => expect(toast()).toHaveTextContent('Adwoa Darko will call 2 orders'));
  });
});

describe('Orders actions: row Assign menu (M3-T44, F-314)', () => {
  const open = async (id: number) => {
    await userEvent.click(await screen.findByRole('button', { name: `Assign order #${id}` }));
    return screen.findByRole('menu', { name: `Assign #${id}` });
  };

  it('opens the menu without opening the order', async () => {
    renderPage();
    const menu = await open(24113);
    expect(screen.queryByText('ORDER PAGE')).toBeNull();
    expect(within(menu).getByText('Call rep')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Nana Kyei' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Unassign both' })).toBeInTheDocument();
  });

  it('picks a call rep', async () => {
    svc.assignRep.mockResolvedValue(undefined);
    renderPage();
    await userEvent.click(within(await open(24113)).getByRole('menuitem', { name: 'Adwoa Darko' }));
    await waitFor(() => expect(svc.assignRep).toHaveBeenCalledWith(24113, 2));
    expect(toast()).toHaveTextContent('Adwoa Darko will call 1 order');
  });

  it('an agent marked unavailable shows "Not available today" and cannot be picked', async () => {
    renderPage();
    const menu = await open(24113);
    const item = within(menu).getByRole('menuitem', { name: /Kwesi Amoah/ });
    expect(item).toBeDisabled();
    expect(item).toHaveTextContent('Not available today');
  });

  it('a partner blocked for unpaid cash needs a confirm, then is assigned', async () => {
    svc.assignAgent.mockRejectedValueOnce(refused(409, { code: 'PARTNER_BLOCKED', error: 'Kofi Appiah is blocked for unpaid cash' })).mockResolvedValue(undefined);
    renderPage();
    await userEvent.click(within(await open(24113)).getByRole('menuitem', { name: 'Kofi Appiah' }));
    const dialog = await screen.findByRole('dialog', { name: 'Blocked for unpaid cash' });
    expect(dialog).toHaveTextContent('Kofi Appiah is blocked for unpaid cash');
    expect(svc.assignAgent).toHaveBeenLastCalledWith(24113, 5, false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign anyway' }));
    await waitFor(() => expect(svc.assignAgent).toHaveBeenLastCalledWith(24113, 5, true));
    await waitFor(() => expect(toast()).toHaveTextContent('Kofi Appiah will deliver 1 order'));
  });

  it('Unassign both clears the two', async () => {
    svc.unassignBoth.mockResolvedValue(undefined);
    renderPage();
    await userEvent.click(within(await open(24117)).getByRole('menuitem', { name: 'Unassign both' }));
    await waitFor(() => expect(svc.unassignBoth).toHaveBeenCalledWith(24117));
    expect(toast()).toHaveTextContent('Unassigned 1 order');
  });

  it('an order out for delivery asks before it changes hands', async () => {
    answer([row(900, { status: 'out_for_delivery', deliveryAgent: { id: 5, firstName: 'Kofi', lastName: 'Appiah' } })]);
    svc.assignAgent.mockResolvedValue(undefined);
    renderPage();
    await userEvent.click(within(await open(900)).getByRole('menuitem', { name: /Esi Badu/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Change the delivery agent?' });
    expect(dialog).toHaveTextContent('This order is with Kofi Appiah. Move it to Esi Badu?');
    expect(svc.assignAgent).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move it' }));
    await waitFor(() => expect(svc.assignAgent).toHaveBeenCalledWith(900, 6, false));
  });

  it('a closed order cannot change its delivery agent', async () => {
    answer([row(901, { status: 'delivered' })]);
    renderPage();
    const menu = await open(901);
    expect(within(menu).getByText(/This order is closed/)).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Esi Badu' })).toBeDisabled();
  });

  it('Delete order shows only for orders the rules allow, and asks first', async () => {
    svc.bulkDeleteOrders.mockResolvedValue({ message: 'ok', deletedCount: 1, deleted: 1, skipped: [] });
    renderPage();
    await userEvent.click(within(await open(24113)).getByRole('menuitem', { name: 'Delete order' }));
    expect(screen.getByRole('heading', { name: 'Delete 1 order?' })).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(svc.bulkDeleteOrders).toHaveBeenCalledWith([24113]));
  });

  it('hides Assign and Delete from a person without those permissions', async () => {
    useAuthStore.setState({ permissions: { orders: ['view', 'update'] } });
    renderPage();
    await screen.findByText('#24113');
    expect(screen.queryByRole('button', { name: /Assign order/ })).toBeNull();
    await pick(24113);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Assign to call rep/ })).toBeNull();
  });
});
