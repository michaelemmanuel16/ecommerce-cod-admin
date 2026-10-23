/**
 * Extended CustomerService tests to boost branch coverage
 * Focuses on methods and branches not in the main customerService.test.ts
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prismaMock } from '../mocks/prisma.mock';
import { CustomerService } from '../../services/customerService';
import { AppError } from '../../middleware/errorHandler';
import { useTestTenant } from '../mocks/tenant.mock';

const adminRequester = { id: 1, role: 'admin', tenantId: 'tenant-1' };
const salesRepRequester = { id: 10, role: 'sales_rep', tenantId: 'tenant-1' };
const managerRequester = { id: 2, role: 'manager', tenantId: 'tenant-1' };

const makeCustomer = (overrides: any = {}) => ({
  id: 1,
  firstName: 'Ama',
  lastName: 'Boateng',
  phoneNumber: '+233201234567',
  alternatePhone: null,
  email: 'ama@example.com',
  address: '10 Ring Road',
  state: 'Greater Accra',
  area: 'Accra Central',
  zipCode: null,
  landmark: null,
  tags: [],
  notes: null,
  isActive: true,
  totalOrders: 5,
  totalSpent: 500,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  orders: [],
  ...overrides,
});

describe('CustomerService (extended branch coverage)', () => {
  useTestTenant();
  let customerService: CustomerService;

  beforeEach(() => {
    jest.clearAllMocks();
    // The "not reachable" lookup (raw SQL) finds nobody
    (prismaMock.$queryRaw as any).mockResolvedValue([] as any);
    customerService = new CustomerService();
  });

  // ───────────────────────────── getAllCustomers ─────────────────────────────
  describe('getAllCustomers - branch coverage', () => {
    beforeEach(() => {
      (prismaMock.customer.findMany as any).mockResolvedValue([] as any);
      (prismaMock.customer.count as any).mockResolvedValue(0);
    });

    it('returns all customers for admin with no filters', async () => {
      const result = await customerService.getAllCustomers({}, adminRequester as any);
      expect(result.pagination.total).toBe(0);
    });

    it('applies search filter', async () => {
      const customer = makeCustomer();
      (prismaMock.customer.findMany as any).mockResolvedValue([customer] as any);
      (prismaMock.customer.count as any).mockResolvedValue(1);

      const result = await customerService.getAllCustomers({ search: 'Ama' });
      expect(result.customers).toHaveLength(1);
    });

    it('applies area filter', async () => {
      await customerService.getAllCustomers({ area: 'Accra Central' });
      expect(prismaMock.customer.findMany).toHaveBeenCalled();
    });

    it('applies tags filter', async () => {
      await customerService.getAllCustomers({ tags: ['vip', 'loyal'] });
      expect(prismaMock.customer.findMany).toHaveBeenCalled();
    });

    it('scopes customers for non-admin/non-manager requesters (sales_rep)', async () => {
      await customerService.getAllCustomers({}, salesRepRequester as any);
      expect(prismaMock.customer.findMany).toHaveBeenCalled();
    });

    it('returns the stored stats with the derived risk and COD block', async () => {
      const customer = makeCustomer({ totalOrders: 2, refusedOrders: 3, deliveredValue: 300 });
      (prismaMock.customer.findMany as any).mockResolvedValue([customer] as any);
      (prismaMock.customer.count as any).mockResolvedValue(1);

      const result = await customerService.getAllCustomers({});
      expect(result.customers[0]).toMatchObject({ totalOrders: 2, risk: 'high', codBlocked: true, notReachable: false });
    });

    it('calculates correct pagination', async () => {
      (prismaMock.customer.count as any).mockResolvedValue(50);
      const result = await customerService.getAllCustomers({ page: 3, limit: 10 });
      expect(result.pagination.pages).toBe(5);
    });
  });

  // ───────────────────────────── getCustomerById ─────────────────────────────
  describe('getCustomerById', () => {
    it('throws 400 for non-numeric customer ID', async () => {
      await expect(customerService.getCustomerById('abc')).rejects.toThrow(AppError);
    });

    it('throws 404 when customer not found', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(null);
      await expect(customerService.getCustomerById('999')).rejects.toThrow(AppError);
    });

    it('returns customer for admin without permission check', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(makeCustomer() as any);
      const result = await customerService.getCustomerById('1', adminRequester as any);
      expect(result.id).toBe(1);
    });

    it('returns customer without requester (no permission check)', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(makeCustomer() as any);
      const result = await customerService.getCustomerById('1');
      expect(result.id).toBe(1);
    });

    it('throws 403 for sales_rep who did not create the customer and has no order with them', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(makeCustomer() as any);
      (prismaMock.customer.count as any).mockResolvedValue(0);

      await expect(customerService.getCustomerById('1', salesRepRequester as any)).rejects.toThrow(AppError);
    });

    it('returns customer for sales_rep inside the row scope', async () => {
      const customer = makeCustomer();
      (prismaMock.customer.findUnique as any).mockResolvedValue(customer as any);
      (prismaMock.customer.count as any).mockResolvedValue(1);
      (prismaMock.order.findMany as any).mockResolvedValue([{ id: 1, status: 'delivered', totalAmount: 100, createdAt: new Date() }] as any);

      const result = await customerService.getCustomerById('1', salesRepRequester as any);
      expect(result.id).toBe(1);
    });
  });

  // ───────────────────────────── getCustomerByPhone ─────────────────────────────
  describe('getCustomerByPhone', () => {
    it('returns null when customer not found', async () => {
      (prismaMock.customer.findFirst as any).mockResolvedValue(null);
      const result = await customerService.getCustomerByPhone('+233000000000');
      expect(result).toBeNull();
    });

    it('returns customer for admin', async () => {
      (prismaMock.customer.findFirst as any).mockResolvedValue(makeCustomer({ orders: [] }) as any);
      const result = await customerService.getCustomerByPhone('+233201234567', adminRequester as any);
      expect(result).toBeDefined();
    });

    it('throws 403 for sales_rep without order access to customer', async () => {
      const customer = makeCustomer({
        orders: [{ id: 1, customerRepId: 99, deliveryAgentId: null }],
      });
      (prismaMock.customer.findFirst as any).mockResolvedValue(customer as any);

      await expect(
        customerService.getCustomerByPhone('+233201234567', salesRepRequester as any)
      ).rejects.toThrow(AppError);
    });

    it('returns customer for sales_rep assigned to one of customer orders', async () => {
      const customer = makeCustomer({
        orders: [{ id: 1, customerRepId: 10, deliveryAgentId: null }],
      });
      (prismaMock.customer.findFirst as any).mockResolvedValue(customer as any);

      const result = await customerService.getCustomerByPhone('+233201234567', salesRepRequester as any);
      expect(result).toBeDefined();
    });

    it('returns customer without requester (no access check)', async () => {
      (prismaMock.customer.findFirst as any).mockResolvedValue(makeCustomer({ orders: [] }) as any);
      const result = await customerService.getCustomerByPhone('+233201234567');
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── updateCustomer ─────────────────────────────
  describe('updateCustomer', () => {
    it('throws 400 for invalid customer ID', async () => {
      await expect(customerService.updateCustomer('abc', {})).rejects.toThrow(AppError);
    });

    it('throws 404 when customer not found', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(null);
      await expect(customerService.updateCustomer('999', {})).rejects.toThrow(AppError);
    });

    it('throws 403 for sales_rep outside the row scope', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(makeCustomer() as any);
      (prismaMock.customer.count as any).mockResolvedValue(0);

      await expect(
        customerService.updateCustomer('1', { firstName: 'Kofi' }, salesRepRequester as any)
      ).rejects.toThrow(AppError);
    });

    it('updates without requester (no permission check)', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(makeCustomer() as any);
      (prismaMock.customer.update as any).mockResolvedValue(makeCustomer({ firstName: 'Kofi' }) as any);

      const result = await customerService.updateCustomer('1', { firstName: 'Kofi' });
      expect(result.firstName).toBe('Kofi');
    });

    it('updates with admin requester and creates audit log', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(makeCustomer() as any);
      (prismaMock.customer.update as any).mockResolvedValue(makeCustomer({ firstName: 'Kwame' }) as any);
      (prismaMock.auditLog.create as any).mockResolvedValue({} as any);

      const result = await customerService.updateCustomer('1', { firstName: 'Kwame' }, adminRequester as any);
      expect(result.firstName).toBe('Kwame');
      expect(prismaMock.auditLog.create).toHaveBeenCalled();
    });
  });

  // ───────────────────────────── deleteCustomer ─────────────────────────────
  describe('deleteCustomer', () => {
    it('throws 400 for invalid customer ID', async () => {
      await expect(customerService.deleteCustomer('abc')).rejects.toThrow(AppError);
    });

    it('throws 404 when customer not found', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(null);
      await expect(customerService.deleteCustomer('999')).rejects.toThrow(AppError);
    });

    it('deactivates customer without requester', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(makeCustomer() as any);
      (prismaMock.customer.update as any).mockResolvedValue({} as any);

      const result = await customerService.deleteCustomer('1');
      expect(result).toHaveProperty('message');
    });

    it('deactivates customer with admin requester and creates audit log', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(makeCustomer() as any);
      (prismaMock.customer.update as any).mockResolvedValue({} as any);
      (prismaMock.auditLog.create as any).mockResolvedValue({} as any);

      const result = await customerService.deleteCustomer('1', adminRequester as any);
      expect(result).toHaveProperty('message');
      expect(prismaMock.auditLog.create).toHaveBeenCalled();
    });
  });
});
