import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShipmentModal } from '../../pages/products/ShipmentModal';
import { ReceiveModal } from '../../pages/products/ReceiveModal';
import { ClaimModal } from '../../pages/products/ClaimModal';
import { ShipmentsPane } from '../../pages/products/ShipmentsPane';
import { ToastProvider } from '../../components/ui-v2';
import { useConfigStore } from '../../stores/configStore';
import { FOREIGN, PENDING, RECEIVED, SHIP_SUMMARY, PRODUCT_LIST } from '../fixtures/productsPage';

const create = vi.fn();
const update = vi.fn();
const receive = vi.fn();
const claim = vi.fn();
const remove = vi.fn();
const listShipments = vi.fn();
vi.mock('../../services/shipments.service', async (orig) => ({
  ...(await orig<typeof import('../../services/shipments.service')>()),
  shipmentsService: {
    list: (...a: unknown[]) => listShipments(...a),
    summary: vi.fn(async () => SHIP_SUMMARY),
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
    receive: (...a: unknown[]) => receive(...a),
    claim: (...a: unknown[]) => claim(...a),
    remove: (...a: unknown[]) => remove(...a),
  },
}));
vi.mock('../../services/products.service', async (orig) => ({
  ...(await orig<typeof import('../../services/products.service')>()),
  productsService: {
    list: vi.fn(async () => PRODUCT_LIST),
    stockLocations: vi.fn(async () => [{ id: 5, name: 'Own store', type: 'own_store' }, { id: 10, name: 'Logiswift', type: 'partner_3pl' }]),
  },
}));

const wrap = (ui: React.ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  [create, update, receive, claim, remove, listShipments].forEach((m) => m.mockReset());
  listShipments.mockResolvedValue([PENDING, FOREIGN, RECEIVED]);
  create.mockResolvedValue(PENDING);
  update.mockResolvedValue(PENDING);
  receive.mockResolvedValue(RECEIVED);
  claim.mockResolvedValue({ ...RECEIVED, claimStatus: 'settled', claimRecovered: 300, claimJournalEntryId: 42 });
  remove.mockResolvedValue(undefined);
  useConfigStore.setState({ currency: 'GHS', loaded: true });
});

describe('Shipment modal (M4-T23)', () => {
  it('shows the landed cost per unit live: 8,700 over 300 is 29', async () => {
    wrap(<ShipmentModal open shipment={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Product')).toHaveValue('1'));
    await userEvent.type(screen.getByLabelText('Quantity'), '300');
    await userEvent.type(screen.getByLabelText(/^Unit cost/), '27');
    await userEvent.clear(screen.getByLabelText(/^Shipping/));
    await userEvent.type(screen.getByLabelText(/^Shipping/), '450');
    await userEvent.clear(screen.getByLabelText(/^Other costs/));
    await userEvent.type(screen.getByLabelText(/^Other costs/), '150');
    expect(screen.getByTestId('live-landed')).toHaveTextContent('GH₵29');
    expect(screen.queryByTestId('rate-line')).not.toBeInTheDocument();
  });

  it('a foreign currency shows the rate line: a typed rate converts the total', async () => {
    wrap(<ShipmentModal open shipment={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Product')).toHaveValue('1'));
    await userEvent.type(screen.getByLabelText('Quantity'), '100');
    await userEvent.clear(screen.getByLabelText('Currency'));
    await userEvent.type(screen.getByLabelText('Currency'), 'cny');
    await userEvent.type(screen.getByLabelText(/^Unit cost/), '10');
    expect(screen.getByTestId('rate-line')).toHaveTextContent('The stored rate of the day');
    expect(screen.getByTestId('live-landed')).toHaveTextContent('¥10'); // still in CNY until a rate is known
    await userEvent.type(screen.getByLabelText(/^Rate/), '1.6');
    expect(screen.getByTestId('rate-line')).toHaveTextContent('Typed rate: 1 CNY = 1.6 GHS. Total GH₵1,600.');
    expect(screen.getByTestId('live-landed')).toHaveTextContent('GH₵16');
    await userEvent.click(screen.getByRole('button', { name: /Save shipment/ }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ productId: 1, quantity: 100, currency: 'CNY', unitCost: 10, fxRate: 1.6 });
  });

  it('editing a foreign shipment shows its stored rate', async () => {
    wrap(<ShipmentModal open shipment={FOREIGN} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByTestId('rate-line')).toHaveTextContent('Stored rate: 1 CNY = 1.6 GHS. Total GH₵1,600.');
    expect(screen.getByLabelText('Product')).toHaveValue('Magic Groove copybook set');
  });

  it('shows the API message when the rate is missing', async () => {
    const err = Object.assign(new Error('x'), { isAxiosError: true, response: { status: 400, data: { error: 'No exchange rate from JPY to GHS for 2026-10-24. Add a rate in Settings or type one for this shipment.' } } });
    create.mockRejectedValue(err);
    wrap(<ShipmentModal open shipment={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Product')).toHaveValue('1'));
    await userEvent.type(screen.getByLabelText('Quantity'), '5');
    await userEvent.clear(screen.getByLabelText('Currency'));
    await userEvent.type(screen.getByLabelText('Currency'), 'JPY');
    await userEvent.type(screen.getByLabelText(/^Unit cost/), '100');
    await userEvent.click(screen.getByRole('button', { name: /Save shipment/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No exchange rate from JPY to GHS');
  });
});

describe('Receive modal (M4-T24)', () => {
  it('counted 288 of 300: short 12 live, landed 30.21 live, then saves the receive', async () => {
    const onReceived = vi.fn();
    wrap(<ReceiveModal open shipment={PENDING} onClose={vi.fn()} onReceived={onReceived} />);
    await waitFor(() => expect(screen.getByLabelText('Received at')).toHaveValue('10'));
    expect(screen.getByLabelText('Units shipped')).toHaveAttribute('readonly');
    expect(screen.getByTestId('live-short')).toHaveTextContent('0 units');
    expect(screen.getByTestId('live-landed')).toHaveTextContent('GH₵29');
    await userEvent.clear(screen.getByLabelText('Units counted'));
    await userEvent.type(screen.getByLabelText('Units counted'), '288');
    expect(screen.getByTestId('live-short')).toHaveTextContent('12 units');
    expect(screen.getByTestId('live-landed')).toHaveTextContent('GH₵30.21');
    await userEvent.click(screen.getByRole('button', { name: 'Save and add to stock' }));
    await waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive.mock.calls[0][0]).toBe(7);
    expect(receive.mock.calls[0][1]).toMatchObject({ locationId: 10, quantityCounted: 288, countSource: 'own_count' });
    expect(onReceived).toHaveBeenCalled();
  });

  it('refuses a count above what was shipped', async () => {
    wrap(<ReceiveModal open shipment={PENDING} onClose={vi.fn()} onReceived={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Received at')).toHaveValue('10'));
    await userEvent.clear(screen.getByLabelText('Units counted'));
    await userEvent.type(screen.getByLabelText('Units counted'), '301');
    await userEvent.click(screen.getByRole('button', { name: 'Save and add to stock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('from 0 to 300');
    expect(receive).not.toHaveBeenCalled();
  });

  it('a foreign shipment can take a typed rate', async () => {
    wrap(<ReceiveModal open shipment={FOREIGN} onClose={vi.fn()} onReceived={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Received at')).toHaveValue('10'));
    await userEvent.type(screen.getByLabelText(/^Rate/), '2');
    expect(screen.getByTestId('live-landed')).toHaveTextContent('GH₵20');
    await userEvent.click(screen.getByRole('button', { name: 'Save and add to stock' }));
    await waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive.mock.calls[0][1]).toMatchObject({ fxRate: 2, quantityCounted: 100 });
  });
});

describe('Claim panel (M4-T24)', () => {
  it('open: shows GH₵324 and the ledger entry a settlement will post; settles with the amount recovered', async () => {
    wrap(<ClaimModal open shipment={RECEIVED} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByTestId('claim-amount')).toHaveTextContent('GH₵324');
    expect(screen.getByTestId('ledger-preview')).toHaveTextContent('DR 1010 Cash in hand, CR 1200 Inventory');
    await userEvent.clear(screen.getByLabelText(/Amount recovered/));
    await userEvent.type(screen.getByLabelText(/Amount recovered/), '300');
    expect(screen.getByTestId('ledger-preview')).toHaveTextContent('GH₵300');
    await userEvent.click(screen.getByRole('button', { name: 'Settle claim' }));
    await waitFor(() => expect(claim).toHaveBeenCalledWith(9, { action: 'settle', amountRecovered: 300 }));
  });

  it('refuses more than the claim', async () => {
    wrap(<ClaimModal open shipment={RECEIVED} onClose={vi.fn()} onChanged={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText(/Amount recovered/));
    await userEvent.type(screen.getByLabelText(/Amount recovered/), '400');
    await userEvent.click(screen.getByRole('button', { name: 'Settle claim' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not above GH₵324');
    expect(claim).not.toHaveBeenCalled();
  });

  it('write-off says no ledger entry is posted', async () => {
    wrap(<ClaimModal open shipment={RECEIVED} onClose={vi.fn()} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Write off' }));
    expect(screen.getByTestId('ledger-preview')).toHaveTextContent('No ledger entry is posted');
    await userEvent.type(screen.getByLabelText(/Note/), 'Supplier refused');
    await userEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Write off' }).pop() as HTMLElement);
    await waitFor(() => expect(claim).toHaveBeenCalledWith(9, { action: 'write_off', note: 'Supplier refused' }));
  });

  it('a settled claim is read only and names its ledger entry', () => {
    wrap(<ClaimModal open shipment={{ ...RECEIVED, claimStatus: 'settled', claimRecovered: 300, claimJournalEntryId: 42 }} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByText(/Ledger entry #42/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settle claim' })).not.toBeInTheDocument();
  });
});

describe('Shipments pane (M4-T23)', () => {
  const pane = (filter: 'all' | 'pending' | 'received' = 'all') =>
    wrap(<ShipmentsPane filter={filter} onFilter={vi.fn()} canWrite adding={false} onAddingChange={vi.fn()} onChanged={vi.fn()} />);

  it('a received row is locked: no Edit, no Delete; a pending row has both', async () => {
    pane();
    const table = await screen.findByRole('table', { name: 'Incoming shipments' });
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    const received = Array.from(rows).find((r) => r.textContent?.includes('12 short')) as HTMLElement;
    expect(within(received).queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument();
    expect(within(received).queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
    expect(within(received).getByLabelText('Locked')).toBeInTheDocument();
    expect(within(received).getByRole('button', { name: /Claim GH₵324/ })).toBeInTheDocument();
    const pending = rows[0] as HTMLElement;
    expect(within(pending).getByRole('button', { name: /^Edit/ })).toBeInTheDocument();
    expect(within(pending).getByRole('button', { name: /^Delete/ })).toBeInTheDocument();
  });

  it('a foreign-currency row shows the converted total and the original amount', async () => {
    pane();
    const cell = (await screen.findAllByTestId('original-amount'))[0];
    expect(cell).toHaveTextContent('¥1,000');
    expect(cell.closest('td')).toHaveTextContent('GH₵1,600');
  });

  it('delete asks first, then removes the shipment', async () => {
    pane();
    await userEvent.click((await screen.findAllByRole('button', { name: /^Delete shipment of Magic Groove copybook set/ }))[0]);
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('alertdialog').querySelector('.danger') as HTMLElement);
    await waitFor(() => expect(remove).toHaveBeenCalledWith(7));
  });

  it('shows the three tiles from the summary and the tab counts', async () => {
    pane();
    expect((await screen.findByText('Pending shipments', { selector: '.kpi .l' })).closest('.kpi')).toHaveTextContent('3');
    expect(screen.getByText('Cost to land them', { selector: '.kpi .l' }).closest('.kpi')).toHaveTextContent('GH₵24,950');
    expect(await screen.findByRole('tab', { name: /Pending/ })).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /Received/ })).toHaveTextContent('1');
  });
});
