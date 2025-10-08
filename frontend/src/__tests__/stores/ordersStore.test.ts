import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useOrdersStore } from '../../stores/ordersStore';
import { ordersService } from '../../services/orders.service';
import { mockOrder } from '../utils/test-utils';

// Mock the orders service
vi.mock('../../services/orders.service', () => ({
  ordersService: {
    getOrders: vi.fn(),
    getOrderById: vi.fn(),
    updateOrderStatus: vi.fn(),
  },
}));

describe('Orders Store', () => {
  beforeEach(() => {
    // Reset store state before each test
    useOrdersStore.setState({
      orders: [],
      selectedOrder: null,
      isLoading: false,
      error: null,
      filters: {},
    });
    vi.clearAllMocks();
  });

  it('should initialize with empty orders', () => {
    const state = useOrdersStore.getState();
    expect(state.orders).toEqual([]);
    expect(state.selectedOrder).toBeNull();
  });

  it('should fetch orders successfully', async () => {
    const mockOrders = [mockOrder, { ...mockOrder, id: 'order-456' }];
    vi.mocked(ordersService.getOrders).mockResolvedValue({
      data: mockOrders,
      pagination: { total: 2, page: 1, limit: 20 },
    } as any);

    const { fetchOrders } = useOrdersStore.getState();
    await fetchOrders();

    const state = useOrdersStore.getState();
    expect(state.orders).toEqual(mockOrders);
    expect(state.isLoading).toBe(false);
  });

  it('should handle fetch orders error', async () => {
    const errorMessage = 'Failed to fetch orders';
    vi.mocked(ordersService.getOrders).mockRejectedValue(
      new Error(errorMessage)
    );

    const { fetchOrders } = useOrdersStore.getState();
    await fetchOrders();

    const state = useOrdersStore.getState();
    expect(state.error).toBe(errorMessage);
    expect(state.isLoading).toBe(false);
  });

  it('should fetch order by id', async () => {
    vi.mocked(ordersService.getOrderById).mockResolvedValue(mockOrder as any);

    const { fetchOrderById } = useOrdersStore.getState();
    await fetchOrderById('order-123');

    const state = useOrdersStore.getState();
    expect(state.selectedOrder).toEqual(mockOrder);
  });

  it('should add new order to the list', () => {
    const newOrder = { ...mockOrder, id: 'order-new' };

    const { addOrder } = useOrdersStore.getState();
    addOrder(newOrder as any);

    const state = useOrdersStore.getState();
    expect(state.orders).toContainEqual(newOrder);
    expect(state.orders[0]).toEqual(newOrder);
  });

  it('should update order in the list', () => {
    useOrdersStore.setState({ orders: [mockOrder as any] });

    const { updateOrder } = useOrdersStore.getState();
    updateOrder('order-123', { status: 'confirmed' });

    const state = useOrdersStore.getState();
    expect(state.orders[0].status).toBe('confirmed');
  });

  it('should delete order from the list', () => {
    useOrdersStore.setState({
      orders: [mockOrder, { ...mockOrder, id: 'order-456' }] as any,
    });

    const { deleteOrder } = useOrdersStore.getState();
    deleteOrder('order-123');

    const state = useOrdersStore.getState();
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0].id).toBe('order-456');
  });

  it('should update order status', async () => {
    const updatedOrder = { ...mockOrder, status: 'confirmed' };
    vi.mocked(ordersService.updateOrderStatus).mockResolvedValue(
      updatedOrder as any
    );

    useOrdersStore.setState({ orders: [mockOrder as any] });

    const { updateOrderStatus } = useOrdersStore.getState();
    await updateOrderStatus('order-123', 'confirmed');

    const state = useOrdersStore.getState();
    expect(state.orders[0].status).toBe('confirmed');
  });

  it('should set and clear filters', () => {
    const { setFilters, clearFilters } = useOrdersStore.getState();

    setFilters({ status: 'confirmed', area: 'Manhattan' });
    let state = useOrdersStore.getState();
    expect(state.filters).toEqual({ status: 'confirmed', area: 'Manhattan' });

    clearFilters();
    state = useOrdersStore.getState();
    expect(state.filters).toEqual({});
  });

  it('should get orders by status', () => {
    const confirmedOrder = { ...mockOrder, status: 'confirmed' };
    const deliveredOrder = { ...mockOrder, id: 'order-456', status: 'delivered' };

    useOrdersStore.setState({
      orders: [mockOrder, confirmedOrder, deliveredOrder] as any,
    });

    const { getOrdersByStatus } = useOrdersStore.getState();
    const pendingOrders = getOrdersByStatus('pending_confirmation');
    const confirmedOrders = getOrdersByStatus('confirmed');

    expect(pendingOrders).toHaveLength(1);
    expect(confirmedOrders).toHaveLength(1);
    expect(pendingOrders[0].id).toBe('order-123');
  });
});
