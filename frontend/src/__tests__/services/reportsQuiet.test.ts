import { describe, it, expect, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { reportsService } from '../../services/reports.service';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

describe('reportsService.get (QA-07)', () => {
  it('a refused range raises no toast: the tab shows the sentence inline', async () => {
    const mock = new MockAdapter(apiClient);
    mock.onGet('/api/reports/sales').reply(400, { message: 'The range is over 366 days. Narrow it.' });
    await expect(reportsService.get('sales', { from: '2020-01-01', to: '2026-01-01', compare: false }, true)).rejects.toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
    mock.restore();
  });
});
