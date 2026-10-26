import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock server module to prevent it from starting
jest.mock('../../server', () => {
  const m = {
    emit: jest.fn(),
    to: jest.fn(),
  };
  m.to.mockReturnValue(m);
  return { io: m };
});

// Mock GLAutomationService to prevent GL account DB lookups in unit tests
jest.mock('../../services/glAutomationService', () => ({
  GLAutomationService: {
    createExpenseGLEntry: jest.fn().mockResolvedValue({ id: 1, entryNumber: 'JE-001' }),
    createDepositGLEntry: jest.fn().mockResolvedValue({ id: 2, entryNumber: 'JE-002' }),
    voidJournalEntry: jest.fn().mockResolvedValue(null),
  },
}));
// Automock the KPI functions; revenueScope is a pure mapping the callers use as is.
jest.mock('../../services/kpi/revenue', () => ({
  ...jest.createMockFromModule<object>('../../services/kpi/revenue'),
  revenueScope: jest.requireActual<typeof import('../../services/kpi/revenue')>('../../services/kpi/revenue').revenueScope,
}));
import { prismaMock } from '../mocks/prisma.mock';
import { useTestTenant, TEST_TENANT_ID } from '../mocks/tenant.mock';
import { revenueResult } from '../mocks/kpiResults';
import { deliveredRevenue } from '../../services/kpi/revenue';
import { FinancialService } from '../../services/financialService';
import { AppError } from '../../middleware/errorHandler';
import { PaymentStatus } from '@prisma/client';
import * as Money from '../../utils/money';

describe('FinancialService', () => {
  let financialService: FinancialService;
  useTestTenant();

  beforeEach(() => {
    financialService = new FinancialService();
    // Default $transaction mock: executes the callback with prismaMock as the tx
    (prismaMock.$transaction as any).mockImplementation(async (callback: any) => {
      return callback(prismaMock);
    });
  });

  describe('getFinancialSummary', () => {
    it('reads revenue from the KPI layer and digital revenue, Paystack fees and expenses from the GL', async () => {
      (deliveredRevenue as jest.MockedFunction<typeof deliveredRevenue>).mockResolvedValue(revenueResult('10000.00', 40));

      // Mock GL account aggregations (digital revenue and expense accounts)
      prismaMock.accountTransaction.groupBy.mockResolvedValue([
        { accountId: 11, _sum: { debitAmount: 0, creditAmount: 1500 } },    // Digital Revenue 4020 (credit normal)
        { accountId: 20, _sum: { debitAmount: 2000, creditAmount: 0 } },    // COGS (debit normal)
        { accountId: 21, _sum: { debitAmount: 60, creditAmount: 0 } },      // Paystack fees 5060 (debit normal)
      ] as any);

      // Mock account metadata
      prismaMock.account.findMany.mockResolvedValue([
        { id: 11, code: '4020', normalBalance: 'credit', accountType: 'revenue' },
        { id: 20, code: '5010', normalBalance: 'debit', accountType: 'expense' },
        { id: 21, code: '5060', normalBalance: 'debit', accountType: 'expense' },
      ] as any);

      // Mock AgentCollection aggregate for outstanding receivables
      (prismaMock as any).agentCollection = {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 500 } })
      };

      // Mock COD collections and pipeline revenue
      prismaMock.transaction.aggregate.mockResolvedValue({
        _sum: { amount: 9500 }
      } as any);

      prismaMock.order.aggregate.mockResolvedValue({
        _sum: { totalAmount: 500 }
      } as any);

      const summary = await financialService.getFinancialSummary({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31T23:59:59.999Z')
      });

      expect(Money.toApi(summary.totalRevenue)).toBe('10000.00');
      expect(Money.toApi(summary.digitalRevenue)).toBe('1500.00');
      expect(Money.toApi(summary.paystackFees)).toBe('60.00');
      expect(Money.toApi(summary.totalExpenses)).toBe('2060.00'); // COGS 2000 + Paystack fees 60
      expect(Money.toApi(summary.profit)).toBe('7940.00');
      expect(Money.toApi(summary.codCollected)).toBe('9500.00');
      expect(Money.toApi(summary.outstandingReceivables)).toBe('500.00');
      expect(summary.profitMargin).toBe(79.4);

      // The KPI range is the store day range [1 Jan, end of 31 Jan]: the end-of-day bound plus 1 ms.
      const [tenantId, from, to, scope] = (deliveredRevenue as jest.MockedFunction<typeof deliveredRevenue>).mock.calls[0];
      expect(tenantId).toBe(TEST_TENANT_ID);
      expect(from).toEqual(new Date('2024-01-01'));
      expect(to.getTime()).toBe(new Date('2024-01-31T23:59:59.999Z').getTime() + 1);
      expect(scope).toEqual({ customerRepId: undefined, deliveryAgentId: undefined });
    });

    it('scopes the KPI revenue to a sales rep', async () => {
      (deliveredRevenue as jest.MockedFunction<typeof deliveredRevenue>).mockResolvedValue(revenueResult('0.00', 0));
      prismaMock.accountTransaction.groupBy.mockResolvedValue([] as any);
      prismaMock.account.findMany.mockResolvedValue([] as any);
      (prismaMock as any).agentCollection = { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) };
      prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amount: null } } as any);
      prismaMock.order.aggregate.mockResolvedValue({ _sum: { totalAmount: null } } as any);

      await financialService.getFinancialSummary({}, { id: 9, role: 'sales_rep' } as any);

      expect((deliveredRevenue as jest.MockedFunction<typeof deliveredRevenue>).mock.calls[0][3]).toEqual({ customerRepId: 9, deliveryAgentId: undefined });
    });

    it('should handle null/empty GL data', async () => {
      (deliveredRevenue as jest.MockedFunction<typeof deliveredRevenue>).mockResolvedValue(revenueResult('0.00', 0));
      prismaMock.journalEntry.findMany.mockResolvedValue([] as any);
      prismaMock.accountTransaction.groupBy.mockResolvedValue([] as any);
      prismaMock.account.findMany.mockResolvedValue([] as any);
      (prismaMock as any).agentCollection = {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } })
      };
      prismaMock.transaction.aggregate.mockResolvedValue({
        _sum: { amount: null }
      } as any);
      prismaMock.order.aggregate.mockResolvedValue({
        _sum: { totalAmount: null }
      } as any);

      const summary = await financialService.getFinancialSummary({});

      expect(Money.toApi(summary.totalRevenue)).toBe('0.00');
      expect(Money.toApi(summary.digitalRevenue)).toBe('0.00');
      expect(Money.toApi(summary.paystackFees)).toBe('0.00');
      expect(Money.toApi(summary.totalExpenses)).toBe('0.00');
      expect(Money.toApi(summary.profit)).toBe('0.00');
      expect(summary.profitMargin).toBe(0);
    });
  });

  describe('recordExpense', () => {
    const expenseData = {
      category: 'Delivery',
      amount: 500,
      description: 'Fuel costs',
      expenseDate: new Date('2024-01-15'),
      recordedBy: 'user-1',
      receiptUrl: 'https://example.com/receipt.pdf'
    };

    it('should record expense successfully', async () => {
      const mockExpense = {
        id: 'expense-1',
        ...expenseData,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      prismaMock.expense.create.mockResolvedValue(mockExpense as any);

      const expense = await financialService.recordExpense(expenseData);

      expect(expense).toBeDefined();
      expect(expense.category).toBe('Delivery');
      expect(expense.amount).toBe(500);
      expect(prismaMock.expense.create).toHaveBeenCalled();
    });
  });

  describe('getCODCollectionsByAgent', () => {
    it('should get COD collections for specific agent', async () => {
      const mockCollections = [
        {
          id: 'trans-1',
          type: 'cod_collection',
          amount: 100,
          status: 'collected',
          order: {
            orderNumber: '1001',
            customer: {
              firstName: 'John',
              lastName: 'Doe'
            }
          }
        },
        {
          id: 'trans-2',
          type: 'cod_collection',
          amount: 200,
          status: 'collected',
          order: {
            orderNumber: '1002',
            customer: {
              firstName: 'Jane',
              lastName: 'Smith'
            }
          }
        }
      ];

      prismaMock.transaction.findMany.mockResolvedValue(mockCollections as any);

      prismaMock.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 300 } } as any) // totalCollected
        .mockResolvedValueOnce({ _sum: { amount: 0 } } as any) // totalPending
        .mockResolvedValueOnce({ _sum: { amount: 0 } } as any); // totalDeposited

      const requester = { id: 1, role: 'admin' };
      const result = await financialService.getCODCollectionsByAgent('1', undefined, requester as any);

      expect(result.collections).toHaveLength(2);
      expect(Money.toApi(result.summary.totalCollected)).toBe('300.00');
      expect(result.summary.totalCount).toBe(2);
    });

    it('should filter by date range when provided', async () => {
      prismaMock.transaction.findMany.mockResolvedValue([]);
      prismaMock.transaction.aggregate.mockResolvedValue({
        _sum: { amount: 0 }
      } as any);

      await financialService.getCODCollectionsByAgent('agent-1', {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31')
      });

      const callArgs = (prismaMock.transaction.findMany as any).mock.calls[0][0];
      expect(callArgs.where.createdAt).toBeDefined();
      expect(callArgs.where.createdAt.gte).toBeDefined();
      expect(callArgs.where.createdAt.lte).toBeDefined();
    });
  });

  describe('reconcileTransaction', () => {
    const mockTransaction = {
      id: 'trans-1',
      type: 'cod_collection',
      amount: 210,
      status: 'collected' as PaymentStatus,
      orderId: 'order-1',
      metadata: {}
    };

    it('should reconcile transaction successfully', async () => {
      prismaMock.transaction.findUnique.mockResolvedValue(mockTransaction as any);
      prismaMock.transaction.update.mockResolvedValue({
        ...mockTransaction,
        status: 'reconciled' as PaymentStatus
      } as any);
      prismaMock.order.update.mockResolvedValue({} as any);

      const reconcileData = {
        transactionId: 'trans-1',
        status: 'reconciled' as PaymentStatus,
        reference: 'REF-123',
        notes: 'Reconciled on bank statement'
      };

      const requester = { id: 1, role: 'admin' };
      const result = await financialService.reconcileTransaction(reconcileData, requester as any);

      expect(result.status).toBe('reconciled');
      expect(prismaMock.transaction.update).toHaveBeenCalled();
      expect(prismaMock.order.update).toHaveBeenCalled();
    });

    it('should throw error when transaction not found', async () => {
      prismaMock.transaction.findUnique.mockResolvedValue(null);

      await expect(
        financialService.reconcileTransaction({
          transactionId: 'trans-1',
          status: 'reconciled' as PaymentStatus
        })
      ).rejects.toThrow(new AppError('Transaction not found', 404));
    });

    it('should update order payment status', async () => {
      prismaMock.transaction.findUnique.mockResolvedValue(mockTransaction as any);
      prismaMock.transaction.update.mockResolvedValue({
        ...mockTransaction,
        status: 'deposited' as PaymentStatus
      } as any);

      let updatedPaymentStatus: string | undefined;
      prismaMock.order.update.mockImplementation((args: any) => {
        updatedPaymentStatus = args.data.paymentStatus;
        return Promise.resolve({} as any);
      });

      const requester = { id: 1, role: 'admin' };
      await financialService.reconcileTransaction({
        transactionId: 'trans-1',
        status: 'deposited' as PaymentStatus
      }, requester as any);

      expect(updatedPaymentStatus).toBe('deposited');
    });
  });

  describe('markCODAsDeposited', () => {
    it('should mark multiple transactions as deposited', async () => {
      const transactionIds = ['1', '2'];
      const mockTransactions = [
        { id: 1, type: 'cod_collection', status: 'collected', orderId: 101, amount: 100 },
        { id: 2, type: 'cod_collection', status: 'collected', orderId: 102, amount: 200 }
      ];

      prismaMock.transaction.findMany.mockResolvedValue(mockTransactions as any);
      prismaMock.transaction.updateMany.mockResolvedValue({ count: 2 } as any);
      prismaMock.order.updateMany.mockResolvedValue({ count: 2 } as any);
      // No reconciled collections — GL deposit entry will be created
      (prismaMock as any).agentCollection = {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([])
      };
      (prismaMock as any).journalEntry = { findMany: jest.fn().mockResolvedValue([]) };

      const requester = { id: 1, role: 'admin' };
      const result = await financialService.markCODAsDeposited(
        transactionIds,
        'DEP-2024-001',
        requester as any
      );

      expect(result.message).toContain('2 transactions marked as deposited');
      expect(result.count).toBe(2);
      expect(prismaMock.transaction.updateMany).toHaveBeenCalled();
    });

    it('should throw error when no transaction IDs provided', async () => {
      await expect(
        financialService.markCODAsDeposited([])
      ).rejects.toThrow(new AppError('No transaction IDs provided', 400));
    });

    it('should only update collected transactions via findMany verification', async () => {
      prismaMock.transaction.findMany.mockResolvedValue([]);

      await expect(
        financialService.markCODAsDeposited(['1'])
      ).rejects.toThrow(new AppError('No matching collected transactions found.', 404));

      const findManyArgs = (prismaMock.transaction.findMany as any).mock.calls[0][0];
      expect(findManyArgs.where.status).toBe('collected');
    });
  });

  describe('getFinancialReports', () => {
    it('should generate daily financial reports', async () => {
      const mockOrders = [
        {
          updatedAt: new Date('2024-01-01'),
          totalAmount: 100
        },
        {
          updatedAt: new Date('2024-01-01'),
          totalAmount: 200
        }
      ];

      const mockExpenses = [
        {
          expenseDate: new Date('2024-01-01'),
          amount: 50
        }
      ];

      prismaMock.order.findMany.mockResolvedValue(mockOrders as any);
      prismaMock.expense.findMany.mockResolvedValue(mockExpenses as any);

      const reports = await financialService.getFinancialReports({
        period: 'daily',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31')
      });

      expect(reports).toBeDefined();
      const jan1Report = reports.find((r) => r.date === '2024-01-01');
      expect(Money.toApi(jan1Report!.revenue)).toBe('300.00');
      expect(Money.toApi(jan1Report!.expenses)).toBe('50.00');
      expect(Money.toApi(jan1Report!.profit)).toBe('250.00');
      expect(jan1Report?.orders).toBe(2);
    });

    it('should generate monthly financial reports', async () => {
      const mockOrders = [
        {
          updatedAt: new Date('2024-01-15'),
          totalAmount: 100
        }
      ];

      const mockExpenses = [
        {
          expenseDate: new Date('2024-01-20'),
          amount: 30
        }
      ];

      prismaMock.order.findMany.mockResolvedValue(mockOrders as any);
      prismaMock.expense.findMany.mockResolvedValue(mockExpenses as any);

      const reports = await financialService.getFinancialReports({
        period: 'monthly',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31')
      });

      const jan2024 = reports.find((r) => r.date === '2024-01');
      expect(Money.toApi(jan2024!.revenue)).toBe('100.00');
      expect(Money.toApi(jan2024!.expenses)).toBe('30.00');
      expect(Money.toApi(jan2024!.profit)).toBe('70.00');
    });
  });

  describe('getExpenseBreakdown', () => {
    it('should group expenses by category', async () => {
      const mockExpenses = [
        { category: 'Delivery', amount: 200 },
        { category: 'Delivery', amount: 800 },
        { category: 'Marketing', amount: 500 },
        { category: 'Operations', amount: 800 }
      ];

      prismaMock.expense.findMany.mockResolvedValue(mockExpenses as any);

      const breakdown = await financialService.getExpenseBreakdown({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31')
      });

      expect(breakdown).toHaveLength(3);
      expect(Money.toApi(breakdown.find(b => b.category === 'Delivery')!.totalAmount)).toBe('1000.00');
      expect(Money.toApi(breakdown.find(b => b.category === 'Marketing')!.totalAmount)).toBe('500.00');
      expect(Money.toApi(breakdown.find(b => b.category === 'Operations')!.totalAmount)).toBe('800.00');

      // Should be sorted by amount (descending)
      expect(Money.toApi(breakdown[0].totalAmount)).toBe('1000.00');
      expect(Money.toApi(breakdown[1].totalAmount)).toBe('800.00');
    });
  });

  describe('expense totals use exact money arithmetic (F-932)', () => {
    it('sums 0.1 x 1000 in an expense total to "100.00"', async () => {
      // 0.1 summed 1000 times as a float is 99.9999999999986
      const mockExpenses = Array.from({ length: 1000 }, () => ({ category: 'Delivery', amount: 0.1 }));
      prismaMock.expense.findMany.mockResolvedValue(mockExpenses as any);

      const breakdown = await financialService.getExpenseBreakdown({});

      expect(Money.toApi(breakdown[0].totalAmount)).toBe('100.00');
      expect(mockExpenses.reduce((sum, e) => sum + e.amount, 0)).not.toBe(100);
    });

    it('sums 0.1 x 1000 in a daily financial report to "100.00"', async () => {
      const mockExpenses = Array.from({ length: 1000 }, () => ({ expenseDate: new Date('2024-01-01T10:00:00Z'), amount: 0.1 }));
      prismaMock.expense.findMany.mockResolvedValue(mockExpenses as any);
      prismaMock.order.findMany.mockResolvedValue([] as any);

      const reports = await financialService.getFinancialReports({ startDate: new Date('2024-01-01'), endDate: new Date('2024-01-31') }, 'daily');

      expect(Money.toApi(reports[0].expenses)).toBe('100.00');
      expect(Money.toApi(reports[0].profit)).toBe('-100.00');
    });
  });

  describe('getAgentSettlement', () => {
    it('should calculate agent settlement correctly', async () => {
      const mockCollections = [
        {
          id: 'trans-1',
          amount: 100,
          order: {
            orderNumber: '1001',
            customer: { firstName: 'John', lastName: 'Doe' }
          }
        }
      ];

      prismaMock.transaction.findMany.mockResolvedValue(mockCollections as any);
      prismaMock.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 1000 } } as any) // totalCollected
        .mockResolvedValueOnce({ _sum: { amount: 0 } } as any) // totalPending
        .mockResolvedValueOnce({ _sum: { amount: 600 } } as any); // totalDeposited

      const settlement = await financialService.getAgentSettlement('agent-1');

      expect(settlement.agentId).toBe('agent-1');
      expect(Money.toApi(settlement.totalCollected)).toBe('1000.00');
      expect(Money.toApi(settlement.totalDeposited)).toBe('600.00');
      expect(Money.toApi(settlement.pendingSettlement)).toBe('400.00'); // 1000 - 600
      expect(settlement.collections).toHaveLength(1);
    });
  });

  describe('edge cases - negative and zero amounts', () => {
    it('should reject negative expense amount', async () => {
      const expenseData = {
        category: 'Delivery',
        amount: -500,
        description: 'Invalid negative',
        expenseDate: new Date(),
        recordedBy: 'user-1'
      };

      await expect(financialService.recordExpense(expenseData))
        .rejects.toThrow('Expense amount must be a positive number');
    });

    it('should reject zero expense amount', async () => {
      const expenseData = {
        category: 'Delivery',
        amount: 0,
        description: 'Zero amount',
        expenseDate: new Date(),
        recordedBy: 'user-1'
      };

      await expect(financialService.recordExpense(expenseData))
        .rejects.toThrow('Expense amount must be a positive number');
    });

    it('should throw when marking empty transaction list as deposited', async () => {
      await expect(
        financialService.markCODAsDeposited([])
      ).rejects.toThrow('No transaction IDs provided');
    });
  });

  describe('getAllTransactions', () => {
    it('should return paginated transactions', async () => {
      const mockTransactions = [
        {
          id: 'trans-1',
          type: 'cod_collection',
          amount: 100,
          order: {
            orderNumber: '1001',
            customer: { firstName: 'John', lastName: 'Doe' },
            deliveryAgent: { firstName: 'Agent', lastName: 'One' }
          }
        }
      ];

      prismaMock.transaction.findMany.mockResolvedValue(mockTransactions as any);
      prismaMock.transaction.count.mockResolvedValue(1);

      const result = await financialService.getAllTransactions({
        page: 1,
        limit: 20
      });

      expect(result.transactions).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.pages).toBe(1);
    });

    it('should filter by transaction type', async () => {
      prismaMock.transaction.findMany.mockResolvedValue([]);
      prismaMock.transaction.count.mockResolvedValue(0);

      await financialService.getAllTransactions({
        type: 'cod_collection'
      });

      const callArgs = (prismaMock.transaction.findMany as any).mock.calls[0][0];
      expect(callArgs.where.type).toBe('cod_collection');
    });

    it('should filter by payment status', async () => {
      prismaMock.transaction.findMany.mockResolvedValue([]);
      prismaMock.transaction.count.mockResolvedValue(0);

      await financialService.getAllTransactions({
        status: 'collected' as PaymentStatus
      });

      const callArgs = (prismaMock.transaction.findMany as any).mock.calls[0][0];
      expect(callArgs.where.status).toBe('collected');
    });
  });

  describe('getBalanceSheet', () => {
    it('should calculate balance sheet correctly', async () => {
      const mockAccounts = [
        { id: 1, code: '1000', name: 'Cash', accountType: 'asset', normalBalance: 'debit', currentBalance: 10000 },
        { id: 2, code: '2000', name: 'AP', accountType: 'liability', normalBalance: 'credit', currentBalance: 2000 },
        { id: 3, code: '3000', name: 'Equity', accountType: 'equity', normalBalance: 'credit', currentBalance: 5000 },
        { id: 4, code: '4000', name: 'Sales', accountType: 'revenue', normalBalance: 'credit', currentBalance: 4000 },
        { id: 5, code: '5000', name: 'Rent', accountType: 'expense', normalBalance: 'debit', currentBalance: 1000 }
      ];

      prismaMock.account.findMany.mockResolvedValue(mockAccounts as any);

      // Mock aggregations using groupBy
      prismaMock.accountTransaction.groupBy.mockResolvedValue([
        { accountId: 1, _sum: { debitAmount: 10000, creditAmount: 0 } },
        { accountId: 2, _sum: { debitAmount: 0, creditAmount: 2000 } },
        { accountId: 3, _sum: { debitAmount: 0, creditAmount: 5000 } },
        { accountId: 4, _sum: { debitAmount: 0, creditAmount: 4000 } },
        { accountId: 5, _sum: { debitAmount: 1000, creditAmount: 0 } }
      ] as any);

      const bs = await financialService.getBalanceSheet();

      expect(Money.toApi(bs.assets.total)).toBe('10000.00');
      expect(Money.toApi(bs.liabilities.total)).toBe('2000.00');
      expect(Money.toApi(bs.equity.retainedEarnings)).toBe('3000.00'); // 4000 - 1000
      expect(Money.toApi(bs.equity.total)).toBe('8000.00'); // 5000 + 3000
      expect(Money.toApi(bs.totalLiabilitiesAndEquity)).toBe('10000.00');
      expect(bs.isBalanced).toBe(true);
    });

    it('should calculate historical balance correctly', async () => {
      const mockAccounts = [
        {
          id: 1, code: '1000', name: 'Cash', accountType: 'asset', normalBalance: 'debit'
        }
      ];

      prismaMock.account.findMany.mockResolvedValue(mockAccounts as any);

      prismaMock.accountTransaction.groupBy.mockResolvedValue([
        { accountId: 1, _sum: { debitAmount: 1500, creditAmount: 200 } }
      ] as any);

      const bs = await financialService.getBalanceSheet(new Date());

      expect(Money.toApi(bs.assets.total)).toBe('1300.00'); // 1500 - 200
    });
  });

  describe('getProfitLoss', () => {
    it('should calculate profit and loss correctly', async () => {
      const mockAccounts = [
        { id: 1, code: '4000', name: 'Sales', accountType: 'revenue', normalBalance: 'credit' },
        { id: 2, code: '5010', name: 'COGS', accountType: 'expense', normalBalance: 'debit' },
        { id: 3, code: '5200', name: 'Rent', accountType: 'expense', normalBalance: 'debit' }
      ];

      prismaMock.account.findMany.mockResolvedValue(mockAccounts as any);

      prismaMock.journalEntry.findMany.mockResolvedValue([
        { id: 1 }, { id: 2 }, { id: 3 }
      ] as any);

      prismaMock.accountTransaction.groupBy.mockResolvedValue([
        { accountId: 1, _sum: { debitAmount: 0, creditAmount: 5000 } },
        { accountId: 2, _sum: { debitAmount: 2000, creditAmount: 0 } },
        { accountId: 3, _sum: { debitAmount: 500, creditAmount: 0 } }
      ] as any);

      const pl = await financialService.getProfitLoss(new Date(), new Date());

      expect(Money.toApi(pl.revenue.total)).toBe('5000.00');
      expect(Money.toApi(pl.cogs.total)).toBe('2000.00');
      expect(Money.toApi(pl.expenses.total)).toBe('500.00');
      expect(Money.toApi(pl.grossProfit)).toBe('3000.00');
      expect(Money.toApi(pl.netIncome)).toBe('2500.00');
      expect(pl.grossMarginPercentage).toBe(60);
    });

    it('reads date-only bounds as store days: the end day is in up to its last millisecond; an ISO end snaps to its day', async () => {
      prismaMock.account.findMany.mockResolvedValue([] as any);
      prismaMock.accountTransaction.groupBy.mockResolvedValue([] as any);
      const entryDate = () => (prismaMock.accountTransaction.groupBy.mock.calls.at(-1)![0] as any).where.journalEntry.entryDate;

      await financialService.getProfitLoss('2026-10-01', '2026-10-17');
      expect(entryDate()).toEqual({ gte: new Date('2026-10-01T00:00:00.000Z'), lte: new Date('2026-10-17T23:59:59.999Z') });

      await financialService.getProfitLoss('2026-10-01', '2026-10-17T10:00:00.000Z');
      expect(entryDate().lte).toEqual(new Date('2026-10-17T23:59:59.999Z'));
    });
  });

  describe('getBalanceSheet date bound', () => {
    it('a date-only as-of date is in up to the last millisecond of that store day', async () => {
      prismaMock.account.findMany.mockResolvedValue([] as any);
      prismaMock.accountTransaction.groupBy.mockResolvedValue([] as any);
      await financialService.getBalanceSheet('2026-10-17');
      const call = prismaMock.accountTransaction.groupBy.mock.calls[0][0] as any;
      expect(call.where.journalEntry.entryDate).toEqual({ lte: new Date('2026-10-17T23:59:59.999Z') });
    });
  });
});
