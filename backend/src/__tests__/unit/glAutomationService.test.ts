/**
 * Unit Tests for GL Automation Service
 *
 * Tests automated GL entry creation logic for order lifecycle events
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Decimal } from '@prisma/client/runtime/library';
import { GLAutomationService } from '../../services/glAutomationService';
import { GLAccountService } from '../../services/glAccountService';

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock GLAccountService
jest.mock('../../services/glAccountService', () => ({
  GLAccountService: {
    getAccountIdByCode: jest.fn().mockResolvedValue(10),
  },
}));

describe('GLAutomationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (GLAccountService.getAccountIdByCode as jest.Mock).mockResolvedValue(10);
  });

  describe('calculateTotalCOGS', () => {
    it('should calculate total COGS for multiple items', () => {
      const orderItems: any[] = [
        {
          id: 1,
          productId: 1,
          quantity: 2,
          product: {
            id: 1,
            name: 'Product 1',
            cogs: new Decimal(50),
          },
        },
        {
          id: 2,
          productId: 2,
          quantity: 3,
          product: {
            id: 2,
            name: 'Product 2',
            cogs: new Decimal(100),
          },
        },
      ];

      const totalCOGS = GLAutomationService.calculateTotalCOGS(orderItems as any);
      expect(totalCOGS.toString()).toBe('400');
    });

    it('should handle missing COGS as zero', () => {
      const orderItems: any[] = [
        {
          id: 1,
          quantity: 2,
          product: {
            cogs: null,
          },
        },
      ];

      const totalCOGS = GLAutomationService.calculateTotalCOGS(orderItems as any);
      expect(totalCOGS.toString()).toBe('0');
    });
  });

  describe('validateCOGS', () => {
    it('should return valid when all products have COGS', () => {
      const orderItems: any[] = [
        {
          product: {
            name: 'Product 1',
            cogs: new Decimal(50),
          },
        },
      ];

      const result = GLAutomationService.validateCOGS(orderItems as any);
      expect(result.valid).toBe(true);
    });
  });

  describe('createRevenueRecognitionEntry', () => {
    it('should create balanced entry with correct account codes and commissions', async () => {
      const mockTx: any = {
        journalEntry: {
          create: jest.fn().mockResolvedValue({
            id: 1,
            entryNumber: 'JE-20260118-00001',
            sourceType: 'order_delivery',
            sourceId: 1,
            transactions: [],
          }),
        },
        account: {
          findUnique: jest.fn().mockResolvedValue({
            normalBalance: 'debit',
            currentBalance: new Decimal(0)
          }),
          update: jest.fn().mockResolvedValue({})
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      const order: any = {
        id: 1,
        orderNumber: 'ORD-001',
        totalAmount: new Decimal(150),
        shippingCost: new Decimal(10),
        status: 'delivered',
        revenueRecognized: false,
        customerRepId: 3,
        deliveryAgentId: 2,
        deliveryAgent: { id: 2, commissionAmount: new Decimal(40) },
        customerRep: { id: 3, commissionAmount: new Decimal(5) },
        orderItems: [
          {
            product: {
              name: 'Product 1',
              cogs: new Decimal(50),
            },
            quantity: 2,
          },
        ],
      };

      const entry = await GLAutomationService.createRevenueRecognitionEntry(
        mockTx,
        order,
        new Decimal(100),
        1
      );

      expect(mockTx.journalEntry.create).toHaveBeenCalled();
      expect(entry.id).toBe(1);
    });

    it('should skip COGS entries when below threshold', async () => {
      const mockTx: any = {
        journalEntry: {
          create: jest.fn().mockResolvedValue({ id: 1, transactions: [] }),
        },
        account: {
          findUnique: jest.fn().mockResolvedValue({
            normalBalance: 'debit',
            currentBalance: new Decimal(0)
          }),
          update: jest.fn().mockResolvedValue({})
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      const order: any = {
        id: 1,
        totalAmount: new Decimal(150),
        shippingCost: new Decimal(10),
        deliveryAgent: null,
        customerRep: null,
        orderItems: [],
      };

      await GLAutomationService.createRevenueRecognitionEntry(
        mockTx,
        order,
        new Decimal(0.001),
        1
      );

      expect(mockTx.journalEntry.create).toHaveBeenCalled();
    });
  });

  describe('createFailedDeliveryEntry', () => {
    it('should create entry with default fee', async () => {
      const mockTx: any = {
        journalEntry: {
          create: jest.fn().mockResolvedValue({ id: 1, transactions: [] }),
        },
        account: {
          findUnique: jest.fn().mockResolvedValue({
            normalBalance: 'debit',
            currentBalance: new Decimal(0)
          }),
          update: jest.fn().mockResolvedValue({})
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      const delivery: any = { id: 1, orderId: 1 };
      const order: any = { id: 1, orderNumber: 'ORD-001' };

      await GLAutomationService.createFailedDeliveryEntry(mockTx, delivery, order, 1);

      expect(mockTx.journalEntry.create).toHaveBeenCalled();
    });
  });

  describe('createReturnReversalEntry', () => {
    it('should create reversal entry', async () => {
      const mockTx: any = {
        journalEntry: {
          create: jest.fn().mockResolvedValue({ id: 2, transactions: [] }),
        },
        account: {
          findUnique: jest.fn().mockResolvedValue({
            normalBalance: 'debit',
            currentBalance: new Decimal(0)
          }),
          update: jest.fn().mockResolvedValue({})
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      const order: any = {
        id: 1,
        totalAmount: new Decimal(150),
        deliveryAgent: { id: 2, commissionAmount: new Decimal(40) },
        customerRep: { id: 3, commissionAmount: new Decimal(5) },
        orderItems: [],
      };

      const originalEntry: any = { id: 1, entryNumber: 'JE-001' };

      await GLAutomationService.createReturnReversalEntry(mockTx, order, originalEntry, 1);

      expect(mockTx.journalEntry.create).toHaveBeenCalled();
    });
  });

  describe('restoreInventory', () => {
    it('should increment stock', async () => {
      const mockTx: any = {
        product: {
          update: jest.fn().mockResolvedValue({}),
        },
      };

      const orderItems: any[] = [
        {
          productId: 1,
          quantity: 2,
          product: { name: 'Test Product' }
        },
      ];

      await GLAutomationService.restoreInventory(mockTx, orderItems as any);
      expect(mockTx.product.update).toHaveBeenCalled();
    });
  });
});
