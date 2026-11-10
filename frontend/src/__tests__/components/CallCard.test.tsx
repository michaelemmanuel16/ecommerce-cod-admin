import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const MOCK_CARD: CallCardData = {
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
    previousOrders: [
      { id: 24001, createdAt: '2026-07-02T10:00:00.000Z', totalAmount: '249.0000', status: 'delivered' },
    ],
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
    ],
  },
  lastCalls: [
    {
      id: 1,
      outcome: 'not_reachable',
      duration: 0,
      notes: 'Phone rang, no answer',
      startedAt: '2026-10-17T09:05:00.000Z',
      callbackAt: null,
      declineReason: null,
      createdAt: '2026-10-17T09:05:00.000Z',
      salesRep: { id: 1, name: 'Adwoa Darko' },
    },
  ],
  nextOrderId: 24043,
  pay: {
    baseCommission: '8.00',
    upsellPercent: 10,
  },
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

describe('CallCard (M7-T17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigStore.setState({ currency: 'GHS', loaded: true });
    mockGetCallCard.mockResolvedValue(MOCK_CARD);
  });

  it('renders header, customer, order and history from call card endpoint', async () => {
    renderCallCard();

    expect(await screen.findByRole('heading', { name: 'Efua Mensah' })).toBeInTheDocument();
    expect(screen.getByText('#24041')).toBeInTheDocument();
    expect(screen.getAllByText(/Tema/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('cc-val')).toHaveTextContent('GH₵249');
    expect(screen.getByTestId('cash-to-collect')).toHaveTextContent('GH₵249');
    expect(screen.getByTestId('phone-number')).toHaveTextContent('+233245083317'); // as typed (F-751)
    expect(screen.getByText('Community 18, House 22, Tema')).toBeInTheDocument();
    expect(screen.queryByText('First order from this customer.')).toBeNull(); // Has 1 previous order
    expect(screen.getByText('Phone rang, no answer')).toBeInTheDocument();
  });

  it('links Call and WhatsApp to the normalised number, and disables them for a bad number (F-751)', async () => {
    mockGetCallCard.mockResolvedValue({ ...MOCK_CARD, customer: { ...MOCK_CARD.customer, phoneNumber: '024 508 3317' } });
    const { unmount } = renderCallCard();
    expect(await screen.findByRole('link', { name: 'Call Efua Mensah' })).toHaveAttribute('href', 'tel:+233245083317');
    expect(screen.getByRole('link', { name: 'WhatsApp Efua Mensah' })).toHaveAttribute('href', 'https://wa.me/233245083317');
    expect(screen.getByTestId('phone-number')).toHaveTextContent('024 508 3317');
    unmount();

    mockGetCallCard.mockResolvedValue({ ...MOCK_CARD, customer: { ...MOCK_CARD.customer, phoneNumber: '12345' } });
    renderCallCard();
    expect(await screen.findByRole('button', { name: /^Call$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^WhatsApp$/ })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).toBeNull();
    expect(screen.getByTestId('check-number-tag')).toBeInTheDocument();
  });

  it('updates save button text per outcome', async () => {
    renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });

    const saveBtn = screen.getByRole('button', { name: 'Pick an outcome' });
    expect(saveBtn).toBeDisabled();

    // 1. Confirmed
    await userEvent.click(screen.getByRole('button', { name: 'Confirmed' }));
    expect(screen.getByRole('button', { name: 'Save as confirmed' })).toBeEnabled();

    // 2. Not reachable
    await userEvent.click(screen.getByRole('button', { name: 'Not reachable' }));
    expect(screen.getByRole('button', { name: 'Save, not reachable' })).toBeEnabled();

    // 3. Call back later (initially disabled until time set)
    await userEvent.click(screen.getByRole('button', { name: 'Call back later' }));
    const cbBtn = screen.getByRole('button', { name: 'Save call back' });
    expect(cbBtn).toBeDisabled();

    // Pick chip
    await userEvent.click(screen.getByRole('button', { name: 'In 30 min' }));
    expect(cbBtn).toBeEnabled();

    // 4. Declined (initially disabled until reason set)
    await userEvent.click(screen.getByRole('button', { name: 'Declined' }));
    const decBtn = screen.getByRole('button', { name: 'Save as declined' });
    expect(decBtn).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Price too high' }));
    expect(decBtn).toBeEnabled();

    // 5. Wrong number
    await userEvent.click(screen.getByRole('button', { name: 'Wrong number' }));
    expect(screen.getByRole('button', { name: 'Save, wrong number' })).toBeEnabled();
  });

  it('requires note when declined reason is Other', async () => {
    renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });

    await userEvent.click(screen.getByRole('button', { name: 'Declined' }));
    const saveBtn = screen.getByRole('button', { name: 'Save as declined' });

    await userEvent.click(screen.getByRole('button', { name: 'Other' }));
    expect(saveBtn).toBeDisabled();

    const noteInput = screen.getByPlaceholderText('Why did they decline?');
    await userEvent.type(noteInput, 'Customer was busy today');
    expect(saveBtn).toBeEnabled();
  });

  it('Assigned row reads "Call rep: <name> · Delivery: <name>"', async () => {
    renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });
    expect(screen.getByText('Call rep: Adwoa Darko · Delivery: not set yet')).toBeInTheDocument();
  });

  it('blocks past call-back time', async () => {
    renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });

    await userEvent.click(screen.getByRole('button', { name: 'Call back later' }));
    const saveBtn = screen.getByRole('button', { name: 'Save call back' });

    // Pick a date and time in the past
    const timeInput = screen.getByLabelText(/Or pick a date and time/i);
    fireEvent.change(timeInput, { target: { value: '2020-01-01T09:00' } });

    await waitFor(() => {
      expect(screen.getByText('Call-back time cannot be in the past')).toBeInTheDocument();
      expect(saveBtn).toBeDisabled();
    });
  });

  it('call back on another day: sends that date and the toast shows the day', async () => {
    mockCreateCall.mockResolvedValueOnce({ call: { id: 60 }, nextOrderId: null });
    renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });
    await userEvent.click(screen.getByRole('button', { name: 'Call back later' }));

    const d = new Date();
    d.setDate(d.getDate() + 3);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    fireEvent.change(screen.getByLabelText(/Or pick a date and time/i), { target: { value: `${ymd}T09:30` } });
    await userEvent.click(screen.getByRole('button', { name: 'Save call back' }));

    await waitFor(() => {
      expect(mockCreateCall).toHaveBeenCalledWith(
        expect.objectContaining({ callbackAt: new Date(`${ymd}T09:30`).toISOString() }),
      );
    });
    expect(await screen.findByText(/^Call back set for \w{3} \d{1,2} \w{3}, 09:30$/)).toBeInTheDocument();
  });

  it('disables outcome buttons when order is cancelled or confirmed', async () => {
    mockGetCallCard.mockResolvedValueOnce({
      ...MOCK_CARD,
      order: {
        ...MOCK_CARD.order,
        status: 'cancelled',
      },
    });

    renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });

    expect(screen.getByText(/Order is Cancelled. Outcome buttons disabled./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmed' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Not reachable' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Call back later' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Declined' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Wrong number' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pick an outcome' })).toBeDisabled();
  });

  it('handles 409 conflict: shows Already handled and reloads card', async () => {
    mockCreateCall.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 409,
        data: { message: 'Already handled' },
      },
    });

    renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });

    await userEvent.click(screen.getByRole('button', { name: 'Confirmed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save as confirmed' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Already handled');
    expect(mockGetCallCard).toHaveBeenCalledTimes(2);
  });

  it('marks the current package as picked and labelled "current"', async () => {
    renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });
    await userEvent.click(screen.getByRole('button', { name: 'Confirmed' }));
    const current = screen.getByRole('button', { name: /1 copybook set · current/ });
    expect(current).toHaveClass('on');
    await userEvent.click(current); // tapping the current package keeps it picked
    expect(current).toHaveClass('on');
  });

  it('a second tap on the picked package undoes the pick (no package change is sent)', async () => {
    // Real old orders: the current package matches no form package (id null).
    mockGetCallCard.mockResolvedValue({
      ...MOCK_CARD,
      packages: { ...MOCK_CARD.packages, currentPackage: { id: null, name: '1 × Copybook', price: '249.0000' } },
    });
    mockCreateCall.mockResolvedValueOnce({ call: { id: 51 }, nextOrderId: null, upsell: null });
    renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });

    await userEvent.click(screen.getByRole('button', { name: 'Confirmed' }));
    const pkg = screen.getByRole('button', { name: /3 copybook sets/ });
    await userEvent.click(pkg);
    expect(pkg).toHaveClass('on');
    await userEvent.click(pkg);
    expect(pkg).not.toHaveClass('on');

    await userEvent.click(screen.getByRole('button', { name: 'Save as confirmed' }));
    await waitFor(() => {
      expect(mockCreateCall).toHaveBeenCalledWith(
        expect.objectContaining({ orderChanges: { packageId: null, addOnIds: [] } }),
      );
    });
  });

  it('saves successfully and triggers onDone with nextOrderId', async () => {
    mockCreateCall.mockResolvedValueOnce({
      call: { id: 50 },
      nextOrderId: 24043,
      upsell: null,
    });

    const { onDone } = renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });

    await userEvent.click(screen.getByRole('button', { name: 'Confirmed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save as confirmed' }));

    await waitFor(() => {
      expect(mockCreateCall).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 24041,
          customerId: 101,
          outcome: 'confirmed',
        }),
      );
      expect(onDone).toHaveBeenCalledWith(24043);
    });
    expect(await screen.findByText('You earn GH₵8 if delivered')).toBeInTheDocument();
  });

  it('shows distinct toasts for not reachable, call back, declined, wrong number without repeating button text', async () => {
    // 1. Not reachable
    mockCreateCall.mockResolvedValueOnce({ call: { id: 51 }, nextOrderId: null });
    const t1 = renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });
    await userEvent.click(screen.getByRole('button', { name: 'Not reachable' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save, not reachable' }));
    expect(await screen.findByText('Call saved: not reachable')).toBeInTheDocument();
    t1.unmount();

    // 2. Call back later with chip
    mockCreateCall.mockResolvedValueOnce({ call: { id: 52 }, nextOrderId: null });
    const t2 = renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });
    await userEvent.click(screen.getByRole('button', { name: 'Call back later' }));
    await userEvent.click(screen.getByRole('button', { name: 'In 30 min' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save call back' }));
    expect(await screen.findByText(/^Call back set for \d{2}:\d{2}$/)).toBeInTheDocument();
    t2.unmount();

    // 3. Declined with reason
    mockCreateCall.mockResolvedValueOnce({ call: { id: 53 }, nextOrderId: null });
    const t3 = renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });
    await userEvent.click(screen.getByRole('button', { name: 'Declined' }));
    await userEvent.click(screen.getByRole('button', { name: 'Price too high' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save as declined' }));
    expect(await screen.findByText('Call saved: declined')).toBeInTheDocument();
    t3.unmount();

    // 4. Wrong number
    mockCreateCall.mockResolvedValueOnce({ call: { id: 54 }, nextOrderId: null });
    const t4 = renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });
    await userEvent.click(screen.getByRole('button', { name: 'Wrong number' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save, wrong number' }));
    expect(await screen.findByText('Call saved: wrong number')).toBeInTheDocument();
  });

  it('allows rep to edit customer from call card via CustomerModal', async () => {
    renderCallCard();
    await screen.findByRole('heading', { name: 'Efua Mensah' });

    // Click Edit button in Customer block
    const editBtn = screen.getByRole('button', { name: /Edit/ });
    expect(editBtn).toBeInTheDocument();
    await userEvent.click(editBtn);

    // Modal opens
    const modal = await screen.findByRole('dialog', { name: 'Edit customer' });
    expect(modal).toBeInTheDocument();
    // Reps have no delete button in the customer edit modal
    expect(within(modal).queryByRole('button', { name: /Delete/ })).toBeNull();
  });
});
