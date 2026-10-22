import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
vi.mock('../../services/api', () => ({ apiClient: { get: (...a: unknown[]) => get(...a) }, default: { get: (...a: unknown[]) => get(...a) } }));
import { reportsService } from '../../services/reports.service';

/** M3-T62 (F-1057): the export call sends the open tab, range, compare and format, and saves under the server's file name. */
describe('reportsService.download', () => {
  beforeEach(() => {
    get.mockReset();
    window.URL.createObjectURL = vi.fn(() => 'blob:x');
    window.URL.revokeObjectURL = vi.fn();
  });

  it('calls /api/reports/:tab/export and downloads <tab>-<from>-<to>.csv', async () => {
    get.mockResolvedValue({ data: new Blob(['a']), headers: { 'content-disposition': 'attachment; filename="delivery-2026-10-01-2026-10-17.csv"' } });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
    const name = await reportsService.download('delivery', { from: '2026-10-01', to: '2026-10-17', compare: true }, 'csv');
    expect(name).toBe('delivery-2026-10-01-2026-10-17.csv');
    expect(clicked).toEqual(['delivery-2026-10-01-2026-10-17.csv']);
    const [url, cfg] = get.mock.calls[0];
    expect(url).toBe('/api/reports/delivery/export');
    expect(cfg.params).toEqual({ from: '2026-10-01', to: '2026-10-17', compare: 'previous', format: 'csv' });
    expect(cfg.responseType).toBe('blob');
  });

  it('all reports: Excel, no compare param when the switch is off, fallback file name', async () => {
    get.mockResolvedValue({ data: new Blob(['a']), headers: {} });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const name = await reportsService.download('all', { from: '2026-10-01', to: '2026-10-17', compare: false }, 'xlsx');
    expect(name).toBe('all-reports-2026-10-01-2026-10-17.xlsx');
    expect(get.mock.calls[0][0]).toBe('/api/reports/all/export');
    expect(get.mock.calls[0][1].params).toEqual({ from: '2026-10-01', to: '2026-10-17', format: 'xlsx' });
  });
});
