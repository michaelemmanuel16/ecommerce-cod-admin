import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ordersService } from '../../services/orders.service';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ default: { get } }));

beforeEach(() => get.mockReset());

describe('ordersService, Unpaid by agent tab (M5-T35)', () => {
  it('the list sends tab=unpaid_by_agent without dates or status, so it counts every overdue order', async () => {
    get.mockResolvedValue({ data: { orders: [], pagination: { page: 1, limit: 25, total: 0, pages: 0 } } });
    await ordersService.listOrders({ tab: 'unpaid_by_agent', startDate: '2026-10-01', endDate: '2026-10-31', dateBasis: 'created', status: ['confirmed'], page: 2 });
    expect(get).toHaveBeenCalledWith('/api/orders', expect.objectContaining({ params: expect.objectContaining({ tab: 'unpaid_by_agent', page: 2 }) }));
    const params = get.mock.calls[0][1].params;
    expect(params).not.toHaveProperty('startDate');
    expect(params).not.toHaveProperty('status');
  });

  it('counts take the unpaid number from the unpaid-by-age card, and null when the role is refused', async () => {
    get.mockImplementation((url: string) =>
      url === '/api/orders/counts' ? Promise.resolve({ data: { all: 5, byStatus: {}, waitingToDispatch: 0 } }) : Promise.resolve({ data: { overdue: { orders: 38 } } }));
    expect((await ordersService.getCounts({ tab: 'unpaid_by_agent' })).unpaidByAgent).toBe(38);
    expect(get).toHaveBeenCalledWith('/api/orders/counts', expect.objectContaining({ params: expect.not.objectContaining({ tab: expect.anything() }) }));

    get.mockReset();
    get.mockResolvedValueOnce({ data: { all: 5, byStatus: {}, waitingToDispatch: 0 } });
    get.mockRejectedValueOnce(new Error('403'));
    expect((await ordersService.getCounts({})).unpaidByAgent).toBeNull();
  });
});
