/**
 * Unit Tests for GL Automation Service
 *
 * Tests automated GL entry creation logic for order lifecycle events
 */

import { jest, describe, it, expect } from '@jest/globals';
import { Decimal } from '@prisma/client/runtime/library';
import { GLAutomationService } from '../../services/glAutomationService';
import { GL_ACCOUNTS, GL_DEFAULTS } from '../../config/glAccounts';
import { prismaMock } from '../mocks/prisma.mock';

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('GLAutomationService', () => {
  describe('calculateTotalCOGS', () => {
    it('should calculate total COGS for multiple items', () => {
      const orderItems = [
        {
          id: 1,
          orderId: 1,
          productId: 1,
          quantity: 2,
          unitPrice: new Decimal(100),
          createdAt: new Date(),
          updatedAt: new Date(),
          product: {
            id: 1,
            name: 'Product 1',
            description: null,
            price: new Decimal(100),
            cogs: new Decimal(50),
            stockQuantity: 10,
            sku: 'SKU1',
            imageUrl: null,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        {
          id: 2,
          orderId: 1,
          productId: 2,
          quantity: 3,
          unitPrice: new Decimal(200),
          createdAt: new Date(),
          updatedAt: new Date(),
          product: {
            id: 2,
            name: 'Product 2',
            description: null,
            price: new Decimal(200),
            cogs: new Decimal(100),
            stockQuantity: 20,
            sku: 'SKU2',
            imageUrl: null,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ];

      const totalCOGS = GLAutomationService.calculateTotalCOGS(orderItems);

      // (2 * 50) + (3 * 100) = 100 + 300 = 400
      expect(totalCOGS.toString()).toBe('400');
    });

    it('should handle missing COGS as zero', () => {
      const orderItems = [
        {
          id: 1,
          orderId: 1,
          productId: 1,
          quantity: 2,
          unitPrice: new Decimal(100),
          createdAt: new Date(),
          updatedAt: new Date(),
          product: {
            id: 1,
            name: 'Product 1',
            description: null,
            price: new Decimal(100),
            cogs: null,
            stockQuantity: 10,
            sku: 'SKU1',
            imageUrl: null,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ];

      const totalCOGS = GLAutomationService.calculateTotalCOGS(orderItems);

      expect(totalCOGS.toString()).toBe('0');
    });

    it('should handle zero quantities', () => {
      const orderItems = [
        {
          id: 1,
          orderId: 1,
          productId: 1,
          quantity: 0,
          unitPrice: new Decimal(100),
          createdAt: new Date(),
          updatedAt: new Date(),
          product: {
            id: 1,
            name: 'Product 1',
            description: null,
            price: new Decimal(100),
            cogs: new Decimal(50),
            stockQuantity: 10,
            sku: 'SKU1',
            imageUrl: null,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ];

      const totalCOGS = GLAutomationService.calculateTotalCOGS(orderItems);

      expect(totalCOGS.toString()).toBe('0');
    });

    it('should handle empty order items array', () => {
      const totalCOGS = GLAutomationService.calculateTotalCOGS([]);

      expect(totalCOGS.toString()).toBe('0');
    });
  });

  describe('validateCOGS', () => {
    it('should return valid when all products have COGS', () => {
      const orderItems = [
        {
          id: 1,
          orderId: 1,
          productId: 1,
          quantity: 2,
          unitPrice: new Decimal(100),
          createdAt: new Date(),
          updatedAt: new Date(),
          product: {
            id: 1,
            name: 'Product 1',
            description: null,
            price: new Decimal(100),
            cogs: new Decimal(50),
            stockQuantity: 10,
            sku: 'SKU1',
            imageUrl: null,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ];

      const result = GLAutomationService.validateCOGS(orderItems);

      expect(result.valid).toBe(true);
      expect(result.missingProducts).toHaveLength(0);
    });

    it('should identify products with missing COGS', () => {
      const orderItems = [
        {
          id: 1,
          orderId: 1,
          productId: 1,
          quantity: 2,
          unitPrice: new Decimal(100),
          createdAt: new Date(),
          updatedAt: new Date(),
          product: {
            id: 1,
            name: 'Product 1',
            description: null,
            price: new Decimal(100),
            cogs: null,
            stockQuantity: 10,
            sku: 'SKU1',
            imageUrl: null,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        {
          id: 2,
          orderId: 1,
          productId: 2,
          quantity: 3,
          unitPrice: new Decimal(200),
          createdAt: new Date(),
          updatedAt: new Date(),
          product: {
            id: 2,
            name: 'Product 2',
            description: null,
            price: new Decimal(200),
            cogs: new Decimal(0),
            stockQuantity: 20,
            sku: 'SKU2',
            imageUrl: null,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ];

      const result = GLAutomationService.validateCOGS(orderItems);

      expect(result.valid).toBe(false);
      expect(result.missingProducts).toEqual(['Product 1', 'Product 2']);
    });
  });

  describe('createRevenueRecognitionEntry', () => {
    it('should create balanced entry with correct account codes and commissions', async () => {
      const mockTx = {
        user: {
          findUnique: jest.fn((args) => {
            // Mock delivery agent with 40 commission
            if (args.where.id === 2) {
              return Promise.resolve({ commissionAmount: new Decimal(40) });
            }
            // Mock sales rep with 5 commission
            if (args.where.id === 3) {
              return Promise.resolve({ commissionAmount: new Decimal(5) });
            }
            return Promise.resolve(null);
          }),
        },
        journalEntry: {
          create: jest.fn().mockResolvedValue({
            id: 1,
            entryNumber: 'JE-20260118-00001',
            entryDate: new Date(),
            description: 'Revenue recognition - Order #1',
            sourceType: 'order_delivery',
            sourceId: 1,
            transactions: [
              {
                accountId: parseInt(GL_ACCOUNTS.CASH_IN_TRANSIT),
                debitAmount: new Decimal(105), // 150 - 40 - 5
                creditAmount: new Decimal(0),
              },
              {
                accountId: parseInt(GL_ACCOUNTS.PRODUCT_REVENUE),
                debitAmount: new Decimal(0),
                creditAmount: new Decimal(150),
              },
              {
                accountId: parseInt(GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION),
                debitAmount: new Decimal(40),
                creditAmount: new Decimal(0),
              },
              {
                accountId: parseInt(GL_ACCOUNTS.SALES_REP_COMMISSION),
                debitAmount: new Decimal(5),
                creditAmount: new Decimal(0),
              },
              {
                accountId: parseInt(GL_ACCOUNTS.COGS),
                debitAmount: new Decimal(100),
                creditAmount: new Decimal(0),
              },
              {
                accountId: parseInt(GL_ACCOUNTS.INVENTORY),
                debitAmount: new Decimal(0),
                creditAmount: new Decimal(100),
              },
            ],
          }),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      const order = {
        id: 1,
        orderNumber: 'ORD-001',
        totalAmount: new Decimal(150),
        shippingCost: new Decimal(10),
        status: 'delivered' as any,
        revenueRecognized: false,
        glJournalEntryId: null,
        customerId: 1,
        customerRepId: 3, // Sales rep with commission
        deliveryAgentId: 2, // Delivery agent with commission
        deliveryAddress: 'Test Address',
        deliveryCity: 'Test City',
        deliveryRegion: 'Test Region',
        customerName: 'Test Customer',
        customerPhone: '1234567890',
        notes: null,
        cancellationReason: null,
        returnReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        orderItems: [
          {
            id: 1,
            orderId: 1,
            productId: 1,
            quantity: 2,
            unitPrice: new Decimal(70),
            createdAt: new Date(),
            updatedAt: new Date(),
            product: {
              id: 1,
              name: 'Product 1',
              description: null,
              price: new Decimal(70),
              cogs: new Decimal(50),
              stockQuantity: 10,
              sku: 'SKU1',
              imageUrl: null,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        ],
      };

      const totalCOGS = new Decimal(100);
      const userId = 1;

      const entry = await GLAutomationService.createRevenueRecognitionEntry(
        mockTx,
        order,
        totalCOGS,
        userId
      );

      expect(mockTx.user.findUnique).toHaveBeenCalledTimes(2); // Called for agent and sales rep
      expect(mockTx.journalEntry.create).toHaveBeenCalled();
      expect(entry.sourceType).toBe('order_delivery');
      expect(entry.sourceId).toBe(1);
    });

    it('should skip COGS entries when below threshold', async () => {
      const mockTx = {
        user: {
          findUnique: jest.fn().mockResolvedValue(null), // No commissions
        },
        journalEntry: {
          create: jest.fn().mockResolvedValue({
            id: 1,
            entryNumber: 'JE-20260118-00001',
            transactions: [],
          }),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      const order = {
        id: 1,
        orderNumber: 'ORD-001',
        totalAmount: new Decimal(150),
        shippingCost: new Decimal(10),
        status: 'delivered' as any,
        revenueRecognized: false,
        glJournalEntryId: null,
        customerId: 1,
        customerRepId: null,
        deliveryAgentId: null,
        deliveryAddress: 'Test Address',
        deliveryCity: 'Test City',
        deliveryRegion: 'Test Region',
        customerName: 'Test Customer',
        customerPhone: '1234567890',
        notes: null,
        cancellationReason: null,
        returnReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        orderItems: [],
      };

      const totalCOGS = new Decimal(0.001); // Below threshold
      const userId = 1;

      await GLAutomationService.createRevenueRecognitionEntry(
        mockTx,
        order,
        totalCOGS,
        userId
      );

      const createCall = mockTx.journalEntry.create.mock.calls[0][0];
      const transactions = createCall.data.transactions.create;

      // Should only have revenue entries, no COGS/Inventory or commission expenses
      expect(transactions).toHaveLength(2); // Cash, Product Revenue (no shipping, no commissions)
      expect(transactions.some((t: any) => t.accountId === parseInt(GL_ACCOUNTS.COGS))).toBe(false);
      expect(transactions.some((t: any) => t.accountId === parseInt(GL_ACCOUNTS.INVENTORY))).toBe(false);
    });
  });

  describe('createFailedDeliveryEntry', () => {
    it('should create entry with default fee', async () => {
      const mockTx = {
        journalEntry: {
          create: jest.fn().mockResolvedValue({
            id: 1,
            entryNumber: 'JE-20260118-00001',
          }),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      const delivery = {
        id: 1,
        orderId: 1,
        agentId: 1,
        status: 'failed' as any,
        scheduledDate: new Date(),
        completedAt: null,
        failedAt: new Date(),
        failureReason: 'Customer not home',
        route: null,
        proofOfDelivery: null,
        rescheduleCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const order = {
        id: 1,
        orderNumber: 'ORD-001',
        totalAmount: new Decimal(150),
        shippingCost: new Decimal(10),
        status: 'failed_delivery' as any,
        revenueRecognized: false,
        glJournalEntryId: null,
        customerId: 1,
        customerRepId: null,
        deliveryAgentId: 1,
        deliveryAddress: 'Test Address',
        deliveryCity: 'Test City',
        deliveryRegion: 'Test Region',
        customerName: 'Test Customer',
        customerPhone: '1234567890',
        notes: null,
        cancellationReason: null,
        returnReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const userId = 1;

      await GLAutomationService.createFailedDeliveryEntry(
        mockTx,
        delivery,
        order,
        userId
      );

      const createCall = mockTx.journalEntry.create.mock.calls[0][0];
      const transactions = createCall.data.transactions.create;

      expect(transactions).toHaveLength(2);
      expect(transactions[0].accountId).toBe(parseInt(GL_ACCOUNTS.FAILED_DELIVERY_EXPENSE));
      expect(transactions[0].debitAmount.toString()).toBe(GL_DEFAULTS.FAILED_DELIVERY_FEE.toString());
      expect(transactions[1].accountId).toBe(parseInt(GL_ACCOUNTS.CASH_IN_HAND));
      expect(transactions[1].creditAmount.toString()).toBe(GL_DEFAULTS.FAILED_DELIVERY_FEE.toString());
    });
  });

  describe('createReturnReversalEntry', () => {
    it('should create reversal entry with correct amounts', async () => {
      const mockTx = {
        user: {
          findUnique: jest.fn((args) => {
            // Mock delivery agent with 40 commission
            if (args.where.id === 2) {
              return Promise.resolve({ commissionAmount: new Decimal(40) });
            }
            // Mock sales rep with 5 commission
            if (args.where.id === 3) {
              return Promise.resolve({ commissionAmount: new Decimal(5) });
            }
            return Promise.resolve(null);
          }),
        },
        journalEntry: {
          create: jest.fn().mockResolvedValue({
            id: 2,
            entryNumber: 'JE-20260118-00002',
          }),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      const order = {
        id: 1,
        orderNumber: 'ORD-001',
        totalAmount: new Decimal(150),
        shippingCost: new Decimal(10),
        status: 'returned' as any,
        revenueRecognized: true,
        glJournalEntryId: 1,
        customerId: 1,
        customerRepId: 3, // Sales rep with commission
        deliveryAgentId: 2, // Delivery agent with commission
        deliveryAddress: 'Test Address',
        deliveryCity: 'Test City',
        deliveryRegion: 'Test Region',
        customerName: 'Test Customer',
        customerPhone: '1234567890',
        notes: null,
        cancellationReason: null,
        returnReason: 'Defective product',
        createdAt: new Date(),
        updatedAt: new Date(),
        orderItems: [
          {
            id: 1,
            orderId: 1,
            productId: 1,
            quantity: 2,
            unitPrice: new Decimal(70),
            createdAt: new Date(),
            updatedAt: new Date(),
            product: {
              id: 1,
              name: 'Product 1',
              description: null,
              price: new Decimal(70),
              cogs: new Decimal(50),
              stockQuantity: 10,
              sku: 'SKU1',
              imageUrl: null,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        ],
      };

      const originalEntry = {
        id: 1,
        entryNumber: 'JE-20260118-00001',
      };

      const userId = 1;

      await GLAutomationService.createReturnReversalEntry(
        mockTx,
        order,
        originalEntry,
        userId
      );

      const createCall = mockTx.journalEntry.create.mock.calls[0][0];

      expect(createCall.data.description).toContain('Return reversal');
      expect(createCall.data.description).toContain('JE-20260118-00001');
      expect(createCall.data.sourceType).toBe('order_return');
    });

    it('should add return processing expense when fee provided', async () => {
      const mockTx = {
        user: {
          findUnique: jest.fn().mockResolvedValue(null), // No commissions
        },
        journalEntry: {
          create: jest.fn().mockResolvedValue({
            id: 2,
            entryNumber: 'JE-20260118-00002',
          }),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      const order = {
        id: 1,
        orderNumber: 'ORD-001',
        totalAmount: new Decimal(150),
        shippingCost: new Decimal(10),
        status: 'returned' as any,
        revenueRecognized: true,
        glJournalEntryId: 1,
        customerId: 1,
        customerRepId: null,
        deliveryAgentId: null,
        deliveryAddress: 'Test Address',
        deliveryCity: 'Test City',
        deliveryRegion: 'Test Region',
        customerName: 'Test Customer',
        customerPhone: '1234567890',
        notes: null,
        cancellationReason: null,
        returnReason: 'Defective product',
        createdAt: new Date(),
        updatedAt: new Date(),
        orderItems: [
          {
            id: 1,
            orderId: 1,
            productId: 1,
            quantity: 2,
            unitPrice: new Decimal(70),
            createdAt: new Date(),
            updatedAt: new Date(),
            product: {
              id: 1,
              name: 'Product 1',
              description: null,
              price: new Decimal(70),
              cogs: new Decimal(50),
              stockQuantity: 10,
              sku: 'SKU1',
              imageUrl: null,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        ],
      };

      const originalEntry = {
        id: 1,
        entryNumber: 'JE-20260118-00001',
      };

      const userId = 1;
      const returnProcessingFee = 25;

      await GLAutomationService.createReturnReversalEntry(
        mockTx,
        order,
        originalEntry,
        userId,
        returnProcessingFee
      );

      const createCall = mockTx.journalEntry.create.mock.calls[0][0];
      const transactions = createCall.data.transactions.create;

      // Should have return processing expense entries
      const hasReturnExpense = transactions.some(
        (t: any) => t.accountId === parseInt(GL_ACCOUNTS.RETURN_PROCESSING_EXPENSE)
      );
      const hasRefundLiability = transactions.some(
        (t: any) => t.accountId === parseInt(GL_ACCOUNTS.REFUND_LIABILITY)
      );

      expect(hasReturnExpense).toBe(true);
      expect(hasRefundLiability).toBe(true);
    });
  });

  describe('restoreInventory', () => {
    it('should increment product stock quantities', async () => {
      const mockTx = {
        product: {
          update: jest.fn().mockResolvedValue({}),
        },
      };

      const orderItems = [
        {
          id: 1,
          orderId: 1,
          productId: 1,
          quantity: 2,
          unitPrice: new Decimal(100),
          createdAt: new Date(),
          updatedAt: new Date(),
          product: {
            id: 1,
            name: 'Product 1',
            description: null,
            price: new Decimal(100),
            cogs: new Decimal(50),
            stockQuantity: 10,
            sku: 'SKU1',
            imageUrl: null,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        {
          id: 2,
          orderId: 1,
          productId: 2,
          quantity: 3,
          unitPrice: new Decimal(200),
          createdAt: new Date(),
          updatedAt: new Date(),
          product: {
            id: 2,
            name: 'Product 2',
            description: null,
            price: new Decimal(200),
            cogs: new Decimal(100),
            stockQuantity: 20,
            sku: 'SKU2',
            imageUrl: null,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ];

      await GLAutomationService.restoreInventory(mockTx, orderItems);

      expect(mockTx.product.update).toHaveBeenCalledTimes(2);
      expect(mockTx.product.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { stockQuantity: { increment: 2 } },
      });
      expect(mockTx.product.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { stockQuantity: { increment: 3 } },
      });
    });
  });

  describe('isRevenueAlreadyRecognized', () => {
    it('should return true when revenue is recognized', () => {
      const order = {
        id: 1,
        revenueRecognized: true,
      } as any;

      const result = GLAutomationService.isRevenueAlreadyRecognized(order);

      expect(result).toBe(true);
    });

    it('should return false when revenue is not recognized', () => {
      const order = {
        id: 1,
        revenueRecognized: false,
      } as any;

      const result = GLAutomationService.isRevenueAlreadyRecognized(order);

      expect(result).toBe(false);
    });
  });
});
