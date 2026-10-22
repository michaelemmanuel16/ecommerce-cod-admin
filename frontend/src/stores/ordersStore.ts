import { create } from 'zustand';
import { Order, OrderStatus, FilterOptions, PaginationMeta } from '../types';
import { ordersService } from '../services/orders.service';
import { getSocket } from '../services/socket';

interface OrdersState {
  orders: Order[];
  selectedOrder: Order | null;
  filters: FilterOptions;
  pagination: PaginationMeta;
  isLoading: boolean;
  error: string | null;
  fetchOrders: () => Promise<void>;
  fetchOrderById: (id: number) => Promise<void>;
  updateOrderStatus: (id: number, status: OrderStatus) => Promise<void>;
  setFilters: (filters: FilterOptions) => void;
  clearFilters: () => void;
  setSelectedOrder: (order: Order | null) => void;
  setPage: (page: number) => void;
  setPageSize: (limit: number) => void;
  addOrder: (order: Order) => void;
  updateOrder: (id: number, updates: Partial<Order>) => void;
  deleteOrder: (id: number) => void;
  getOrdersByStatus: (status: OrderStatus) => Order[];
  setupSocketListeners: () => void;
}

// M3-T36: a change to an order (any client, same tenant) re-reads the list the page shows. Only when a list is
// loaded, and without the loading flag, so the table does not flash.
async function refetchOnOrderEvent() {
  const { orders: loaded, filters } = useOrdersStore.getState();
  if (loaded.length === 0) return;
  try {
    const { orders, pagination } = await ordersService.getOrders(filters);
    useOrdersStore.setState({ orders, pagination });
  } catch (error) {
    console.error('[OrdersStore] Refresh after an order event failed:', error);
  }
}

// M3-T42: the names the backend emits (sockets/index.ts). The singular `order:created` and `order:updated` carry the
// raw order and `orders:deleted` carries `{ orderIds }`, so none of them can be put into the list as it is: re-read.
const REFETCH_EVENTS = ['order:created', 'order:updated', 'order:status_changed', 'order:assigned'] as const;

export const useOrdersStore = create<OrdersState>((set, get) => ({
  orders: [],
  selectedOrder: null,
  filters: {},
  pagination: { page: 1, limit: 50, total: 0, pages: 0 },
  isLoading: false,
  error: null,

  fetchOrders: async () => {
    set({ isLoading: true, error: null });
    try {
      const currentFilters = get().filters;
      console.log('[OrdersStore] Fetching orders with filters:', currentFilters);
      const { orders, pagination } = await ordersService.getOrders(currentFilters);
      console.log('[OrdersStore] Fetched orders:', orders.length, 'orders');
      set({ orders, pagination, isLoading: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch orders';
      console.error('Error fetching orders:', error);
      set({ isLoading: false, error: errorMessage });
      throw error;
    }
  },

  fetchOrderById: async (id: number) => {
    set({ isLoading: true });
    try {
      const order = await ordersService.getOrderById(id);
      set({ selectedOrder: order, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  updateOrderStatus: async (id: number, status: OrderStatus) => {
    try {
      const updatedOrder = await ordersService.updateOrderStatus(id, status);
      set((state) => ({
        orders: state.orders.map((order) =>
          order.id === id ? updatedOrder : order
        ),
        selectedOrder:
          state.selectedOrder?.id === id ? updatedOrder : state.selectedOrder,
      }));
    } catch (error) {
      throw error;
    }
  },

  setFilters: (filters: FilterOptions) => {
    // Reset to page 1 when filters change
    set({ filters: { ...filters, page: 1 } });
    get().fetchOrders();
  },

  clearFilters: () => {
    set({ filters: {} });
    get().fetchOrders();
  },

  setSelectedOrder: (order: Order | null) => {
    set({ selectedOrder: order });
  },

  setPage: (page: number) => {
    set((state) => ({ filters: { ...state.filters, page } }));
    get().fetchOrders();
  },

  setPageSize: (limit: number) => {
    // Reset to page 1 when page size changes
    set((state) => ({ filters: { ...state.filters, limit, page: 1 } }));
    get().fetchOrders();
  },

  addOrder: (order: Order) => {
    set((state) => ({
      orders: [order, ...state.orders],
    }));
  },

  updateOrder: (id: number, updates: Partial<Order>) => {
    set((state) => ({
      orders: state.orders.map((o) =>
        o.id === id ? { ...o, ...updates } : o
      ),
      selectedOrder:
        state.selectedOrder?.id === id
          ? { ...state.selectedOrder, ...updates }
          : state.selectedOrder,
    }));
  },

  deleteOrder: (id: number) => {
    set((state) => ({
      orders: state.orders.filter((o) => o.id !== id),
      selectedOrder: state.selectedOrder?.id === id ? null : state.selectedOrder,
    }));
  },

  getOrdersByStatus: (status: OrderStatus) => {
    return get().orders.filter((order) => order.status === status);
  },

  setupSocketListeners: () => {
    const socket = getSocket();
    if (!socket) return;

    // Remove only this store's handlers: other stores and the toast also listen for these events.
    REFETCH_EVENTS.forEach((e) => socket.off(e, refetchOnOrderEvent));
    socket.off('orders:deleted', refetchOnOrderEvent);

    REFETCH_EVENTS.forEach((e) => socket.on(e, refetchOnOrderEvent));
    socket.on('orders:deleted', refetchOnOrderEvent);
  },
}));
