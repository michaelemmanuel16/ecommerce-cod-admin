import { describe, it, expect, beforeEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { CustomerService } from '../../services/customerService';
import { AppError } from '../../middleware/errorHandler';
import * as Money from '../../utils/money';

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
      prismaMock.customer.findMany.mockResolvedValue([]);

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
      prismaMock.customer.findMany.mockResolvedValue([{
        id: 2,
        phoneNumber: '+1234567890'
      } as any]);

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
      prismaMock.customer.findUnique.mockResolvedValueOnce(mockCustomer as any);
      prismaMock.customer.findMany.mockResolvedValueOnce([{ id: 3 } as any]);

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
});
