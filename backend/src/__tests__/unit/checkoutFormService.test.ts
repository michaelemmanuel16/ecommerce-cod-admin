/**
 * CheckoutFormService unit tests for branch coverage
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prismaMock } from '../mocks/prisma.mock';
import { CheckoutFormService } from '../../services/checkoutFormService';
import { AppError } from '../../middleware/errorHandler';

const makeForm = (overrides: any = {}) => ({
  id: 1,
  name: 'Test Form',
  slug: 'test-form',
  productId: 1,
  description: 'Test description',
  fields: [],
  styling: {},
  country: 'Ghana',
  currency: 'GHS',
  regions: [],
  isActive: true,
  pixelConfig: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  packages: [],
  upsells: [],
  product: {
    id: 1,
    name: 'Test Product',
    sku: 'TP-001',
    price: 100,
    stockQuantity: 50,
    description: 'Product desc',
    imageUrl: null,
  },
  ...overrides,
});

const makeCreateData = (overrides: any = {}) => ({
  name: 'Test Form',
  slug: 'test-form',
  productId: 1,
  description: 'Test description',
  fields: [],
  styling: {},
  country: 'Ghana',
  regions: [],
  packages: [
    { name: 'Basic', price: 100, quantity: 1, isPopular: false, sortOrder: 0 },
  ],
  ...overrides,
});

describe('CheckoutFormService', () => {
  let checkoutFormService: CheckoutFormService;

  beforeEach(() => {
    jest.clearAllMocks();
    checkoutFormService = new CheckoutFormService();
  });

  // ───────────────────────────── createCheckoutForm ─────────────────────────────
  describe('createCheckoutForm', () => {
    it('throws 400 when slug already exists', async () => {
      (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(makeForm() as any);

      await expect(checkoutFormService.createCheckoutForm(makeCreateData())).rejects.toThrow(AppError);
    });

    it('throws 404 when product not found', async () => {
      (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(null);
      (prismaMock.product.findUnique as any).mockResolvedValue(null);

      await expect(checkoutFormService.createCheckoutForm(makeCreateData())).rejects.toThrow(AppError);
    });

    it('creates form successfully without upsells', async () => {
      (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(null);
      (prismaMock.product.findUnique as any).mockResolvedValue({ id: 1, name: 'Test' } as any);
      (prismaMock.$transaction as any).mockImplementation(async (cb: any) => cb(prismaMock));
      (prismaMock.checkoutForm.create as any).mockResolvedValue(makeForm() as any);

      const result = await checkoutFormService.createCheckoutForm(makeCreateData());
      expect(result.slug).toBe('test-form');
    });

    it('creates form successfully with upsells', async () => {
      const dataWithUpsells = makeCreateData({
        upsells: [{ name: 'Upsell 1', price: 50, items: [], sortOrder: 0 }],
      });
      (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(null);
      (prismaMock.product.findUnique as any).mockResolvedValue({ id: 1, name: 'Test' } as any);
      (prismaMock.$transaction as any).mockImplementation(async (cb: any) => cb(prismaMock));
      (prismaMock.checkoutForm.create as any).mockResolvedValue(makeForm() as any);

      const result = await checkoutFormService.createCheckoutForm(dataWithUpsells);
      expect(result).toBeDefined();
    });

    it('creates form with package using default country when not provided', async () => {
      const dataNoCountry = makeCreateData({ country: undefined });
      (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(null);
      (prismaMock.product.findUnique as any).mockResolvedValue({ id: 1 } as any);
      (prismaMock.$transaction as any).mockImplementation(async (cb: any) => cb(prismaMock));
      (prismaMock.checkoutForm.create as any).mockResolvedValue(makeForm() as any);

      const result = await checkoutFormService.createCheckoutForm(dataNoCountry);
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── getAllCheckoutForms ─────────────────────────────
  describe('getAllCheckoutForms', () => {
    it('returns all forms without filter', async () => {
      (prismaMock.checkoutForm.findMany as any).mockResolvedValue([makeForm()] as any);
      const result = await checkoutFormService.getAllCheckoutForms();
      expect(result).toHaveLength(1);
    });

    it('filters by isActive when provided', async () => {
      (prismaMock.checkoutForm.findMany as any).mockResolvedValue([makeForm()] as any);
      const result = await checkoutFormService.getAllCheckoutForms({ isActive: true });
      expect(result).toHaveLength(1);
      expect(prismaMock.checkoutForm.findMany).toHaveBeenCalled();
    });

    it('filters by isActive=false', async () => {
      (prismaMock.checkoutForm.findMany as any).mockResolvedValue([] as any);
      const result = await checkoutFormService.getAllCheckoutForms({ isActive: false });
      expect(result).toHaveLength(0);
    });
  });

  // ───────────────────────────── getCheckoutFormById ─────────────────────────────
  describe('getCheckoutFormById', () => {
    it('returns form when found', async () => {
      (prismaMock.checkoutForm.findUnique as any).mockResolvedValue(makeForm() as any);
      const result = await checkoutFormService.getCheckoutFormById('1');
      expect(result.id).toBe(1);
    });

    it('throws 404 when form not found', async () => {
      (prismaMock.checkoutForm.findUnique as any).mockResolvedValue(null);
      await expect(checkoutFormService.getCheckoutFormById('999')).rejects.toThrow(AppError);
    });
  });

  // ───────────────────────────── getCheckoutFormBySlug ─────────────────────────────
  describe('getCheckoutFormBySlug', () => {
    it('returns sanitized form when found (hides stock quantity)', async () => {
      const form = {
        ...makeForm(),
        product: {
          name: 'Test Product',
          description: 'Desc',
          price: 100,
          imageUrl: null,
          stockQuantity: 25,
        },
      };
      (prismaMock.checkoutForm.findUnique as any).mockResolvedValue(form as any);

      const result = await checkoutFormService.getCheckoutFormBySlug('test-form');
      expect(result.product).not.toHaveProperty('stockQuantity');
      expect((result.product as any).inStock).toBe(true);
    });

    it('inStock is false when stockQuantity is 0', async () => {
      const form = {
        ...makeForm(),
        product: {
          name: 'Test Product',
          description: 'Desc',
          price: 100,
          imageUrl: null,
          stockQuantity: 0,
        },
      };
      (prismaMock.checkoutForm.findUnique as any).mockResolvedValue(form as any);

      const result = await checkoutFormService.getCheckoutFormBySlug('test-form');
      expect((result.product as any).inStock).toBe(false);
    });

    it('throws 404 when form not found or inactive', async () => {
      (prismaMock.checkoutForm.findUnique as any).mockResolvedValue(null);
      await expect(checkoutFormService.getCheckoutFormBySlug('non-existent')).rejects.toThrow(AppError);
    });
  });

  // ───────────────────────────── updateCheckoutForm ─────────────────────────────
  describe('updateCheckoutForm', () => {
    it('throws 404 when form not found', async () => {
      (prismaMock.checkoutForm.findUnique as any).mockResolvedValue(null);
      await expect(checkoutFormService.updateCheckoutForm('999', {})).rejects.toThrow(AppError);
    });

    it('updates basic fields without packages or upsells', async () => {
      const existingForm = makeForm({ packages: [], upsells: [] });
      (prismaMock.checkoutForm.findUnique as any).mockResolvedValue(existingForm as any);
      (prismaMock.$transaction as any).mockImplementation(async (cb: any) => cb(prismaMock));
      (prismaMock.checkoutForm.update as any).mockResolvedValue(makeForm({ name: 'Updated' }) as any);

      const result = await checkoutFormService.updateCheckoutForm('1', { name: 'Updated' });
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── deleteCheckoutForm ─────────────────────────────
  describe('deleteCheckoutForm', () => {
    it('throws 404 when form not found', async () => {
      (prismaMock.checkoutForm.findUnique as any).mockResolvedValue(null);
      await expect(checkoutFormService.deleteCheckoutForm('999')).rejects.toThrow(AppError);
    });

    it('deletes form with cascade (packages and upsells)', async () => {
      (prismaMock.checkoutForm.findUnique as any).mockResolvedValue(makeForm() as any);
      (prismaMock.$transaction as any).mockImplementation(async (cb: any) => {
        return cb({
          checkoutFormPackage: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
          checkoutFormUpsell: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
          checkoutForm: { delete: jest.fn().mockResolvedValue(makeForm()) },
        });
      });

      const result = await checkoutFormService.deleteCheckoutForm('1');
      expect(result).toHaveProperty('message');
    });
  });

  // ───────────────────────────── getFormStats ─────────────────────────────
  describe('getFormStats', () => {
    it('throws 404 when form not found', async () => {
      (prismaMock.checkoutForm.findUnique as any).mockResolvedValue(null);
      await expect(checkoutFormService.getFormStats('999')).rejects.toThrow(AppError);
    });

    it('returns stats for existing form with no submissions', async () => {
      (prismaMock.checkoutForm.findUnique as any).mockResolvedValue(makeForm() as any);
      (prismaMock.formSubmission.count as any).mockResolvedValue(0);
      (prismaMock.formSubmission.aggregate as any).mockResolvedValue({
        _sum: { totalAmount: null },
      } as any);
      (prismaMock.formSubmission.groupBy as any).mockResolvedValue([] as any);

      const result = await checkoutFormService.getFormStats('1');
      expect(result.totalSubmissions).toBe(0);
      expect(result.totalRevenue).toBe(0);
    });
  });
});
