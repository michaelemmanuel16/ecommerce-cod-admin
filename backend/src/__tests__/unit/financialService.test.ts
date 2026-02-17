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
import { prismaMock } from '../mocks/prisma.mock';
import { FinancialService } from '../../services/financialService';
import { AppError } from '../../middleware/errorHandler';
import { PaymentStatus } from '@prisma/client';

describe('FinancialService', () => {
  let financialService: FinancialService;

  beforeEach(() => {
    financialService = new FinancialService();
    // Default $transaction mock: executes the callback with prismaMock as the tx
    (prismaMock.$transaction as any).mockImplementation(async (callback: any) => {
      return callback(prismaMock);
    });
  });

  describe('getFinancialSummary', () => {
    it('should calculate financial summary correctly', async () => {
      prismaMock.order.aggregate
        .mockResolvedValueOnce({ _sum: { totalAmount: 10000 } } as any) // totalRevenue (delivered orders)
        .mockResolvedValueOnce({ _sum: { totalAmount: 500 } } as any)  // outForDeliveryOrders
        .mockResolvedValueOnce({ _sum: { totalAmount: 0 } } as any);   // outstandingReceivablesData

      prismaMock.order.findMany.mockResolvedValue([] as any); // ordersForCommissions

      prismaMock.expense.aggregate.mockResolvedValue({
        _sum: { amount: 2000 }
      } as any);

      prismaMock.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 9500 } } as any) // codCollections (collected/deposited/reconciled)
        .mockResolvedValueOnce({ _sum: { amount: 0 } } as any); // pendingTransactions (not needed for this test summary)

      const summary = await financialService.getFinancialSummary({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31')
      });

      expect(summary.totalRevenue).toBe(10000);
      expect(summary.totalExpenses).toBe(2000);
      expect(summary.profit).toBe(8000);
      expect(summary.codCollected).toBe(9500);
      expect(summary.codPending).toBe(1000); // (10000 - 9500) + 500
      expect(summary.profitMargin).toBe(80); // (10000 - 2000) / 10000 * 100
    });

    it('should handle null aggregate values', async () => {
      prismaMock.transaction.aggregate.mockResolvedValue({
        _sum: { amount: null }
      } as any);

      prismaMock.expense.aggregate.mockResolvedValue({
        _sum: { amount: null }
      } as any);

      prismaMock.order.aggregate.mockResolvedValue({
        _sum: { totalAmount: null }
      } as any);

      const summary = await financialService.getFinancialSummary({});

      expect(summary.totalRevenue).toBe(0);
      expect(summary.totalExpenses).toBe(0);
      expect(summary.profit).toBe(0);
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
      expect(result.summary.totalCollected).toBe(300);
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
        { id: 1, type: 'cod_collection', status: 'collected', orderId: 101 },
        { id: 2, type: 'cod_collection', status: 'collected', orderId: 102 }
      ];

      prismaMock.transaction.findMany.mockResolvedValue(mockTransactions as any);
      prismaMock.transaction.updateMany.mockResolvedValue({ count: 2 } as any);
      prismaMock.order.updateMany.mockResolvedValue({ count: 2 } as any);

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
      expect(jan1Report?.revenue).toBe(300);
      expect(jan1Report?.expenses).toBe(50);
      expect(jan1Report?.profit).toBe(250);
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
      expect(jan2024?.revenue).toBe(100);
      expect(jan2024?.expenses).toBe(30);
      expect(jan2024?.profit).toBe(70);
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
      expect(breakdown.find(b => b.category === 'Delivery')?.totalAmount).toBe(1000);
      expect(breakdown.find(b => b.category === 'Marketing')?.totalAmount).toBe(500);
      expect(breakdown.find(b => b.category === 'Operations')?.totalAmount).toBe(800);

      // Should be sorted by amount (descending)
      expect(breakdown[0].totalAmount).toBe(1000);
      expect(breakdown[1].totalAmount).toBe(800);
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
      expect(settlement.totalCollected).toBe(1000);
      expect(settlement.totalDeposited).toBe(600);
      expect(settlement.pendingSettlement).toBe(400); // 1000 - 600
      expect(settlement.collections).toHaveLength(1);
    });
  });

  describe('calculateProfitMargins', () => {
    it('should calculate profit margins correctly', async () => {
      const mockOrders = [
        {
          totalAmount: 200,
          orderItems: [
            {
              quantity: 2,
              product: { cogs: 40 }
            }
          ]
        },
        {
          totalAmount: 300,
          orderItems: [
            {
              quantity: 3,
              product: { cogs: 50 }
            }
          ]
        }
      ];

      prismaMock.order.findMany.mockResolvedValue(mockOrders as any);

      const margins = await financialService.calculateProfitMargins({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31')
      });

      expect(margins.totalRevenue).toBe(500); // 200 + 300
      expect(margins.totalCost).toBe(230); // (2*40) + (3*50)
      expect(margins.grossProfit).toBe(270); // 500 - 230
      expect(margins.profitMargin).toBe(54); // (270 / 500) * 100
      expect(margins.orderCount).toBe(2);
    });

    it('should handle zero revenue', async () => {
      prismaMock.order.findMany.mockResolvedValue([]);

      const margins = await financialService.calculateProfitMargins({});

      expect(margins.totalRevenue).toBe(0);
      expect(margins.totalCost).toBe(0);
      expect(margins.grossProfit).toBe(0);
      expect(margins.profitMargin).toBe(0);
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

      expect(bs.assets.total).toBe(10000);
      expect(bs.liabilities.total).toBe(2000);
      expect(bs.equity.retainedEarnings).toBe(3000); // 4000 - 1000
      expect(bs.equity.total).toBe(8000); // 5000 + 3000
      expect(bs.totalLiabilitiesAndEquity).toBe(10000);
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

      expect(bs.assets.total).toBe(1300); // 1500 - 200
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

      prismaMock.accountTransaction.groupBy.mockResolvedValue([
        { accountId: 1, _sum: { debitAmount: 0, creditAmount: 5000 } },
        { accountId: 2, _sum: { debitAmount: 2000, creditAmount: 0 } },
        { accountId: 3, _sum: { debitAmount: 500, creditAmount: 0 } }
      ] as any);

      const pl = await financialService.getProfitLoss(new Date(), new Date());

      expect(pl.revenue.total).toBe(5000);
      expect(pl.cogs.total).toBe(2000);
      expect(pl.expenses.total).toBe(500);
      expect(pl.grossProfit).toBe(3000);
      expect(pl.netIncome).toBe(2500);
      expect(pl.grossMarginPercentage).toBe(60);
    });
  });
});
