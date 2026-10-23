import { describe, it, expect, vi, beforeEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

describe('apiClient quiet', () => {
  beforeEach(() => vi.mocked(toast.error).mockClear());

  it('raises an error toast for a refused call, unless the request sets quiet', async () => {
    const mock = new MockAdapter(apiClient);
    mock.onGet('/api/quiet-probe').reply(403, { error: 'Forbidden' });
    await expect(apiClient.get('/api/quiet-probe', { skipCache: true })).rejects.toBeTruthy();
    expect(toast.error).toHaveBeenCalledTimes(1);
    await expect(apiClient.get('/api/quiet-probe', { skipCache: true, quiet: true })).rejects.toBeTruthy();
    expect(toast.error).toHaveBeenCalledTimes(1);
    mock.restore();
  });
});
