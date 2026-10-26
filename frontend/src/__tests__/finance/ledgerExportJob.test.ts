import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../services/api', () => ({ apiClient: api, default: api }));

import { financialService } from '../../services/financial.service';

// jsdom's Blob has no text(); a browser's does
const blobOf = (obj: unknown) => ({ text: async () => JSON.stringify(obj) }) as unknown as Blob;

beforeEach(() => { vi.useFakeTimers(); api.get.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('exportAccountLedger', () => {
  it('returns the file at once when the server answers 200', async () => {
    const csv = new Blob(['a,b']);
    api.get.mockResolvedValueOnce({ status: 200, data: csv });
    const out = await financialService.exportAccountLedger(1, {});
    expect(out).toEqual({ blob: csv, filename: null });
  });

  it('detects the job by status 202, then polls at 1 s, 2 s, 4 s and downloads the file', async () => {
    const file = new Blob(['x']);
    const queued = vi.fn();
    api.get
      .mockResolvedValueOnce({ status: 202, data: blobOf({ jobId: '7' }) })
      .mockResolvedValueOnce({ data: { id: '7', status: 'running' } })
      .mockResolvedValueOnce({ data: { id: '7', status: 'running' } })
      .mockResolvedValueOnce({ data: { id: '7', status: 'done', result: { filename: 'g.csv', rows: 9, downloadUrl: '/dl' } } })
      .mockResolvedValueOnce({ data: file });
    const done = financialService.exportAccountLedger(1, {}, { onQueued: queued });
    await vi.advanceTimersByTimeAsync(0);
    expect(queued).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(api.get).toHaveBeenCalledTimes(1); // first poll is not before 1 s
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(2000); // second poll
    await vi.advanceTimersByTimeAsync(4000); // third poll
    expect(await done).toEqual({ blob: file, filename: 'g.csv' });
    expect(api.get).toHaveBeenCalledTimes(5);
  });

  it('stops waiting when the signal aborts', async () => {
    api.get.mockResolvedValueOnce({ status: 202, data: blobOf({ jobId: '8' }) });
    const abort = new AbortController();
    const done = financialService.exportAccountLedger(1, {}, { signal: abort.signal });
    const assertion = expect(done).rejects.toThrow(/Aborted/);
    await vi.advanceTimersByTimeAsync(10);
    abort.abort();
    await assertion;
  });

  it('gives up when the job fails', async () => {
    api.get
      .mockResolvedValueOnce({ status: 202, data: blobOf({ jobId: '9' }) })
      .mockResolvedValueOnce({ data: { id: '9', status: 'failed', error: 'disk full' } });
    const done = financialService.exportAccountLedger(1, {});
    const assertion = expect(done).rejects.toThrow('disk full');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});
