import { describe, it, expect, vi } from 'vitest';

const get = vi.fn();
vi.mock('../../services/api', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

describe('inventoryService.products (the stock pickers)', () => {
  it('reads GET /api/inventory/products, which is server-filtered to physical and has no 100 cap', async () => {
    get.mockResolvedValue({ data: { products: [{ id: 1, name: 'Copybook', sku: 'CB' }] } });
    const { inventoryService } = await import('../../services/inventory.service');
    expect(await inventoryService.products()).toEqual([{ id: 1, name: 'Copybook', sku: 'CB' }]);
    expect(get).toHaveBeenCalledWith('/api/inventory/products', { quiet: true });
  });
});
