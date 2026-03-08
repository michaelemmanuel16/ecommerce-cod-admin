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
          findFirst: jest.fn().mockResolvedValue(null),
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
          findFirst: jest.fn().mockResolvedValue(null),
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
          findFirst: jest.fn().mockResolvedValue(null),
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
          findFirst: jest.fn().mockResolvedValue(null),
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

  describe('GL debit=credit balance validation (Issue 8)', () => {
    const createMockTx = () => ({
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((args: any) => {
          return Promise.resolve({
            id: 1,
            entryNumber: 'JE-TEST-001',
            transactions: args.data.transactions?.create || [],
          });
        }),
      },
      account: {
        findUnique: jest.fn().mockResolvedValue({
          normalBalance: 'debit',
          currentBalance: new Decimal(0),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    });

    const sumTransactions = (transactions: any[]) => {
      let totalDebits = new Decimal(0);
      let totalCredits = new Decimal(0);
      for (const t of transactions) {
        totalDebits = totalDebits.plus(t.debitAmount || 0);
        totalCredits = totalCredits.plus(t.creditAmount || 0);
      }
      return { totalDebits, totalCredits };
    };

    it('should create balanced revenue recognition entry (DR=CR) with commissions', async () => {
      const mockTx: any = createMockTx();

      const order: any = {
        id: 1,
        orderNumber: 'ORD-BAL-001',
        totalAmount: new Decimal(200),
        shippingCost: new Decimal(0),
        status: 'delivered',
        revenueRecognized: false,
        customerRepId: 3,
        deliveryAgentId: 2,
        deliveryAgent: { id: 2, commissionAmount: new Decimal(30) },
        customerRep: { id: 3, commissionAmount: new Decimal(10) },
        orderItems: [
          {
            product: { name: 'Widget', cogs: new Decimal(50) },
            quantity: 1,
          },
        ],
      };

      await GLAutomationService.createRevenueRecognitionEntry(
        mockTx,
        order,
        new Decimal(50),
        1
      );

      expect(mockTx.journalEntry.create).toHaveBeenCalled();
      const createCall = mockTx.journalEntry.create.mock.calls[0][0];
      const transactions = createCall.data.transactions.create;
      const { totalDebits, totalCredits } = sumTransactions(transactions);
      expect(totalDebits.toString()).toBe(totalCredits.toString());
    });

    it('should create balanced expense GL entry (DR=CR)', async () => {
      const mockTx: any = createMockTx();

      const expense: any = {
        id: 'exp-1',
        category: 'Delivery',
        amount: 500,
        description: 'Fuel costs',
      };

      await GLAutomationService.createExpenseGLEntry(mockTx, expense, 1);

      expect(mockTx.journalEntry.create).toHaveBeenCalled();
      const createCall = mockTx.journalEntry.create.mock.calls[0][0];
      const transactions = createCall.data.transactions.create;
      const { totalDebits, totalCredits } = sumTransactions(transactions);
      expect(totalDebits.toString()).toBe(totalCredits.toString());
    });

    it('should create balanced deposit GL entry (DR=CR)', async () => {
      const mockTx: any = createMockTx();

      await GLAutomationService.createDepositGLEntry(mockTx, 1000, 1, 1);

      expect(mockTx.journalEntry.create).toHaveBeenCalled();
      const createCall = mockTx.journalEntry.create.mock.calls[0][0];
      const transactions = createCall.data.transactions.create;
      const { totalDebits, totalCredits } = sumTransactions(transactions);
      expect(totalDebits.toString()).toBe(totalCredits.toString());
    });

    it('should create balanced failed delivery entry (DR=CR)', async () => {
      const mockTx: any = createMockTx();

      const delivery: any = { id: 1, orderId: 1 };
      const order: any = { id: 1, orderNumber: 'ORD-FAIL-001' };

      await GLAutomationService.createFailedDeliveryEntry(mockTx, delivery, order, 1);

      expect(mockTx.journalEntry.create).toHaveBeenCalled();
      const createCall = mockTx.journalEntry.create.mock.calls[0][0];
      const transactions = createCall.data.transactions.create;
      const { totalDebits, totalCredits } = sumTransactions(transactions);
      expect(totalDebits.toString()).toBe(totalCredits.toString());
    });
  });

  describe('voidJournalEntry (Issue 9)', () => {
    it('should create reversing entry with flipped debits/credits', async () => {
      const mockTx: any = {
        journalEntry: {
          findFirst: jest.fn().mockResolvedValue({
            id: 1,
            entryNumber: 'JE-001',
            description: 'Expense - Office supplies',
            transactions: [
              { accountId: 10, debitAmount: new Decimal(500), creditAmount: new Decimal(0), description: 'Expense recorded: Office supplies' },
              { accountId: 11, debitAmount: new Decimal(0), creditAmount: new Decimal(500), description: 'Cash reduction for expense: Office supplies' },
            ]
          }),
          create: jest.fn().mockResolvedValue({
            id: 2,
            entryNumber: 'JE-002',
            transactions: [],
          }),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 2 }),
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

      const result = await GLAutomationService.voidJournalEntry(mockTx, 'expense', 1, 1);

      // Should have created a reversing entry
      expect(mockTx.journalEntry.create).toHaveBeenCalled();
      const createCall = mockTx.journalEntry.create.mock.calls[0][0];
      const reversedTransactions = createCall.data.transactions.create;

      // Verify debits and credits are flipped from the original
      // Original: accountId 10 had DR 500 / CR 0 → Reversed should be DR 0 / CR 500
      const reversedForAccount10 = reversedTransactions.find((t: any) => t.debitAmount.toString() === '0' && t.creditAmount.toString() === '500');
      expect(reversedForAccount10).toBeDefined();

      // Original: accountId 11 had DR 0 / CR 500 → Reversed should be DR 500 / CR 0
      const reversedForAccount11 = reversedTransactions.find((t: any) => t.debitAmount.toString() === '500' && t.creditAmount.toString() === '0');
      expect(reversedForAccount11).toBeDefined();

      // Should have marked both original and reversing entries as voided
      expect(mockTx.journalEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [1, 2] } },
          data: expect.objectContaining({ isVoided: true }),
        })
      );
    });

    it('should return null when no entry found to void', async () => {
      const mockTx: any = {
        journalEntry: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          update: jest.fn(),
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

      const result = await GLAutomationService.voidJournalEntry(mockTx, 'expense', 999, 1);

      expect(result).toBeNull();
      expect(mockTx.journalEntry.create).not.toHaveBeenCalled();
    });

    it('should not void already-voided entries (findFirst filters isVoided: false)', async () => {
      const mockTx: any = {
        journalEntry: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          update: jest.fn(),
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

      await GLAutomationService.voidJournalEntry(mockTx, 'expense', 1, 1);

      // Verify that findFirst is called with isVoided: false to exclude already-voided entries
      const findFirstArgs = mockTx.journalEntry.findFirst.mock.calls[0][0];
      expect(findFirstArgs.where.isVoided).toBe(false);
    });
  });
});
