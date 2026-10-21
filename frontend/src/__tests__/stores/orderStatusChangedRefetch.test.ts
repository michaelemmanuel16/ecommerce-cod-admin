/**
 * M3-T36: stores re-fetch on `order:status_changed`.
 * "Two clients" without a server: two fake sockets (client A and client B), each with its own handler table, as the
 * server would give two signed-in people of the same tenant. One status change is delivered to both; each client's
 * stores must re-read their data. The backend's tenant rooms are covered by the backend socket tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useOrdersStore } from '../../stores/ordersStore';
import { useAnalyticsStore } from '../../stores/analyticsStore';
import { ordersService } from '../../services/orders.service';
import { getSocket } from '../../services/socket';
import { mockOrder } from '../utils/test-utils';

vi.mock('../../services/orders.service', () => ({
  ordersService: { getOrders: vi.fn(), getOrderById: vi.fn(), updateOrderStatus: vi.fn() },
}));
vi.mock('../../services/socket', () => ({ getSocket: vi.fn() }));

function fakeSocket() {
  const handlers: Record<string, Array<(p?: unknown) => void>> = {};
  return {
    handlers,
    // As socket.io: off(event, handler) removes that handler only; off(event) removes them all.
    off: vi.fn((e: string, h?: (p?: unknown) => void) => {
      if (h) handlers[e] = (handlers[e] ?? []).filter((x) => x !== h);
      else delete handlers[e];
    }),
    on: vi.fn((e: string, h: (p?: unknown) => void) => { (handlers[e] ??= []).push(h); }),
    emit: (e: string, p?: unknown) => (handlers[e] ?? []).forEach((h) => h(p)),
  };
}

const event = { orderId: 1, orderNumber: 'ORD-1', oldStatus: 'pending', newStatus: 'confirmed' };

describe('stores re-fetch on order:status_changed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrdersStore.setState({ orders: [mockOrder], filters: { page: 2 } });
  });

  it('both clients re-read their orders list', async () => {
    const a = fakeSocket();
    const b = fakeSocket();
    const fresh = { ...mockOrder, status: 'confirmed' as const };
    vi.mocked(ordersService.getOrders).mockResolvedValue({ orders: [fresh], pagination: { page: 2, limit: 50, total: 1, pages: 1 } } as never);

    for (const client of [a, b]) {
      vi.mocked(getSocket).mockReturnValue(client as never);
      useOrdersStore.getState().setupSocketListeners();
    }

    a.emit('order:status_changed', event);
    b.emit('order:status_changed', event);
    await vi.waitFor(() => expect(ordersService.getOrders).toHaveBeenCalledTimes(2));
    expect(ordersService.getOrders).toHaveBeenCalledWith({ page: 2 }); // the page the person is on, not page 1
    await vi.waitFor(() => expect(useOrdersStore.getState().orders[0].status).toBe('confirmed'));
  });

  it('does not fetch when no list is loaded', async () => {
    useOrdersStore.setState({ orders: [] });
    const a = fakeSocket();
    vi.mocked(getSocket).mockReturnValue(a as never);
    useOrdersStore.getState().setupSocketListeners();
    a.emit('order:status_changed', event);
    await Promise.resolve();
    expect(ordersService.getOrders).not.toHaveBeenCalled();
  });

  it('the analytics store re-reads metrics and pending orders', () => {
    const fetchDashboardMetrics = vi.fn();
    const fetchPendingOrders = vi.fn();
    useAnalyticsStore.setState({ fetchDashboardMetrics, fetchPendingOrders } as never);
    const a = fakeSocket();
    vi.mocked(getSocket).mockReturnValue(a as never);
    useAnalyticsStore.getState().setupSocketListeners();
    a.emit('order:status_changed', event);
    expect(fetchDashboardMetrics).toHaveBeenCalled();
    expect(fetchPendingOrders).toHaveBeenCalled();
  });

  it('one socket: setting up the orders store keeps the analytics listener (and the reverse)', async () => {
    const fetchDashboardMetrics = vi.fn();
    const fetchPendingOrders = vi.fn();
    useAnalyticsStore.setState({ fetchDashboardMetrics, fetchPendingOrders } as never);
    vi.mocked(ordersService.getOrders).mockResolvedValue({ orders: [mockOrder], pagination: { page: 2, limit: 50, total: 1, pages: 1 } } as never);
    const a = fakeSocket();
    const toast = vi.fn();
    a.on('order:status_changed', toast); // stands in for the toast handler in services/socket.ts
    vi.mocked(getSocket).mockReturnValue(a as never);
    useAnalyticsStore.getState().setupSocketListeners();
    useOrdersStore.getState().setupSocketListeners();
    useAnalyticsStore.getState().setupSocketListeners(); // a second setup must not add a duplicate
    a.emit('order:status_changed', event);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(fetchDashboardMetrics).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(ordersService.getOrders).toHaveBeenCalledTimes(1));
  });
});
