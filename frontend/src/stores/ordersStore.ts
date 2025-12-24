import { create } from 'zustand';
import { Order, OrderStatus, FilterOptions, PaginationMeta } from '../types';
import { ordersService } from '../services/orders.service';

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
  updateOrder: (id: string, updates: Partial<Order>) => void;
  deleteOrder: (id: string) => void;
  getOrdersByStatus: (status: OrderStatus) => Order[];
}

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

  updateOrder: (id: string, updates: Partial<Order>) => {
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

  deleteOrder: (id: string) => {
    set((state) => ({
      orders: state.orders.filter((o) => o.id !== id),
      selectedOrder: state.selectedOrder?.id === id ? null : state.selectedOrder,
    }));
  },

  getOrdersByStatus: (status: OrderStatus) => {
    return get().orders.filter((order) => order.status === status);
  },
}));
