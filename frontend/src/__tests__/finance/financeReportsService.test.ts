import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
vi.mock('../../services/api', () => ({ apiClient: { get: (...a: unknown[]) => get(...a) } }));
const waitForFinanceJob = vi.fn();
const downloadFinanceJob = vi.fn();
vi.mock('../../services/financial.service', () => ({
  financialService: { waitForFinanceJob: (...a: unknown[]) => waitForFinanceJob(...a), downloadFinanceJob: (...a: unknown[]) => downloadFinanceJob(...a) },
}));

import { financeReportsService } from '../../services/financeReports.service';

beforeEach(() => { get.mockReset(); waitForFinanceJob.mockReset(); downloadFinanceJob.mockReset(); });

describe('Finance export file (M5-T41, F-930)', () => {
  it('returns the blob and the file name the server chose', async () => {
    const blob = new Blob(['a,b']);
    get.mockResolvedValue({ status: 200, data: blob, headers: { 'content-disposition': 'attachment; filename="profit-and-loss_2026-10-01_to_2026-10-17.csv"' } });
    const file = await financeReportsService.exportFile('profit-loss', { format: 'csv', startDate: '2026-10-01', endDate: '2026-10-17' });
    expect(file).toEqual({ blob, filename: 'profit-and-loss_2026-10-01_to_2026-10-17.csv' });
    expect(get).toHaveBeenCalledWith('/api/financial/export/profit-loss', expect.objectContaining({ params: { format: 'csv', startDate: '2026-10-01', endDate: '2026-10-17' }, responseType: 'blob' }));
  });

  it('falls back to a name from the report and format when the server sends none', async () => {
    get.mockResolvedValue({ status: 200, data: new Blob(['x']), headers: {} });
    expect((await financeReportsService.exportFile('agent-aging', { format: 'xlsx' })).filename).toBe('agent-aging.xlsx');
  });

  it('a large ledger answers 202 with a job: it waits for the job and downloads its file', async () => {
    get.mockResolvedValue({ status: 202, data: { text: async () => JSON.stringify({ jobId: 'job-1' }) }, headers: {} });
    waitForFinanceJob.mockResolvedValue({ result: { filename: 'general-ledger_start_to_2026-10-17.csv', downloadUrl: '/api/financial/jobs/job-1/download' } });
    const file = new Blob(['ledger']);
    downloadFinanceJob.mockResolvedValue(file);
    const queued = vi.fn();
    const out = await financeReportsService.exportFile('general-ledger', { format: 'csv' }, { onQueued: queued });
    expect(queued).toHaveBeenCalledTimes(1);
    expect(waitForFinanceJob).toHaveBeenCalledWith('job-1');
    expect(downloadFinanceJob).toHaveBeenCalledWith('/api/financial/jobs/job-1/download');
    expect(out).toEqual({ blob: file, filename: 'general-ledger_start_to_2026-10-17.csv' });
  });
});
