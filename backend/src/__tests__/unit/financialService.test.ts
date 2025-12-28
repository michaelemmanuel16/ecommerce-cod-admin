import { describe, it, expect, beforeEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { FinancialService } from '../../services/financialService';
import { AppError } from '../../middleware/errorHandler';
import { PaymentStatus } from '@prisma/client';

describe('FinancialService', () => {
  let financialService: FinancialService;

  beforeEach(() => {
    financialService = new FinancialService();
  });

  describe('getFinancialSummary', () => {
    it('should calculate financial summary correctly', async () => {
      prismaMock.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 10000 } } as any) // revenue
        .mockResolvedValueOnce({ _sum: { amount: 9500 } } as any) // codCollections
        .mockResolvedValueOnce({ _sum: { amount: 500 } } as any); // pendingCOD

      prismaMock.expense.aggregate.mockResolvedValue({
        _sum: { amount: 2000 }
      } as any);

      prismaMock.order.aggregate
        .mockResolvedValueOnce({ _sum: { totalAmount: 1000 } } as any) // deliveredOrders
        .mockResolvedValueOnce({ _sum: { totalAmount: 500 } } as any); // outForDeliveryOrders

      const summary = await financialService.getFinancialSummary({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31')
      });

      expect(summary.totalRevenue).toBe(10000);
      expect(summary.totalExpenses).toBe(2000);
      expect(summary.profit).toBe(8000);
      expect(summary.codCollected).toBe(9500);
      expect(summary.codPending).toBe(2000); // 500 + 1000 + 500
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

      const result = await financialService.getCODCollectionsByAgent('agent-1');

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

      const result = await financialService.reconcileTransaction(reconcileData);

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

      await financialService.reconcileTransaction({
        transactionId: 'trans-1',
        status: 'deposited' as PaymentStatus
      });

      expect(updatedPaymentStatus).toBe('deposited');
    });
  });

  describe('markCODAsDeposited', () => {
    it('should mark multiple transactions as deposited', async () => {
      const transactionIds = ['trans-1', 'trans-2', 'trans-3'];

      prismaMock.transaction.updateMany.mockResolvedValue({ count: 3 } as any);
      prismaMock.order.updateMany.mockResolvedValue({ count: 3 } as any);

      const result = await financialService.markCODAsDeposited(
        transactionIds,
        'DEP-2024-001'
      );

      expect(result.message).toContain('3 transactions marked as deposited');
      expect(result.count).toBe(3);
      expect(prismaMock.transaction.updateMany).toHaveBeenCalled();
      expect(prismaMock.order.updateMany).toHaveBeenCalled();
    });

    it('should throw error when no transaction IDs provided', async () => {
      await expect(
        financialService.markCODAsDeposited([])
      ).rejects.toThrow(new AppError('No transaction IDs provided', 400));
    });

    it('should only update collected transactions', async () => {
      prismaMock.transaction.updateMany.mockResolvedValue({ count: 2 } as any);
      prismaMock.order.updateMany.mockResolvedValue({ count: 2 } as any);

      await financialService.markCODAsDeposited(['trans-1', 'trans-2']);

      const callArgs = (prismaMock.transaction.updateMany as any).mock.calls[0][0];
      expect(callArgs.where.status).toBe('collected');
    });
  });

  describe('getFinancialReports', () => {
    it('should generate daily financial reports', async () => {
      const mockTransactions = [
        {
          createdAt: new Date('2024-01-01'),
          type: 'cod_collection',
          amount: 100,
          status: 'collected',
          order: {}
        },
        {
          createdAt: new Date('2024-01-01'),
          type: 'cod_collection',
          amount: 200,
          status: 'collected',
          order: {}
        }
      ];

      const mockExpenses = [
        {
          expenseDate: new Date('2024-01-01'),
          amount: 50
        }
      ];

      prismaMock.transaction.findMany.mockResolvedValue(mockTransactions as any);
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
      const mockTransactions = [
        {
          createdAt: new Date('2024-01-15'),
          type: 'cod_collection',
          amount: 100,
          status: 'collected',
          order: {}
        }
      ];

      const mockExpenses = [
        {
          expenseDate: new Date('2024-01-20'),
          amount: 30
        }
      ];

      prismaMock.transaction.findMany.mockResolvedValue(mockTransactions as any);
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
      const mockBreakdown = [
        {
          category: 'Delivery',
          _sum: { amount: 1000 },
          _count: 5
        },
        {
          category: 'Marketing',
          _sum: { amount: 500 },
          _count: 3
        },
        {
          category: 'Operations',
          _sum: { amount: 800 },
          _count: 4
        }
      ];

      prismaMock.expense.groupBy.mockResolvedValue(mockBreakdown as any);

      const breakdown = await financialService.getExpenseBreakdown({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31')
      });

      expect(breakdown).toHaveLength(3);
      expect(breakdown[0].category).toBe('Delivery');
      expect(breakdown[0].totalAmount).toBe(1000);
      expect(breakdown[0].count).toBe(5);

      // Should be sorted by amount (descending)
      expect(breakdown[0].totalAmount).toBeGreaterThan(breakdown[1].totalAmount);
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
              product: { costPrice: 40 }
            }
          ]
        },
        {
          totalAmount: 300,
          orderItems: [
            {
              quantity: 3,
              product: { costPrice: 50 }
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
});
