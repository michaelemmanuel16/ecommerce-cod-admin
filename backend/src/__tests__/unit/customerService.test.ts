import { describe, it, expect, beforeEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { CustomerService } from '../../services/customerService';
import { AppError } from '../../middleware/errorHandler';

describe('CustomerService', () => {
  let customerService: CustomerService;

  beforeEach(() => {
    customerService = new CustomerService();
  });

  describe('createCustomer', () => {
    const createCustomerData = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phoneNumber: '+1234567890',
      address: '123 Main St',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      area: 'Manhattan'
    };

    it('should create customer with valid data', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(null);

      const mockCustomer = {
        id: 1,
        ...createCustomerData,
        totalOrders: 0,
        totalSpent: 0,
        isActive: true,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      prismaMock.customer.create.mockResolvedValue(mockCustomer as any);

      const customer = await customerService.createCustomer(createCustomerData);

      expect(customer).toBeDefined();
      expect(customer.phoneNumber).toBe('+1234567890');
      expect(prismaMock.customer.create).toHaveBeenCalled();
    });

    it('should throw error when phone number already exists', async () => {
      prismaMock.customer.findUnique.mockResolvedValue({
        id: 2,
        phoneNumber: '+1234567890'
      } as any);

      await expect(
        customerService.createCustomer(createCustomerData)
      ).rejects.toThrow(
        new AppError('Customer with this phone number already exists', 400)
      );
    });
  });

  describe('updateCustomer', () => {
    const mockCustomer = {
      id: 1,
      firstName: 'John',
      lastName: 'Doe',
      phoneNumber: '+1234567890',
      email: 'john@example.com'
    };

    it('should update customer data successfully', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.customer.update.mockResolvedValue({
        ...mockCustomer,
        firstName: 'Jane'
      } as any);

      const updated = await customerService.updateCustomer('1', {
        firstName: 'Jane'
      });

      expect(updated.firstName).toBe('Jane');
      expect(prismaMock.customer.update).toHaveBeenCalled();
    });

    it('should throw error when customer not found', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(null);

      await expect(
        customerService.updateCustomer('1', { firstName: 'Jane' })
      ).rejects.toThrow(new AppError('Customer not found', 404));
    });

    it('should throw error when updating to duplicate phone number', async () => {
      prismaMock.customer.findUnique
        .mockResolvedValueOnce(mockCustomer as any)
        .mockResolvedValueOnce({ id: 3 } as any);

      await expect(
        customerService.updateCustomer('1', {
          phoneNumber: '+9876543210'
        })
      ).rejects.toThrow(new AppError('Phone number already in use', 400));
    });

    it('should allow updating to same phone number', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.customer.update.mockResolvedValue(mockCustomer as any);

      const updated = await customerService.updateCustomer('1', {
        phoneNumber: '+1234567890'
      });

      expect(updated).toBeDefined();
      expect(prismaMock.customer.update).toHaveBeenCalled();
    });
  });

  describe('getCustomerAnalytics', () => {
    const mockCustomer = {
      id: 1,
      firstName: 'John',
      lastName: 'Doe',
      orders: [
        {
          id: 1,
          totalAmount: 100,
          status: 'delivered',
          createdAt: new Date('2024-01-01')
        },
        {
          id: 2,
          totalAmount: 200,
          status: 'delivered',
          createdAt: new Date('2024-01-15')
        },
        {
          id: 3,
          totalAmount: 150,
          status: 'pending_confirmation',
          createdAt: new Date('2024-01-20')
        }
      ]
    };

    it('should calculate customer analytics correctly', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);

      const analytics = await customerService.getCustomerAnalytics('1');

      expect(analytics.totalOrders).toBe(3);
      expect(analytics.totalSpent).toBe(450);
      expect(analytics.avgOrderValue).toBe(150);
      expect(analytics.ordersByStatus.delivered).toBe(2);
      expect(analytics.ordersByStatus.pending_confirmation).toBe(1);
      expect(analytics.firstOrderDate).toBeDefined();
      expect(analytics.lastOrderDate).toBeDefined();
    });

    it('should throw error when customer not found', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(null);

      await expect(
        customerService.getCustomerAnalytics('1')
      ).rejects.toThrow(new AppError('Customer not found', 404));
    });

    it('should handle customer with no orders', async () => {
      prismaMock.customer.findUnique.mockResolvedValue({
        ...mockCustomer,
        orders: []
      } as any);

      const analytics = await customerService.getCustomerAnalytics('1');

      expect(analytics.totalOrders).toBe(0);
      expect(analytics.totalSpent).toBe(0);
      expect(analytics.avgOrderValue).toBe(0);
      expect(analytics.firstOrderDate).toBeNull();
      expect(analytics.lastOrderDate).toBeNull();
    });
  });

  describe('mergeCustomers', () => {
    const primaryCustomer = {
      id: 1,
      firstName: 'John',
      lastName: 'Doe',
      phoneNumber: '+1234567890',
      totalOrders: 5,
      totalSpent: 500,
      tags: ['vip']
    };

    const secondaryCustomer = {
      id: 2,
      firstName: 'John',
      lastName: 'D',
      phoneNumber: '+1234567891',
      totalOrders: 3,
      totalSpent: 300,
      tags: ['regular'],
      orders: [
        { id: 1 },
        { id: 2 },
        { id: 3 }
      ]
    };

    it('should merge customers successfully', async () => {
      prismaMock.customer.findUnique
        .mockResolvedValueOnce(primaryCustomer as any)
        .mockResolvedValueOnce(secondaryCustomer as any);

      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        return callback({
          order: {
            updateMany: jest.fn().mockResolvedValue({ count: 3 })
          },
          customer: {
            update: jest.fn()
              .mockResolvedValueOnce({
                ...primaryCustomer,
                totalOrders: 8,
                totalSpent: 800,
                tags: ['vip', 'regular']
              })
              .mockResolvedValueOnce({
                ...secondaryCustomer,
                isActive: false
              })
          }
        });
      });

      const result = await customerService.mergeCustomers('1', '2');

      expect(result.message).toBe('Customers merged successfully');
    });

    it('should throw error when primary customer not found', async () => {
      prismaMock.customer.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(secondaryCustomer as any);

      await expect(
        customerService.mergeCustomers('1', '2')
      ).rejects.toThrow(new AppError('One or both customers not found', 404));
    });

    it('should throw error when secondary customer not found', async () => {
      prismaMock.customer.findUnique
        .mockResolvedValueOnce(primaryCustomer as any)
        .mockResolvedValueOnce(null);

      await expect(
        customerService.mergeCustomers('1', '2')
      ).rejects.toThrow(new AppError('One or both customers not found', 404));
    });
  });

  describe('addCustomerTags', () => {
    const mockCustomer = {
      id: 1,
      firstName: 'John',
      lastName: 'Doe',
      tags: ['vip', 'wholesale']
    };

    it('should add new tags to existing tags', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.customer.update.mockResolvedValue({
        ...mockCustomer,
        tags: ['vip', 'wholesale', 'priority']
      } as any);

      const updated = await customerService.addCustomerTags('1', ['priority']);

      expect(updated.tags).toContain('vip');
      expect(updated.tags).toContain('wholesale');
      expect(updated.tags).toContain('priority');
    });

    it('should not duplicate existing tags', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.customer.update.mockResolvedValue(mockCustomer as any);

      const updated = await customerService.addCustomerTags('1', ['vip']);

      expect(updated.tags.filter((tag: string) => tag === 'vip')).toHaveLength(1);
    });
  });

  describe('removeCustomerTags', () => {
    const mockCustomer = {
      id: 1,
      firstName: 'John',
      lastName: 'Doe',
      tags: ['vip', 'wholesale', 'priority']
    };

    it('should remove specified tags', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.customer.update.mockResolvedValue({
        ...mockCustomer,
        tags: ['vip', 'priority']
      } as any);

      const updated = await customerService.removeCustomerTags('1', ['wholesale']);

      expect(updated.tags).not.toContain('wholesale');
      expect(updated.tags).toContain('vip');
      expect(updated.tags).toContain('priority');
    });

    it('should handle removing non-existent tags', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.customer.update.mockResolvedValue(mockCustomer as any);

      const updated = await customerService.removeCustomerTags('1', ['nonexistent']);

      expect(updated.tags).toHaveLength(3);
    });
  });

  describe('getTopCustomers', () => {
    it('should return customers sorted by spending', async () => {
      const mockCustomers = [
        { id: 'c1', firstName: 'Alice', totalSpent: 1000 },
        { id: 'c2', firstName: 'Bob', totalSpent: 800 },
        { id: 'c3', firstName: 'Charlie', totalSpent: 600 }
      ];

      prismaMock.customer.findMany.mockResolvedValue(mockCustomers as any);

      const topCustomers = await customerService.getTopCustomers(3);

      expect(topCustomers).toHaveLength(3);
      expect(topCustomers[0].totalSpent).toBeGreaterThan(topCustomers[1].totalSpent);
      expect(topCustomers[1].totalSpent).toBeGreaterThan(topCustomers[2].totalSpent);
    });

    it('should filter by city when specified', async () => {
      prismaMock.customer.findMany.mockResolvedValue([
        { id: 'c1', firstName: 'Alice', city: 'New York', totalSpent: 1000 }
      ] as any);

      const topCustomers = await customerService.getTopCustomers(10, { city: 'New York' });

      expect(topCustomers).toHaveLength(1);
      expect(topCustomers[0].city).toBe('New York');
    });
  });

  describe('searchCustomers', () => {
    it('should search customers by phone number', async () => {
      const mockCustomers = [
        {
          id: 'c1',
          firstName: 'John',
          lastName: 'Doe',
          phoneNumber: '+1234567890'
        }
      ];

      prismaMock.customer.findMany.mockResolvedValue(mockCustomers as any);

      const results = await customerService.searchCustomers('+123456');

      expect(results).toHaveLength(1);
      expect(results[0].phoneNumber).toContain('+123456');
    });

    it('should search customers by name case-insensitively', async () => {
      const mockCustomers = [
        {
          id: 'c1',
          firstName: 'John',
          lastName: 'Doe',
          phoneNumber: '+1234567890'
        }
      ];

      prismaMock.customer.findMany.mockResolvedValue(mockCustomers as any);

      const results = await customerService.searchCustomers('john');

      expect(results).toHaveLength(1);
    });

    it('should filter by area when specified', async () => {
      prismaMock.customer.findMany.mockResolvedValue([
        { id: 'c1', firstName: 'Alice', area: 'Manhattan' }
      ] as any);

      const results = await customerService.searchCustomers('alice', { area: 'Manhattan' });

      expect(results).toHaveLength(1);
      expect(results[0].area).toBe('Manhattan');
    });
  });
});
