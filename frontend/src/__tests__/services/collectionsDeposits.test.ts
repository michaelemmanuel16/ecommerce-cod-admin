import { describe, it, expect, vi } from 'vitest';
import apiClient from '../../services/api';
import { collectionsService, RECENT_DECIDED } from '../../services/collections.service';

describe('collectionsService.deposits (M5 UI fix 3)', () => {
  it('asks for the pending pay-ins and only the newest decided ones, and turns the amounts into numbers', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [{ id: 1, status: 'pending', amount: '300.00' }] });
    const rows = await collectionsService.deposits();
    expect(get).toHaveBeenCalledWith('/api/agent-reconciliation/deposits', { quiet: true, params: { recentDecided: RECENT_DECIDED } });
    expect(rows[0].amount).toBe(300);
    get.mockRestore();
  });
});
