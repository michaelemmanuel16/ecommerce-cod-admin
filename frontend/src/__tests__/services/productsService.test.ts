import { describe, it, expect, vi } from 'vitest';

const get = vi.fn();
vi.mock('../../services/api', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

describe('productsService.stockLocations (M4-T22)', () => {
  it('reads GET /api/inventory/locations and keeps the active holders', async () => {
    get.mockResolvedValue({ data: { locations: [
      { id: 1, name: 'Own store', type: 'own_store', isActive: true },
      { id: 2, name: 'Old 3PL', type: 'partner_3pl', isActive: false },
      { id: 3, name: 'Kofi', type: 'agent', isActive: true },
    ] } });
    const { productsService } = await import('../../services/products.service');
    expect(await productsService.stockLocations()).toEqual([{ id: 1, name: 'Own store', type: 'own_store' }, { id: 3, name: 'Kofi', type: 'agent' }]);
    expect(get).toHaveBeenCalledWith('/api/inventory/locations', { quiet: true });
  });
});
