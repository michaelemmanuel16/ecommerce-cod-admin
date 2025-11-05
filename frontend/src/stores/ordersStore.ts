import { create } from 'zustand';
import { Order, OrderStatus, FilterOptions, PaginationMeta } from '../types';
import { ordersService } from '../services/orders.service';

interface OrdersState {
  orders: Order[];
  selectedOrder: Order | null;
  filters: FilterOptions;
  pagination: PaginationMeta;
  isLoading: boolean;
  fetchOrders: () => Promise<void>;
  fetchOrderById: (id: number) => Promise<void>;
  updateOrderStatus: (id: number, status: OrderStatus) => Promise<void>;
  setFilters: (filters: FilterOptions) => void;
  setSelectedOrder: (order: Order | null) => void;
  setPage: (page: number) => void;
  addOrder: (order: Order) => void;
  updateOrder: (order: Order) => void;
}

export const useOrdersStore = create<OrdersState>((set, get) => ({
  orders: [],
  selectedOrder: null,
  filters: {},
  pagination: { page: 1, limit: 20, total: 0, pages: 0 },
  isLoading: false,

  fetchOrders: async () => {
    set({ isLoading: true });
    try {
      const currentFilters = get().filters;
      console.log('[OrdersStore] Fetching orders with filters:', currentFilters);
      const { orders, pagination } = await ordersService.getOrders(currentFilters);
      console.log('[OrdersStore] Fetched orders:', orders.length, 'orders');
      set({ orders, pagination, isLoading: false });
    } catch (error) {
      console.error('Error fetching orders:', error);
      set({ isLoading: false });
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

  setSelectedOrder: (order: Order | null) => {
    set({ selectedOrder: order });
  },

  setPage: (page: number) => {
    set((state) => ({ filters: { ...state.filters, page } }));
    get().fetchOrders();
  },

  addOrder: (order: Order) => {
    set((state) => ({
      orders: [order, ...state.orders],
    }));
  },

  updateOrder: (order: Order) => {
    set((state) => ({
      orders: state.orders.map((o) => (o.id === order.id ? order : o)),
      selectedOrder:
        state.selectedOrder?.id === order.id ? order : state.selectedOrder,
    }));
  },
}));
