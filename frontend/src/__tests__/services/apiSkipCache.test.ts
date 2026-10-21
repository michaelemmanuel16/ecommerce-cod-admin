import { describe, it, expect } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { apiClient } from '../../services/api';

describe('apiClient skipCache', () => {
  it('answers a repeated GET from the 5 second cache, unless the request sets skipCache', async () => {
    const mock = new MockAdapter(apiClient);
    mock.onGet('/api/skip-cache-probe').reply(200, { ok: true });
    await apiClient.get('/api/skip-cache-probe');
    await apiClient.get('/api/skip-cache-probe');
    expect(mock.history.get.length).toBe(1);
    await apiClient.get('/api/skip-cache-probe', { skipCache: true });
    expect(mock.history.get.length).toBe(2);
    mock.restore();
  });
});
