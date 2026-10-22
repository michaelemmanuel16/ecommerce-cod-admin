import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
vi.mock('../../services/api', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
import { ordersService } from '../../services/orders.service';

/** M3-T48 (F-320): the export call sends the list filters, not the sort or page, and names the file from the server. */
describe('ordersService.exportList', () => {
  beforeEach(() => {
    get.mockReset();
    window.URL.createObjectURL = vi.fn(() => 'blob:x');
    window.URL.revokeObjectURL = vi.fn();
  });

  it('sends filters and format, and downloads under the server file name', async () => {
    get.mockResolvedValue({ data: new Blob(['a']), headers: { 'content-disposition': 'attachment; filename="orders-2026-10-22.csv"' } });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
    const name = await ordersService.exportList({ status: ['confirmed'], search: 'a', sortBy: 'id', page: 3, limit: 25, startDate: '2026-10-01' }, 'csv');
    expect(name).toBe('orders-2026-10-22.csv');
    expect(clicked).toEqual(['orders-2026-10-22.csv']);
    const [url, cfg] = get.mock.calls[0];
    expect(url).toBe('/api/orders/export');
    expect(cfg.params).toEqual({ status: ['confirmed'], search: 'a', startDate: '2026-10-01', format: 'csv' });
    expect(cfg.responseType).toBe('blob');
  });

  it('falls back to orders-<date>.<format>', async () => {
    get.mockResolvedValue({ data: new Blob(['a']), headers: {} });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    expect(await ordersService.exportList({}, 'xlsx')).toMatch(/^orders-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
