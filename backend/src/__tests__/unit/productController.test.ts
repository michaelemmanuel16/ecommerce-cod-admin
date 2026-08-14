/**
 * productController.createProduct — SKU uniqueness.
 *
 * The SKU check has to see archived products: an archived row keeps its SKU in
 * the unique index, so a check blind to it lets the create through and Postgres
 * rejects it. Nothing maps that constraint error for this route, so it reached
 * the client as a 500 "Internal server error".
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prismaMock } from '../mocks/prisma.mock';
import { createProduct } from '../../controllers/productController';

describe('productController.createProduct — SKU uniqueness', () => {
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = { body: { name: 'Test Product', sku: 'SKU-001', price: 100 }, user: null };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  it('creates the product when the SKU is free', async () => {
    (prismaMock.product.findFirst as any).mockResolvedValue(null);
    (prismaMock.product.create as any).mockResolvedValue({ id: 1, sku: 'SKU-001' } as any);

    await createProduct(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(201);
  });

  it('rejects an active duplicate with the existing message', async () => {
    (prismaMock.product.findFirst as any).mockResolvedValue({
      id: 1,
      sku: 'SKU-001',
      isActive: true,
    } as any);

    await expect(createProduct(mockReq, mockRes)).rejects.toThrow(
      'Product with this SKU already exists'
    );
    expect(prismaMock.product.create).not.toHaveBeenCalled();
  });

  it('points at the archived product rather than failing on the constraint', async () => {
    (prismaMock.product.findFirst as any).mockResolvedValue({
      id: 1,
      sku: 'SKU-001',
      isActive: false,
    } as any);

    await expect(createProduct(mockReq, mockRes)).rejects.toThrow(
      /archived product already uses this SKU/i
    );
    expect(prismaMock.product.create).not.toHaveBeenCalled();
  });
});
