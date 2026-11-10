import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RepOrdersPage } from '../../pages/rep/RepOrdersPage';
import { repService, type RepOrdersResult } from '../../services/rep.service';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { ToastProvider } from '../../components/ui-v2';

vi.mock('../../services/rep.service', () => ({
  repService: {
    getOrders: vi.fn(),
    getCallCard: vi.fn(),
  },
}));

const mockOrdersResult: RepOrdersResult = {
  orders: [
    {
      id: 1042,
      createdAt: '2026-10-15T10:00:00.000Z',
      status: 'delivered',
      totalAmount: '250.00',
      customer: {
        id: 101,
        firstName: 'Ama',
        lastName: 'Mensah',
        phone: '0245083317',
        alternatePhone: null,
        address: '12 Ring Road',
        area: 'Osu',
        state: 'Greater Accra',
      },
      customerRep: { id: 42, firstName: 'Adwoa', lastName: 'Darko' },
      items: [
        {
          productId: 1,
          productName: 'Facial Cleanser',
          quantity: 2,
          unitPrice: '125.00',
          totalPrice: '250.00',
        },
      ],
      upsellExtraValue: '0.00',
    },
    {
      id: 1043,
      createdAt: '2026-10-16T12:00:00.000Z',
      status: 'out_for_delivery',
      totalAmount: '180.00',
      customer: {
        id: 102,
        firstName: 'Kwame',
        lastName: 'Nkrumah',
        phone: '0501234567',
        alternatePhone: null,
        address: 'Independence Ave',
        area: 'Airport',
        state: 'Greater Accra',
      },
      customerRep: { id: 42, firstName: 'Adwoa', lastName: 'Darko' },
      items: [
        {
          productId: 2,
          productName: 'Moisturizer',
          quantity: 1,
          unitPrice: '180.00',
          totalPrice: '180.00',
        },
      ],
      upsellExtraValue: '30.00',
    },
  ],
  pagination: {
    page: 1,
    limit: 25,
    total: 2,
    totalPages: 1,
  },
};

const mockCardData = {
  order: {
    id: 1042,
    status: 'delivered' as const,
    totalAmount: '250.00',
    subtotal: '250.00',
    deliveryFee: null,
    customerRepId: 42,
    deliveryAgentId: 5,
    deliveryAgent: { id: 5, name: 'Kojo Courier' },
    customerRep: { id: 42, name: 'Adwoa Darko' },
    createdAt: '2026-10-15T10:00:00.000Z',
    updatedAt: '2026-10-15T14:00:00.000Z',
    firstContactAt: '2026-10-15T10:05:00.000Z',
    saidNo: false,
    customerResponse: null,
    requiresManualCall: false,
    notes: 'Customer requested afternoon delivery',
    declineReason: null,
    failureReason: null,
    statusVersion: 1,
  },
  customer: {
    id: 101,
    firstName: 'Ama',
    lastName: 'Mensah',
    name: 'Ama Mensah',
    phoneNumber: '0245083317',
    alternatePhone: null,
    email: 'ama@example.com',
    address: '12 Ring Road',
    area: 'Osu',
    state: 'Greater Accra',
    riskLevel: 'low',
    refusedOrders: 0,
    deliveredOrders: 3,
    codBlocked: false,
    wrongNumber: false,
    previousOrders: [],
  },
  items: [
    {
      id: 1,
      productId: 1,
      productName: 'Facial Cleanser',
      quantity: 2,
      unitPrice: '125.00',
      totalPrice: '250.00',
    },
  ],
  packages: {
    orderId: 1042,
    currentPackage: { id: null, name: null, price: '250.00' },
    availablePackages: [],
    availableAddons: [],
  },
  lastCalls: [],
  nextOrderId: null,
  pay: { baseCommission: '8.00', upsellPercent: 10 },
};

function renderOrders() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <RepOrdersPage />
      </MemoryRouter>
    </ToastProvider>
  );
}

describe('M7-T19: My orders page (F-760)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigStore.setState({ currency: 'GHS', loaded: true });
    useAuthStore.setState({
      user: {
        id: 42,
        email: 'adwoa@example.com',
        firstName: 'Adwoa',
        lastName: 'Darko',
        role: 'sales_rep',
        createdAt: '',
        updatedAt: '',
      },
      isAuthenticated: true,
      accessToken: 'token',
    });
    vi.mocked(repService.getOrders).mockResolvedValue(mockOrdersResult);
    vi.mocked(repService.getCallCard).mockResolvedValue(mockCardData);
  });

  it('renders order list with order number and canonical status label', async () => {
    renderOrders();

    await waitFor(() => {
      expect(screen.getByText('Ama Mensah')).toBeInTheDocument();
      expect(screen.getByText('Kwame Nkrumah')).toBeInTheDocument();
    });

    // Check canonical order formatting (#1042, #1043)
    expect(screen.getByText('#1042')).toBeInTheDocument();
    expect(screen.getByText('#1043')).toBeInTheDocument();

    // Check canonical status labels from getOrderStatusLabel
    expect(screen.getAllByText('Delivered').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Out for delivery').length).toBeGreaterThanOrEqual(1);
  });

  it('search by order id, phone or name triggers getOrders with debounced query', async () => {
    const user = userEvent.setup();
    renderOrders();

    const searchInput = screen.getByLabelText('Search my orders');
    await user.type(searchInput, 'Ama');

    await waitFor(() => {
      expect(repService.getOrders).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'Ama',
        })
      );
    });

    // Search by order id
    await user.clear(searchInput);
    await user.type(searchInput, '1042');

    await waitFor(() => {
      expect(repService.getOrders).toHaveBeenCalledWith(
        expect.objectContaining({
          q: '1042',
        })
      );
    });

    // Search by phone
    await user.clear(searchInput);
    await user.type(searchInput, '0245083317');

    await waitFor(() => {
      expect(repService.getOrders).toHaveBeenCalledWith(
        expect.objectContaining({
          q: '0245083317',
        })
      );
    });
  });

  it('filters orders by status using the status filter dropdown', async () => {
    const user = userEvent.setup();
    renderOrders();

    const statusSelect = screen.getByTestId('orders-status-filter');
    await user.selectOptions(statusSelect, 'delivered');

    await waitFor(() => {
      expect(repService.getOrders).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'delivered',
        })
      );
    });
  });

  it('tapping an order opens the read view without upsell panel', async () => {
    const user = userEvent.setup();
    renderOrders();

    await waitFor(() => {
      expect(screen.getByTestId('order-row-1042')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('order-row-1042'));

    await waitFor(() => {
      expect(repService.getCallCard).toHaveBeenCalledWith(1042);
      expect(screen.getByTestId('call-card-read-only')).toBeInTheDocument();
    });

    // Ensure NO upsell panel or outcome buttons are displayed in read-only mode
    expect(screen.queryByTestId('earnbox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Call outcomes')).not.toBeInTheDocument();
    expect(screen.queryByText('Save as confirmed')).not.toBeInTheDocument();
  });

  it('a new rep with no orders sees zeros and dashes, no errors', async () => {
    vi.mocked(repService.getOrders).mockResolvedValueOnce({
      orders: [],
      pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
    });

    renderOrders();

    await waitFor(() => {
      expect(screen.getByTestId('orders-empty')).toBeInTheDocument();
    });

    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('You have no assigned orders yet.')).toBeInTheDocument();
  });
});
