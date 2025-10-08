import { create } from 'zustand';
import { Order, OrderStatus, FilterOptions } from '../types';
import { ordersService } from '../services/orders.service';

interface OrdersState {
  orders: Order[];
  selectedOrder: Order | null;
  filters: FilterOptions;
  isLoading: boolean;
  fetchOrders: () => Promise<void>;
  fetchOrderById: (id: string) => Promise<void>;
  updateOrderStatus: (id: string, status: OrderStatus) => Promise<void>;
  setFilters: (filters: FilterOptions) => void;
  setSelectedOrder: (order: Order | null) => void;
  addOrder: (order: Order) => void;
  updateOrder: (order: Order) => void;
}

export const useOrdersStore = create<OrdersState>((set, get) => ({
  orders: [],
  selectedOrder: null,
  filters: {},
  isLoading: false,

  fetchOrders: async () => {
    set({ isLoading: true });
    try {
      const orders = await ordersService.getOrders(get().filters);
      set({ orders, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  fetchOrderById: async (id: string) => {
    set({ isLoading: true });
    try {
      const order = await ordersService.getOrderById(id);
      set({ selectedOrder: order, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  updateOrderStatus: async (id: string, status: OrderStatus) => {
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
    set({ filters });
    get().fetchOrders();
  },

  setSelectedOrder: (order: Order | null) => {
    set({ selectedOrder: order });
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
