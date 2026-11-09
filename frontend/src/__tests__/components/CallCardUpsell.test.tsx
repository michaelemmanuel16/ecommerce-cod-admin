import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CallCard } from '../../components/rep/CallCard';
import { ToastProvider } from '../../components/ui-v2';
import { repService, type CallCardData } from '../../services/rep.service';
import { callsService } from '../../services/calls.service';
import { useConfigStore } from '../../stores/configStore';

const mockGetCallCard = vi.fn();
const mockCreateCall = vi.fn();

vi.mock('../../services/rep.service', () => ({
  repService: {
    getCallCard: (...args: unknown[]) => mockGetCallCard(...args),
  },
}));

vi.mock('../../services/calls.service', () => ({
  callsService: {
    createCall: (...args: unknown[]) => mockCreateCall(...args),
  },
}));

const MOCK_UPSELL_CARD: CallCardData = {
  order: {
    id: 24041,
    status: 'pending_confirmation',
    totalAmount: '249.0000',
    subtotal: '249.0000',
    deliveryFee: null,
    customerRepId: 1,
    deliveryAgentId: null,
    deliveryAgent: null,
    customerRep: { id: 1, name: 'Adwoa Darko' },
    createdAt: '2026-10-17T09:00:00.000Z',
    updatedAt: '2026-10-17T09:00:00.000Z',
    firstContactAt: null,
    saidNo: false,
    customerResponse: null,
    requiresManualCall: false,
    notes: null,
    declineReason: null,
    failureReason: null,
    statusVersion: 1,
  },
  customer: {
    id: 101,
    firstName: 'Efua',
    lastName: 'Mensah',
    name: 'Efua Mensah',
    phoneNumber: '+233245083317',
    alternatePhone: null,
    email: 'efua@example.com',
    address: 'Community 18, House 22, Tema',
    area: 'Tema',
    state: 'Greater Accra',
    riskLevel: 'normal',
    refusedOrders: 0,
    deliveredOrders: 1,
    codBlocked: false,
    wrongNumber: false,
    previousOrders: [],
  },
  items: [
    {
      id: 1,
      productId: 10,
      productName: '1 copybook set',
      quantity: 1,
      unitPrice: '249.0000',
      totalPrice: '249.0000',
    },
  ],
  packages: {
    orderId: 24041,
    currentPackage: { id: 1, name: '1 copybook set', price: '249.0000' },
    availablePackages: [
      { id: 1, name: '1 copybook set', price: '249.0000', isDefault: true },
      { id: 2, name: '2 copybook sets', price: '449.0000', isPopular: true },
      { id: 3, name: '3 copybook sets', price: '629.0000' },
    ],
    availableAddons: [
      { id: 10, name: 'Refill pens', price: '40.0000', productId: 5, isActive: true },
      { id: 11, name: 'Pencil grip trainer', price: '35.0000', productId: 6, isActive: true },
    ],
  },
  lastCalls: [],
  nextOrderId: 24043,
};

function renderCallCard(props: { orderId?: number; onDone?: (nextId: number | null) => void } = {}) {
  const onDone = props.onDone ?? vi.fn();
  return {
    onDone,
    ...render(
      <ToastProvider>
        <CallCard orderId={props.orderId ?? 24041} onDone={onDone} />
      </ToastProvider>,
    ),
  };
}

describe('CallCard Upsell Panel with Live Reward Box (M7-T18, F-759)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigStore.setState({ currency: 'GHS', loaded: true });
    mockGetCallCard.mockResolvedValue(MOCK_UPSELL_CARD);
  });

  it('shows "No extra value added. You still earn GH₵8 if it is delivered." when no changes selected', async () => {
    renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });

    await userEvent.click(screen.getByRole('button', { name: 'Confirmed' }));

    const earnbox = screen.getByTestId('earnbox');
    expect(earnbox).toHaveTextContent('No extra value added. You still earn GH₵8 if it is delivered.');
    expect(screen.getByTestId('cc-val')).toHaveTextContent('GH₵249');
  });

  it('updates live box text for a bigger package', async () => {
    renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });

    await userEvent.click(screen.getByRole('button', { name: 'Confirmed' }));

    // Select 2 copybook sets (449 vs 249 base = +200, 10% = 20)
    await userEvent.click(screen.getByRole('button', { name: /2 copybook sets/ }));

    const earnbox = screen.getByTestId('earnbox');
    expect(earnbox).toHaveTextContent('You earn GH₵20 extra if this order is delivered (10% of GH₵200)');
    expect(screen.getByTestId('cc-val')).toHaveTextContent('GH₵449');
  });

  it('updates live box text for an add-on', async () => {
    renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });

    await userEvent.click(screen.getByRole('button', { name: 'Confirmed' }));

    // Select Refill pens (+40, 10% = 4)
    await userEvent.click(screen.getByRole('button', { name: /Refill pens/ }));

    const earnbox = screen.getByTestId('earnbox');
    expect(earnbox).toHaveTextContent('You earn GH₵4 extra if this order is delivered (10% of GH₵40)');
    expect(screen.getByTestId('cc-val')).toHaveTextContent('GH₵289');
  });

  it('updates live box text for both bigger package and an add-on', async () => {
    renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });

    await userEvent.click(screen.getByRole('button', { name: 'Confirmed' }));

    // Select 2 copybook sets (+200) and Refill pens (+40) -> extra 240, 10% = 24
    await userEvent.click(screen.getByRole('button', { name: /2 copybook sets/ }));
    await userEvent.click(screen.getByRole('button', { name: /Refill pens/ }));

    const earnbox = screen.getByTestId('earnbox');
    expect(earnbox).toHaveTextContent('You earn GH₵24 extra if this order is delivered (10% of GH₵240)');
    expect(screen.getByTestId('cc-val')).toHaveTextContent('GH₵489');
  });

  it('client sends only orderChanges {packageId, addOnIds} with no client money values', async () => {
    mockCreateCall.mockResolvedValueOnce({
      call: { id: 50 },
      nextOrderId: 24043,
      upsell: {
        estimatedReward: '24.00',
        extraValue: '240.00',
      },
    });

    const { onDone } = renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });

    await userEvent.click(screen.getByRole('button', { name: 'Confirmed' }));
    await userEvent.click(screen.getByRole('button', { name: /2 copybook sets/ }));
    await userEvent.click(screen.getByRole('button', { name: /Refill pens/ }));

    await userEvent.click(screen.getByRole('button', { name: 'Save as confirmed' }));

    await waitFor(() => {
      expect(mockCreateCall).toHaveBeenCalledWith(
        expect.objectContaining({
          orderChanges: {
            packageId: 2,
            addOnIds: [10],
          },
        }),
      );
    });

    // Verify money values were not included in the call payload
    const callArg = mockCreateCall.mock.calls[0][0];
    expect(callArg.orderChanges.extraValue).toBeUndefined();
    expect(callArg.orderChanges.estimatedReward).toBeUndefined();
    expect(callArg.orderChanges.price).toBeUndefined();

    // Verify toast with server response value
    expect(await screen.findByText(/GH₵8 plus GH₵24 if delivered/)).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledWith(24043);
  });
});
