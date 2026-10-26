import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PartnerDrawer } from '../../pages/deliveries/PartnerDrawer';
import { ToastProvider } from '../../components/ui-v2';
import { useConfigStore } from '../../stores/configStore';
import type { PartnerDetail } from '../../services/delivery-partners.service';
import { PARTNERS } from '../fixtures/deliveriesList';

const get = vi.fn();
const update = vi.fn();
const setAvailability = vi.fn();
const orderProof = vi.fn();
const orderProofs = vi.fn();
const listOrders = vi.fn();
const stockLevels = vi.fn();
vi.mock('../../services/delivery-partners.service', async (orig) => ({
  ...(await orig<typeof import('../../services/delivery-partners.service')>()),
  deliveryPartnersService: {
    get: (...a: unknown[]) => get(...a),
    update: (...a: unknown[]) => update(...a),
    setAvailability: (...a: unknown[]) => setAvailability(...a),
    orderProof: (...a: unknown[]) => orderProof(...a),
    orderProofs: (...a: unknown[]) => orderProofs(...a),
    stockLevels: (...a: unknown[]) => stockLevels(...a),
  },
}));
vi.mock('../../services/orders.service', () => ({ ordersService: { listOrders: (...a: unknown[]) => listOrders(...a) } }));

const KOFI: PartnerDetail = {
  id: 2, name: 'Kofi Appiah', firstName: 'Kofi', lastName: 'Appiah', email: 'kofi@x.test', phoneNumber: '0244000000', kind: 'person', type: 'agent',
  isActive: true, isAvailable: true, vehicleType: 'Motorbike', vehicleId: null,
  profile: { daysToPay: 2, isTrial: false, dataSource: 'app', baseTown: 'Kumasi' },
  stockLocation: { id: 9, name: 'Kofi Appiah', type: 'agent', isActive: true },
  feeRule: { delivered: '25.00', failed: '5.00', returned: null },
};

const ORDER = {
  id: 24117, status: 'delivered', totalAmount: '249.00', createdAt: '2026-10-17T10:00:00Z',
  customer: { id: 1, firstName: 'Abena', lastName: 'Owusu', phoneNumber: '0241' }, customerRep: null, deliveryAgent: null, orderItems: [],
};

const onChanged = vi.fn();
function open(props: Partial<React.ComponentProps<typeof PartnerDrawer>> = {}) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PartnerDrawer id={2} row={PARTNERS[1]} target={60} canEdit canSwitch onClose={vi.fn()} onChanged={onChanged} {...props} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  [get, update, setAvailability, orderProof, orderProofs, listOrders, stockLevels, onChanged].forEach((m) => m.mockReset());
  get.mockResolvedValue(KOFI);
  update.mockImplementation((_id: number, patch: { daysToPay: number }) => Promise.resolve({ ...KOFI, profile: { ...KOFI.profile, daysToPay: patch.daysToPay } }));
  setAvailability.mockResolvedValue(undefined);
  stockLevels.mockResolvedValue([
    { locationId: 9, productId: 1, productName: 'Copybook set', sku: 'MG-COPYBOOK-SET', onHand: 20, reserved: 21, inTransit: 0 },
    { locationId: 9, productId: 2, productName: 'Magic pens', sku: 'MG-REFILL-PENS', onHand: 5, reserved: 0, inTransit: 3 },
  ]);
  listOrders.mockResolvedValue({ rows: [ORDER], pagination: { page: 1, limit: 10, total: 1, pages: 1 } });
  orderProofs.mockResolvedValue([{ orderId: 24117, photoUrl: '/api/deliveries/proof-photo/1?sig=x', attemptCount: 1 }]);
  orderProof.mockResolvedValue({
    proof: { recorded: true, proofType: 'photo', recipientName: 'Abena Owusu', time: '2026-10-17T09:56:00Z', cashCollected: '289.00', photoUrl: '/api/deliveries/proof-photo/1?sig=x' },
    attempts: [{ id: 1, attemptedAt: '2026-10-16T09:00:00Z', reason: 'not_reachable', note: null, partner: { id: 2, name: 'Kofi Appiah' } }],
  });
  useConfigStore.setState({ currency: 'GHS', loaded: true });
});

describe('Partner drawer (M4-T32)', () => {
  it('Summary shows the row figures and the person', async () => {
    open();
    expect(await screen.findByText('Kofi Appiah', { selector: 'h2' })).toBeInTheDocument();
    expect(await screen.findByText('kofi@x.test')).toBeInTheDocument();
    expect(screen.getByText('172')).toBeInTheDocument();
    expect(screen.getByText('Agent', { selector: '.dtags .tag' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit person/ })).toBeInTheDocument();
  });

  it('Orders tab shows the proof photo and the attempt count of a delivered order', async () => {
    open();
    await userEvent.click(await screen.findByRole('tab', { name: 'Orders' }));
    const list = await screen.findByRole('list', { name: 'Orders of this partner' });
    expect(await within(list).findByRole('button', { name: 'Open the delivery proof photo' })).toBeInTheDocument();
    expect(within(list).getByRole('img', { name: 'Delivery proof' })).toHaveAttribute('src', expect.stringContaining('/api/deliveries/proof-photo/1'));
    expect(orderProofs).toHaveBeenCalledTimes(1);
    expect(orderProofs).toHaveBeenCalledWith(2, [24117]);
    expect(orderProof).not.toHaveBeenCalled(); // the detail loads when the row opens
    await userEvent.click(within(list).getByRole('button', { name: '1 attempt' }));
    expect(await within(list).findByText(/Not reachable/)).toBeInTheDocument();
    expect(within(list).getByText('Recipient', { exact: false })).toBeInTheDocument();
  });

  it('Fees tab: the fee rule is read-only, a save sends the profile fields', async () => {
    open();
    await userEvent.click(await screen.findByRole('tab', { name: 'Fees' }));
    expect(await screen.findByText('Per delivered')).toBeInTheDocument();
    expect(screen.getByText('GH₵25')).toBeInTheDocument();
    const days = screen.getByLabelText('Days to pay');
    await userEvent.clear(days);
    await userEvent.type(days, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(2, expect.objectContaining({ daysToPay: 5, dataSource: 'app', isTrial: false, vehicleType: 'Motorbike' })));
    expect(onChanged).toHaveBeenCalled();
  });

  it('refuses days to pay that is not a whole number from 0 to 365', async () => {
    open();
    await userEvent.click(await screen.findByRole('tab', { name: 'Fees' }));
    const days = await screen.findByLabelText('Days to pay');
    await userEvent.clear(days);
    await userEvent.type(days, '400');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Days to pay must be a whole number from 0 to 365')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('a manager cannot edit: no Edit person, no Save, fields disabled', async () => {
    open({ canEdit: false });
    await userEvent.click(await screen.findByRole('tab', { name: 'Fees' }));
    expect(await screen.findByLabelText('Days to pay')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit person/ })).not.toBeInTheDocument();
  });

  it('the availability switch calls the API and tells the page', async () => {
    open();
    const sw = await screen.findByRole('switch', { name: /Kofi Appiah available for new orders/ });
    await userEvent.click(sw);
    await waitFor(() => expect(setAvailability).toHaveBeenCalledWith(2, false));
    expect(onChanged).toHaveBeenCalled();
  });

  it('Stock tab sums the partner location and links to Inventory for it', async () => {
    open();
    await userEvent.click(await screen.findByRole('tab', { name: 'Stock' }));
    expect(await screen.findByLabelText('Stock at Kofi Appiah')).toHaveTextContent('Copybook set');
    expect(stockLevels).toHaveBeenCalledWith(9);
    const figs = document.querySelector('.dstock .dfig') as HTMLElement;
    expect(figs).toHaveTextContent('On hand25');
    expect(figs).toHaveTextContent('Reserved21');
    expect(figs).toHaveTextContent('In transit to them3');
    expect(screen.getByRole('link', { name: 'See Kofi Appiah in Inventory' })).toHaveAttribute('href', '/inventory?location=9');
  });

  it('Stock tab says so when the role may not read stock (403)', async () => {
    stockLevels.mockResolvedValue(null);
    open();
    await userEvent.click(await screen.findByRole('tab', { name: 'Stock' }));
    expect(await screen.findByText('Stock figures are not shown to your role.')).toBeInTheDocument();
  });

  it('Stock tab shows an error when the call fails for another reason', async () => {
    stockLevels.mockRejectedValue(new Error('500'));
    open();
    await userEvent.click(await screen.findByRole('tab', { name: 'Stock' }));
    expect(await screen.findByText('The stock could not load.')).toBeInTheDocument();
  });

  it('the Orders tab keeps its rows when the user visits another tab and comes back', async () => {
    open();
    await userEvent.click(await screen.findByRole('tab', { name: 'Orders' }));
    await screen.findByRole('list', { name: 'Orders of this partner' });
    await userEvent.click(screen.getByRole('tab', { name: 'Fees' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Orders' }));
    expect(await screen.findByRole('list', { name: 'Orders of this partner' })).toBeInTheDocument();
    expect(listOrders).toHaveBeenCalledTimes(2); // the Summary tab list, then the Orders tab once
    expect(orderProofs).toHaveBeenCalledTimes(1);
  });
});
