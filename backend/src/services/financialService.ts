import { Parser } from 'json2csv';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Prisma, PaymentStatus } from '@prisma/client';
import logger from '../utils/logger';
import { checkResourceOwnership, Requester } from '../utils/authUtils';
import { getSocketInstance } from '../utils/socketInstance';
import {
  emitExpenseCreated,
  emitExpenseUpdated,
  emitExpenseDeleted,
  emitTransactionDeposited,
  emitTransactionReconciled
} from '../sockets/index';
import { GL_ACCOUNTS } from '../config/glAccounts';
import { TRANSACTION_CONFIG } from '../config/transactionConfig';
import { GLAutomationService } from './glAutomationService';
import { SYSTEM_USER_ID } from '../config/constants';
import { getTenantId } from '../utils/tenantContext';

interface DateFilters {
  startDate?: Date;
  endDate?: Date;
}

interface CreateExpenseData {
  category: string;
  amount: number;
  description: string;
  expenseDate: Date;
  recordedBy: string;
  receiptUrl?: string;
}

interface CashFlowForecast {
  date: string;
  expectedCollection: number;
  expectedExpense: number;
  projectedBalance: number;
}

interface AgentHolding {
  agent: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
  };
  totalCollected: number;
  orderCount: number;
  OldestCollectionDate: Date;
}

interface TransactionFilters {
  type?: string;
  status?: PaymentStatus;
  page?: number;
  limit?: number;
}

interface ReconcileTransactionData {
  transactionId: string;
  status: PaymentStatus;
  reference?: string;
  notes?: string;
}

interface FinancialStatementAccount {
  id: number;
  code: string;
  name: string;
  balance: number;
}

interface BalanceSheetData {
  asOfDate: Date;
  assets: {
    accounts: FinancialStatementAccount[];
    total: number;
  };
  liabilities: {
    accounts: FinancialStatementAccount[];
    total: number;
  };
  equity: {
    accounts: FinancialStatementAccount[];
    retainedEarnings: number;
    total: number;
  };
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
}

interface ProfitLossData {
  startDate: Date;
  endDate: Date;
  revenue: {
    accounts: FinancialStatementAccount[];
    total: number;
  };
  cogs: {
    accounts: FinancialStatementAccount[];
    total: number;
  };
  expenses: {
    accounts: FinancialStatementAccount[];
    total: number;
  };
  grossProfit: number;
  grossMarginPercentage: number;
  netIncome: number;
  netMarginPercentage: number;
}

export class FinancialService {
  private forecastCache = new Map<string, { data: CashFlowForecast[]; timestamp: number }>();
  private readonly FORECAST_CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Safe conversion to number
   */
  private toNumber(value: string | number | null | undefined | Prisma.Decimal): number {
    return Number(value || 0);
  }

  /**
   * Get financial summary — GL is the single source of truth for Revenue, Expenses, and Profit.
   * COD collected and pipeline revenue remain operational metrics from Order/Transaction tables.
   */
  async getFinancialSummary(filters: DateFilters, requester?: Requester) {
    let { startDate, endDate } = filters;
    // Normalise endDate to end-of-day so it aligns with P&L / Profitability
    if (endDate) {
      endDate = new Date(endDate);
      endDate.setHours(23, 59, 59, 999);
    }

    // --- GL-based accounting metrics ---
    // Revenue account codes
    const revenueAccountCodes = [GL_ACCOUNTS.PRODUCT_REVENUE];
    // Expense account codes (all 5xxx accounts)
    const expenseAccountCodes = [
      GL_ACCOUNTS.COGS,
      GL_ACCOUNTS.FAILED_DELIVERY_EXPENSE,
      GL_ACCOUNTS.RETURN_PROCESSING_EXPENSE,
      GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION,
      GL_ACCOUNTS.SALES_REP_COMMISSION,
      GL_ACCOUNTS.OPERATING_EXPENSE
    ];

    // Query GL account balances using a single nested relation filter (avoids large IN clause)
    // Role-based scoping: delivery_agent and sales_rep see only their own orders' GL entries
    const glAggregations = await prisma.accountTransaction.groupBy({
      by: ['accountId'],
      where: {
                journalEntry: {
          isVoided: false,
                    ...(startDate || endDate ? {
            entryDate: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {})
            }
          } : {}),
          ...(requester?.role === 'delivery_agent'
            ? { orders: { some: { deliveryAgentId: requester.id } } }
            : {}),
          ...(requester?.role === 'sales_rep'
            ? { orders: { some: { customerRepId: requester.id } } }
            : {})
        },
        account: {
          code: { in: [...revenueAccountCodes, ...expenseAccountCodes] }
        }
      },
      _sum: {
        debitAmount: true,
        creditAmount: true
      }
    });

    // Get account metadata to map IDs to codes and normal balances
    const accounts = await prisma.account.findMany({
      where: {
        code: { in: [...revenueAccountCodes, ...expenseAccountCodes] }
      },
      select: { id: true, code: true, normalBalance: true, accountType: true }
    });
    const accountMap = new Map(accounts.map(a => [a.id, a]));

    let totalRevenue = 0;
    let totalExpenses = 0;

    for (const agg of glAggregations) {
      const account = accountMap.get(agg.accountId);
      if (!account) continue;

      const debit = this.toNumber(agg._sum.debitAmount);
      const credit = this.toNumber(agg._sum.creditAmount);
      const balance = account.normalBalance === 'debit'
        ? debit - credit
        : credit - debit;

      if (account.accountType === 'revenue') {
        totalRevenue += balance;
      } else if (account.accountType === 'expense') {
        totalExpenses += balance;
      }
    }

    // --- Operational metrics (from Order/Transaction tables) ---
    const dateWhere: any = {};
    if (startDate || endDate) {
      dateWhere.createdAt = {};
      if (startDate) dateWhere.createdAt.gte = startDate;
      if (endDate) dateWhere.createdAt.lte = endDate;
    }

    const transactionWhere: Prisma.TransactionWhereInput = {
      type: 'cod_collection',
      order: { deletedAt: null },
    };
    if (Object.keys(dateWhere).length > 0) {
      transactionWhere.createdAt = dateWhere.createdAt;
    }
    if (requester && requester.role === 'delivery_agent') {
      transactionWhere.order = {
        ...transactionWhere.order as any,
        deliveryAgentId: requester.id
      };
    }

    // Outstanding Receivables from non-reconciled AgentCollection records (net of commission)
    // Uses operational records rather than GL account 1015 to ensure all delivered orders
    // are counted, including any that pre-date the GL automation system
    const outstandingCollections = await (prisma as any).agentCollection.aggregate({
      where: {
        status: { in: ['draft', 'verified', 'approved', 'deposited'] },
        order: { deletedAt: null }
      },
      _sum: { amount: true }
    });
    const outstandingReceivables = this.toNumber(outstandingCollections._sum.amount);

    const [codCollections, outForDeliveryOrders] = await Promise.all([
      // COD Collected (operational metric)
      prisma.transaction.aggregate({
        where: {
          ...transactionWhere,
          status: { in: ['collected', 'deposited', 'reconciled'] }
        },
        _sum: { amount: true }
      }),
      // Pipeline Revenue: out-for-delivery orders (not yet in GL)
      prisma.order.aggregate({
        where: {
          status: 'out_for_delivery',
          codAmount: { not: null },
          deletedAt: null,
                    ...(requester && requester.role === 'delivery_agent' ? { deliveryAgentId: requester.id } : {}),
          ...(requester && requester.role === 'sales_rep' ? { customerRepId: requester.id } : {})
        },
        _sum: { totalAmount: true }
      })
    ]);

    const totalCOD = this.toNumber(codCollections._sum.amount);
    const outForDelivery = this.toNumber(outForDeliveryOrders._sum.totalAmount);
    // Pending COD = outstanding receivables (GL, delivered but uncollected) + out-for-delivery (operational)
    // Uses GL Cash in Transit for delivered-uncollected to stay consistent with accrual accounting
    const pendingCODAmount = outstandingReceivables + outForDelivery;

    return {
      totalRevenue,
      totalExpenses,
      profit: totalRevenue - totalExpenses,
      codCollected: totalCOD,
      codPending: pendingCODAmount,
      outstandingReceivables,
      profitMargin: totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue) * 100 : 0
    };
  }

  /**
   * Get all transactions with filters
   */
  async getAllTransactions(filters: TransactionFilters, requester?: Requester) {
    const { type, status, page = 1, limit = 20 } = filters;

    const where: Prisma.TransactionWhereInput = {};
    if (type) where.type = type;
    if (status) where.status = status;


    // Role-based filtering for transactions
    if (requester && requester.role === 'sales_rep') {
      where.order = { customerRepId: requester.id };
    } else if (requester && requester.role === 'delivery_agent') {
      where.order = { deliveryAgentId: requester.id };
    }

    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        include: {
          order: {
            select: {
              // orderNumber removed - using id
              customer: {
                select: {
                  firstName: true,
                  lastName: true
                }
              },
              deliveryAgent: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.transaction.count({ where })
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Create expense record
   */
  async recordExpense(data: CreateExpenseData, requester?: Requester) {
    if (!data.amount || data.amount <= 0) {
      throw new AppError('Expense amount must be a positive number', 400);
    }

    const userId = requester ? requester.id : parseInt(data.recordedBy, 10);

    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          category: data.category,
          amount: data.amount,
          description: data.description,
          expenseDate: data.expenseDate,
          recordedBy: userId,
          receiptUrl: data.receiptUrl,
            },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        }
      });

      // Create GL journal entry for the expense
      await GLAutomationService.createExpenseGLEntry(
        tx as any,
        created.id,
        data.amount,
        data.description,
        userId
      );

      // Remap Prisma relation `user` → `recordedBy` for frontend compatibility
      const { user, ...rest } = created as any;
      return { ...rest, recordedBy: user || null };
    }, TRANSACTION_CONFIG);

    // Invalidate forecast cache since expense data changed
    this.forecastCache.clear();

    logger.info('Expense recorded', {
      expenseId: expense.id,
      category: expense.category,
      amount: expense.amount
    });

    // Emit Socket.io event
    const ioInstance = getSocketInstance();
    if (ioInstance) {
      emitExpenseCreated(ioInstance as any, expense);
    }

    return expense;
  }

  /**
   * Get all expenses
   */
  async getAllExpenses(filters: DateFilters & { category?: string; page?: number; limit?: number }, requester?: Requester) {
    const { startDate, endDate, category, page = 1, limit = 20 } = filters;

    const where: Prisma.ExpenseWhereInput = {};

    if (startDate || endDate) {
      where.expenseDate = {};
      if (startDate) where.expenseDate.gte = startDate;
      if (endDate) where.expenseDate.lte = endDate;
    }

    if (category) where.category = category;


    // Role-based filtering for expenses
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      where.recordedBy = requester.id;
    }

    const skip = (page - 1) * limit;

    const [rawExpenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        },
        orderBy: { expenseDate: 'desc' }
      }),
      prisma.expense.count({ where })
    ]);

    // Remap Prisma relation `user` → `recordedBy` for frontend compatibility
    const expenses = rawExpenses.map(({ user, ...rest }: any) => ({
      ...rest,
      recordedBy: user || null
    }));

    return {
      expenses,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get COD collections
   */
  async getCODCollections(filters: {
    agentId?: string;
    status?: PaymentStatus;
    page?: number;
    limit?: number;
  }, requester?: Requester) {
    const { agentId, status, page = 1, limit = 20 } = filters;

    const where: Prisma.TransactionWhereInput = {
      type: 'cod_collection',
      order: {
        deletedAt: null
      },
    };

    if (status) where.status = status;

    if (agentId) {
      where.order = {
        ...where.order as any,
        deliveryAgentId: parseInt(agentId, 10)
      };
    }

    // Role-based filtering for COD collections
    if (requester && requester.role === 'delivery_agent') {
      where.order = { deliveryAgentId: requester.id };
    }

    const skip = (page - 1) * limit;

    const [collections, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        include: {
          order: {
            select: {
              // orderNumber removed - using id
              deliveryAgent: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true
                }
              },
              customer: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.transaction.count({ where })
    ]);

    // Filter by agent if specified
    let filteredCollections = collections;
    if (agentId) {
      filteredCollections = collections.filter((c) => c.order?.deliveryAgent?.id === parseInt(agentId, 10));
    }

    return {
      collections: filteredCollections,
      pagination: {
        page,
        limit,
        total: agentId ? filteredCollections.length : total,
        pages: Math.ceil((agentId ? filteredCollections.length : total) / limit)
      }
    };
  }

  /**
   * Get COD collections by agent
   */
  async getCODCollectionsByAgent(agentId: string, filters?: DateFilters, requester?: Requester) {
    // Role-based ownership check for COD collections by agent
    if (requester && requester.role === 'delivery_agent' && parseInt(agentId, 10) !== requester.id) {
      throw new AppError('You do not have permission to view other agents collections', 403);
    }

    const where: Prisma.TransactionWhereInput = {
      type: 'cod_collection',
      order: {
        deliveryAgentId: parseInt(agentId, 10),
        deletedAt: null
      },
    };

    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [collections, totalCollected, totalPending, totalDeposited] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          order: {
            select: {
              // orderNumber removed - using id
              customer: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.transaction.aggregate({
        where: { ...where, status: 'collected' },
        _sum: { amount: true }
      }),
      prisma.transaction.aggregate({
        where: { ...where, status: 'pending' },
        _sum: { amount: true }
      }),
      prisma.transaction.aggregate({
        where: { ...where, status: { in: ['deposited', 'reconciled'] } },
        _sum: { amount: true }
      })
    ]);

    return {
      collections,
      summary: {
        totalCollected: totalCollected._sum.amount || 0,
        totalPending: totalPending._sum.amount || 0,
        totalDeposited: totalDeposited._sum.amount || 0,
        totalCount: collections.length
      }
    };
  }

  /**
   * Reconcile transaction (update status)
   */
  async reconcileTransaction(data: ReconcileTransactionData, requester?: Requester) {
    const { transactionId, status, reference, notes } = data;

    const transaction = await prisma.transaction.findUnique({
      where: { id: parseInt(transactionId, 10) }
    });

    if (!transaction) {
      throw new AppError('Transaction not found', 404);
    }

    // Role-based ownership check for transaction
    if (!checkResourceOwnership(requester!, transaction, 'transaction')) {
      throw new AppError('You do not have permission to reconcile this transaction', 403);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedTx = await tx.transaction.update({
        where: { id: parseInt(transactionId, 10) },
        data: {
          status,
          reference,
          metadata: {
            ...((transaction.metadata as any) || {}),
            reconciliationNotes: notes,
            reconciledAt: new Date()
          }
        }
      });

      // Update order payment status if applicable
      if (transaction.orderId) {
        await tx.order.update({
          where: { id: transaction.orderId },
          data: { paymentStatus: status }
        });
      }

      return updatedTx;
    }, TRANSACTION_CONFIG);

    logger.info('Transaction reconciled', {
      transactionId,
      status,
      orderId: transaction.orderId
    });

    // Emit Socket.io event
    const ioInstance = getSocketInstance();
    if (ioInstance) {
      emitTransactionReconciled(ioInstance as any, updated);
    }

    return updated;
  }

  /**
   * Mark COD as deposited
   */
  async markCODAsDeposited(transactionIds: string[], depositReference?: string, requester?: Requester) {
    if (!transactionIds || transactionIds.length === 0) {
      throw new AppError('No transaction IDs provided', 400);
    }

    const transactionIdsAsNumbers = transactionIds.map((id) => parseInt(id, 10));

    // Get transactions to verify ownership/validity
    const transactions = await prisma.transaction.findMany({
      where: {
        id: { in: transactionIdsAsNumbers },
        type: 'cod_collection',
        status: 'collected',
        order: {
          deletedAt: null
        },
        },
      include: {
        order: {
          select: {
            deliveryAgentId: true,
            customerRepId: true
          }
        }
      }
    });

    if (transactions.length === 0) {
      throw new AppError('No matching collected transactions found.', 404);
    }

    // Verify ownership for ALL transactions in the batch
    if (requester) {
      for (const trans of transactions) {
        const isOwner = checkResourceOwnership(requester, trans, 'transaction');
        if (!isOwner) {
          throw new AppError(`You do not have permission to deposit transaction ${trans.id}`, 403);
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.transaction.updateMany({
        where: {
          id: { in: transactions.map(t => t.id) }
        },
        data: {
          status: 'deposited',
          reference: depositReference
        }
      });

      // Update corresponding orders
      const orderIds = transactions.filter(t => t.orderId).map(t => t.orderId as number);
      await tx.order.updateMany({
        where: { id: { in: orderIds } },
        data: { paymentStatus: 'deposited' }
      });

      // Create GL deposit entry for non-reconciled transactions only
      // (reconciled collections already have GL entries from the reconciliation path)
      const reconciledCount = await tx.agentCollection.count({
        where: {
          orderId: { in: orderIds },
          status: 'reconciled'
        }
      });

      const totalTransactions = transactions.length;
      const nonReconciledCount = totalTransactions - reconciledCount;

      if (nonReconciledCount > 0) {
        // Calculate amount for non-reconciled transactions only
        const reconciledOrderIds = new Set(
          (await tx.agentCollection.findMany({
            where: { orderId: { in: orderIds }, status: 'reconciled' },
            select: { orderId: true }
          })).map((c) => c.orderId)
        );

        const nonReconciledAmount = transactions
          .filter(t => !t.orderId || !reconciledOrderIds.has(t.orderId))
          .reduce((sum, t) => sum + Number(t.amount), 0);

        if (nonReconciledAmount > 0) {
          const userId = requester?.id ?? SYSTEM_USER_ID;
          // Use the minimum transaction ID as a stable idempotency key for the batch.
          // transactions[0].id is order-dependent; Math.min is consistent across re-calls.
          const sourceId = Math.min(...transactions.map(t => t.id));
          await GLAutomationService.createDepositGLEntry(tx as any, nonReconciledAmount, sourceId, userId);
        }
      }

      return result;
    }, TRANSACTION_CONFIG);

    // Invalidate forecast cache since deposit data changed
    this.forecastCache.clear();

    logger.info('COD marked as deposited', {
      transactionIds,
      count: updated.count,
      depositReference
    });

    // Emit Socket.io event
    const ioInstance = getSocketInstance();
    if (ioInstance) {
      emitTransactionDeposited(ioInstance as any, transactionIds, depositReference);
    }

    return {
      message: `${updated.count} transactions marked as deposited`,
      count: updated.count
    };
  }

  /**
   * Get financial reports
   */
  async getFinancialReports(filters: { period?: string; startDate?: Date; endDate?: Date }, requester?: Requester) {
    const { period = 'daily', startDate, endDate } = filters;

    const start = startDate || new Date();
    const end = endDate || new Date();

    const orderWhere: Prisma.OrderWhereInput = {
      status: 'delivered',
      updatedAt: {
        gte: start,
        lte: end
      },
      deletedAt: null,
    };

    // Role-based filtering for financial reports
    if (requester && requester.role === 'sales_rep') {
      orderWhere.customerRepId = requester.id;
    } else if (requester && requester.role === 'delivery_agent') {
      orderWhere.deliveryAgentId = requester.id;
    }

    const transactionWhere: Prisma.TransactionWhereInput = {
      createdAt: {
        gte: start,
        lte: end
      },
      order: {
        deletedAt: null
      }
    };
    if (requester && requester.role === 'delivery_agent') {
      transactionWhere.order = { deliveryAgentId: requester.id };
    }

    const expenseWhere: Prisma.ExpenseWhereInput = {
      expenseDate: {
        gte: start,
        lte: end
      },
    };
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      expenseWhere.recordedBy = requester.id;
    }


    const [expenses] = await Promise.all([
      prisma.expense.findMany({
        where: expenseWhere
      })
    ]);

    // Group by period
    const groupedData: Record<string, { revenue: number; expenses: number; orders: number }> = {};

    // Fetch delivered orders for the same period to get Accrual Revenue trends
    const deliveredOrders = await prisma.order.findMany({
      where: orderWhere,
      select: {
        totalAmount: true,
        updatedAt: true
      }
    });
    (deliveredOrders || []).forEach((order) => {
      const key =
        period === 'daily'
          ? order.updatedAt.toISOString().split('T')[0]
          : `${order.updatedAt.getFullYear()}-${String(order.updatedAt.getMonth() + 1).padStart(2, '0')}`;

      if (!groupedData[key]) {
        groupedData[key] = { revenue: 0, expenses: 0, orders: 0 };
      }

      groupedData[key].revenue += Number(order.totalAmount);
      groupedData[key].orders += 1;
    });

    expenses.forEach((e) => {
      const key =
        period === 'daily'
          ? e.expenseDate.toISOString().split('T')[0]
          : `${e.expenseDate.getFullYear()}-${String(e.expenseDate.getMonth() + 1).padStart(2, '0')}`;

      if (!groupedData[key]) {
        groupedData[key] = { revenue: 0, expenses: 0, orders: 0 };
      }

      groupedData[key].expenses += e.amount;
    });

    const reports = Object.entries(groupedData).map(([date, data]) => ({
      date,
      revenue: data.revenue,
      expenses: data.expenses,
      profit: data.revenue - data.expenses,
      orders: data.orders
    })).sort((a, b) => a.date.localeCompare(b.date));

    return reports;
  }

  /**
   * Get expense breakdown by category
   */
  async getExpenseBreakdown(filters: DateFilters, requester?: Requester) {
    const where: Prisma.ExpenseWhereInput = {};

    if (filters.startDate || filters.endDate) {
      where.expenseDate = {};
      if (filters.startDate) where.expenseDate.gte = filters.startDate;
      if (filters.endDate) where.expenseDate.lte = filters.endDate;
    }



    // Role-based filtering for expense breakdown
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      where.recordedBy = requester.id;
    }

    const breakdown = await prisma.expense.findMany({
      where
    }) || [];

    const normalizedBreakdown: Record<string, { totalAmount: number; count: number }> = {};

    breakdown.forEach((item) => {
      const category = item.category.trim().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
      if (!normalizedBreakdown[category]) {
        normalizedBreakdown[category] = { totalAmount: 0, count: 0 };
      }
      normalizedBreakdown[category].totalAmount += item.amount;
      normalizedBreakdown[category].count += 1;
    });

    return Object.entries(normalizedBreakdown)
      .map(([category, stats]) => ({
        category,
        totalAmount: stats.totalAmount,
        count: stats.count
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }

  /**
   * Get agent settlement report
   */
  async getAgentSettlement(agentId: string, filters?: DateFilters, requester?: Requester) {
    // Role-based ownership check for agent settlement
    if (requester && requester.role === 'delivery_agent' && parseInt(agentId, 10) !== requester.id) {
      throw new AppError('You do not have permission to view other agents settlements', 403);
    }

    // Get all COD collections by agent
    const codData = await this.getCODCollectionsByAgent(agentId, filters, requester);

    // Calculate pending settlement
    const pendingAmount = codData.summary.totalCollected - codData.summary.totalDeposited;

    return {
      agentId,
      totalCollected: codData.summary.totalCollected,
      totalDeposited: codData.summary.totalDeposited,
      pendingSettlement: pendingAmount,
      collections: codData.collections
    };
  }

  /**
   * Calculate profit margins
   */
  async calculateProfitMargins(filters: DateFilters, requester?: Requester) {
    const where: Prisma.OrderWhereInput = {
      status: 'delivered',
    };

    if (filters.startDate || filters.endDate) {
      where.updatedAt = {};
      if (filters.startDate) where.updatedAt.gte = filters.startDate;
      if (filters.endDate) where.updatedAt.lte = filters.endDate;
    }

    // Role-based filtering for profit margins
    if (requester && requester.role === 'sales_rep') {
      where.customerRepId = requester.id;
    } else if (requester && requester.role === 'delivery_agent') {
      where.deliveryAgentId = requester.id;
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                cogs: true
              }
            }
          }
        }
      }
    });

    let totalRevenue = 0;
    let totalCost = 0;

    orders.forEach((order) => {
      totalRevenue += order.totalAmount;
      order.orderItems.forEach((item) => {
        const cogs = item.product.cogs ? Number(item.product.cogs) : 0;
        totalCost += cogs * item.quantity;
      });
    });

    const grossProfit = totalRevenue - totalCost;
    const profitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    return {
      totalRevenue,
      totalCost,
      grossProfit,
      profitMargin,
      orderCount: orders.length
    };
  }

  /**
   * Get comprehensive profitability analysis
   */
  async getProfitabilityAnalysis(filters: { startDate?: Date; endDate?: Date; productId?: number }) {
    const { startDate, productId } = filters;
    // Normalise endDate to end-of-day so it aligns with P&L / GL entryDate filtering
    let endDate = filters.endDate;
    if (endDate) {
      endDate = new Date(endDate);
      endDate.setHours(23, 59, 59, 999);
    }

    // Filter orders by GL journal entry date (not deliveryDate) so breakdowns
    // align with the GL-based summary KPIs. deliveryDate and GL entryDate can
    // diverge for backfilled orders. Since glJournalEntryId may be null on
    // orders, we look up order IDs via journal_entries.source_id instead.
    const orderWhere: Prisma.OrderWhereInput = {
      status: 'delivered',
      revenueRecognized: true,
      deletedAt: null,
    };

    if (startDate || endDate) {
      // Find order IDs that have GL revenue entries in the date range
      const glOrderEntries = await prisma.journalEntry.findMany({
        where: {
          sourceType: 'order_delivery',
          isVoided: false,
          entryDate: {
            ...(startDate ? { gte: startDate } : {}),
            ...(endDate ? { lte: endDate } : {}),
          },
            },
        select: { sourceId: true },
      });
      const glOrderIds = glOrderEntries
        .map(e => e.sourceId)
        .filter((id): id is number => id !== null);
      orderWhere.id = { in: glOrderIds };
    }

    if (productId) {
      orderWhere.orderItems = {
        some: {
          productId: productId,
        },
      };
    }

    // Fetch orders with items and products
    const orders = await prisma.order.findMany({
      where: orderWhere,
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
        deliveryAgent: { select: { commissionAmount: true } },
        customerRep: { select: { commissionAmount: true } },
      },
    });

    // Calculate revenue and COGS
    let totalRevenue = 0;
    let totalCOGS = 0;
    let totalShippingCost = 0;
    let totalDiscount = 0;

    const productProfitability: Record<number, {
      id: number,
      name: string,
      sku: string,
      revenue: number,
      cogs: number,
      quantity: number,
      commission: number,
      grossProfit: number
    }> = {};

    const dailyProfitability: Record<string, {
      date: string,
      revenue: number,
      cogs: number,
      grossProfit: number
    }> = {};

    for (const order of orders) {
      // Use totalAmount (subtotal + shipping - discount) to match GL revenue recognition
      totalRevenue += order.totalAmount;
      totalShippingCost += order.shippingCost;
      totalDiscount += order.discount;

      const dateStr = (order.deliveryDate || order.updatedAt).toISOString().split('T')[0];
      if (!dailyProfitability[dateStr]) {
        dailyProfitability[dateStr] = {
          date: dateStr,
          revenue: 0,
          cogs: 0,
          grossProfit: 0
        };
      }
      dailyProfitability[dateStr].revenue += order.totalAmount;

      const orderCommission = (order.deliveryAgent?.commissionAmount ?? 0)
                            + (order.customerRep?.commissionAmount ?? 0);
      const orderSubtotal = order.orderItems.reduce(
        (sum, item) => sum + (item.unitPrice * item.quantity), 0
      );

      for (const item of order.orderItems) {
        const itemCOGS = (Number(item.product.cogs) || 0) * item.quantity;
        totalCOGS += itemCOGS;
        dailyProfitability[dateStr].cogs += itemCOGS;

        const itemRevenue = item.unitPrice * item.quantity;
        const itemCommission = orderSubtotal > 0
          ? orderCommission * (itemRevenue / orderSubtotal)
          : 0;

        if (!productProfitability[item.productId]) {
          productProfitability[item.productId] = {
            id: item.productId,
            name: item.product.name,
            sku: item.product.sku,
            revenue: 0,
            cogs: 0,
            quantity: 0,
            commission: 0,
            grossProfit: 0
          };
        }

        productProfitability[item.productId].revenue += itemRevenue;
        productProfitability[item.productId].cogs += itemCOGS;
        productProfitability[item.productId].quantity += item.quantity;
        productProfitability[item.productId].commission += itemCommission;
      }
    }

    // Query GL using entryDate (same filter as P&L / Overview) — single source of truth
    const glEntryDateFilter: any = {};
    if (startDate || endDate) {
      glEntryDateFilter.entryDate = {};
      if (startDate) glEntryDateFilter.entryDate.gte = startDate;
      if (endDate) glEntryDateFilter.entryDate.lte = endDate;
    }

    // GL Revenue — use account 4010 (same as Overview) so numbers always match
    const revenueAgg = await prisma.accountTransaction.aggregate({
      where: {
        account: { code: GL_ACCOUNTS.PRODUCT_REVENUE },
        journalEntry: { isVoided: false, ...glEntryDateFilter },
        },
      _sum: { debitAmount: true, creditAmount: true }
    });
    // Revenue account has credit-normal balance
    const glRevenue = this.toNumber(revenueAgg._sum.creditAmount) - this.toNumber(revenueAgg._sum.debitAmount);

    const commissionCodes = [GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION, GL_ACCOUNTS.SALES_REP_COMMISSION];

    const expenseAgg = await prisma.accountTransaction.groupBy({
      by: ['accountId'],
      where: {
        account: { accountType: 'expense' },
        journalEntry: { isVoided: false, ...glEntryDateFilter },
        },
      _sum: { debitAmount: true, creditAmount: true }
    });

    // Map account IDs to codes for categorization
    const expenseAccounts = await prisma.account.findMany({
      where: { accountType: 'expense' },
      select: { id: true, code: true }
    });
    const commissionIdSet = new Set(
      expenseAccounts.filter(a => (commissionCodes as string[]).includes(a.code)).map(a => a.id)
    );
    const cogsIdSet = new Set(
      expenseAccounts.filter(a => a.code === GL_ACCOUNTS.COGS).map(a => a.id)
    );

    const glCOGS = expenseAgg
      .filter(r => cogsIdSet.has(r.accountId))
      .reduce((sum, r) => sum + this.toNumber(r._sum.debitAmount) - this.toNumber(r._sum.creditAmount), 0);

    const totalCommissions = expenseAgg
      .filter(r => commissionIdSet.has(r.accountId))
      .reduce((sum, r) => sum + this.toNumber(r._sum.debitAmount) - this.toNumber(r._sum.creditAmount), 0);

    const totalOperatingExpenses = expenseAgg
      .filter(r => !commissionIdSet.has(r.accountId) && !cogsIdSet.has(r.accountId))
      .reduce((sum, r) => sum + this.toNumber(r._sum.debitAmount) - this.toNumber(r._sum.creditAmount), 0);

    // Use GL revenue + GL COGS for summary totals (matches Overview exactly)
    const grossProfit = glRevenue - glCOGS;
    const grossMargin = glRevenue > 0 ? (grossProfit / glRevenue) * 100 : 0;

    const netProfit = grossProfit - totalCommissions - totalOperatingExpenses;
    const netMargin = glRevenue > 0 ? (netProfit / glRevenue) * 100 : 0;

    // Format product profitability
    const products = Object.values(productProfitability).map(p => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      revenue: p.revenue,
      cogs: p.cogs,
      quantity: p.quantity,
      commission: p.commission,
      grossProfit: p.revenue - p.cogs,
      grossMargin: p.revenue > 0 ? ((p.revenue - p.cogs) / p.revenue) * 100 : 0
    })).sort((a, b) => b.grossProfit - a.grossProfit);

    // Format daily profitability
    const daily = Object.values(dailyProfitability).map(d => ({
      ...d,
      grossProfit: d.revenue - d.cogs,
      grossMargin: d.revenue > 0 ? ((d.revenue - d.cogs) / d.revenue) * 100 : 0
    })).sort((a, b) => a.date.localeCompare(b.date));

    return {
      summary: {
        totalRevenue: glRevenue,
        totalCOGS: glCOGS,
        totalShippingCost,
        totalDiscount,
        totalCommissions,
        totalOperatingExpenses,
        grossProfit,
        grossMargin,
        netProfit,
        netMargin,
        orderCount: orders.length,
        dataSources: {
          revenue: 'GL account 4010 (matches Overview)',
          cogs: 'GL account 5010 (matches Overview)',
          commissions: 'GL accounts 5040/5050 (accrual)',
          operatingExpenses: 'GL non-COGS, non-commission expense accounts',
        }
      },
      products,
      daily,
    };
  }

  /**
   * Update an existing expense
   */
  async updateExpense(
    expenseId: string,
    data: {
      category?: string;
      amount?: number;
      description?: string;
      expenseDate?: Date;
    }
    , requester?: Requester) {
    if (data.amount !== undefined && data.amount <= 0) {
      throw new AppError('Expense amount must be a positive number', 400);
    }

    const expense = await prisma.expense.findUnique({
      where: { id: parseInt(expenseId, 10) }
    });

    if (!expense) {
      throw new AppError('Expense not found', 404);
    }

    // Role-based ownership check for updating expense
    if (!checkResourceOwnership(requester!, expense, 'expense')) {
      throw new AppError('You do not have permission to update this expense', 403);
    }

    const numericId = parseInt(expenseId, 10);
    const updated = await prisma.$transaction(async (tx) => {
      // Void old GL entry before updating
      await GLAutomationService.voidJournalEntry(tx as any, 'expense', numericId, requester?.id ?? SYSTEM_USER_ID);

      const result = await tx.expense.update({
        where: { id: numericId },
        data: {
          ...(data.category && { category: data.category }),
          ...(data.amount !== undefined && { amount: data.amount }),
          ...(data.description && { description: data.description }),
          ...(data.expenseDate && { expenseDate: data.expenseDate })
        },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        }
      });

      // Create new GL entry with updated amount
      const newAmount = data.amount !== undefined ? data.amount : Number(expense.amount);
      const newDescription = data.description || expense.description;
      await GLAutomationService.createExpenseGLEntry(
        tx as any,
        numericId,
        newAmount,
        newDescription,
        requester?.id ?? SYSTEM_USER_ID
      );

      // Remap Prisma relation `user` → `recordedBy` for frontend compatibility
      const { user, ...rest } = result as any;
      return { ...rest, recordedBy: user || null };
    }, TRANSACTION_CONFIG);

    // Invalidate forecast cache since expense data changed
    this.forecastCache.clear();

    logger.info('Expense updated', {
      expenseId,
      changes: data
    });

    // Emit Socket.io event
    const ioInstance = getSocketInstance();
    if (ioInstance) {
      emitExpenseUpdated(ioInstance as any, updated);
    }

    return updated;
  }

  /**
   * Delete an expense
   */
  async deleteExpense(expenseId: string, requester?: Requester) {
    const expense = await prisma.expense.findUnique({
      where: { id: parseInt(expenseId, 10) }
    });

    if (!expense) {
      throw new AppError('Expense not found', 404);
    }

    // Role-based ownership check for deleting expense
    if (!checkResourceOwnership(requester!, expense, 'expense')) {
      throw new AppError('You do not have permission to delete this expense', 403);
    }

    const numericExpenseId = parseInt(expenseId, 10);
    await prisma.$transaction(async (tx) => {
      // Void GL entry before deleting expense
      await GLAutomationService.voidJournalEntry(tx as any, 'expense', numericExpenseId, requester?.id ?? SYSTEM_USER_ID);

      await tx.expense.delete({
        where: { id: numericExpenseId }
      });
    }, TRANSACTION_CONFIG);

    // Invalidate forecast cache since expense data changed
    this.forecastCache.clear();

    logger.info('Expense deleted', {
      expenseId,
      category: expense.category,
      amount: expense.amount
    });

    // Emit Socket.io event
    const ioInstance = getSocketInstance();
    if (ioInstance) {
      emitExpenseDeleted(ioInstance as any, expenseId);
    }

    return { message: 'Expense deleted successfully' };
  }

  /**
   * Get pipeline revenue (expected revenue from active orders)
   */
  async getPipelineRevenue(requester?: Requester) {
    const where: Prisma.OrderWhereInput = {
      status: {
        in: ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery']
      },
      deletedAt: null,
    };

    // Role-based filtering for pipeline revenue
    if (requester && requester.role === 'sales_rep') {
      where.customerRepId = requester.id;
    } else if (requester && requester.role === 'delivery_agent') {
      where.deliveryAgentId = requester.id;
    }

    const orders = await prisma.order.findMany({
      where,
      select: {
        totalAmount: true,
        status: true
      }
    });

    // Calculate total expected revenue
    const totalExpected = orders.reduce((sum, order) => sum + order.totalAmount, 0);

    // Group by status
    const byStatus = orders.reduce((acc, order) => {
      const existing = acc.find((item) => item.status === order.status);
      if (existing) {
        existing.amount += order.totalAmount;
        existing.count += 1;
      } else {
        acc.push({
          status: order.status,
          amount: order.totalAmount,
          count: 1
        });
      }
      return acc;
    }, [] as { status: string; amount: number; count: number }[]);

    return {
      totalExpected,
      byStatus
    };
  }

  /**
   * Get agent cash holdings (collected but not deposited)
   */
  async getAgentCashHoldings(requester?: Requester) {
    // 1. Get all agents with a non-zero balance from AgentBalance
    const query: Prisma.AgentBalanceWhereInput = {
      currentBalance: { gt: 0 },
    };

    if (requester && requester.role === 'delivery_agent') {
      query.agentId = requester.id;
    }

    const balances = await prisma.agentBalance.findMany({
      where: query,
      include: {
        agent: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    }) || [];

    if (balances.length === 0) return [];

    // 2. Batch query all agent collection stats in a single groupBy (avoids N+1)
    const agentIds = balances.map(b => b.agentId);
    const [collectionCounts, oldestCollections] = await Promise.all([
      (prisma as any).agentCollection.groupBy({
        by: ['agentId'],
        where: {
          agentId: { in: agentIds },
          status: { in: ['draft', 'verified', 'approved'] }
        },
        _count: { id: true },
      }),
      (prisma as any).agentCollection.groupBy({
        by: ['agentId'],
        where: {
          agentId: { in: agentIds },
          status: { in: ['draft', 'verified', 'approved'] }
        },
        _min: { collectionDate: true },
      }),
    ]);

    // Build lookup maps
    const countMap = new Map<number, number>();
    for (const row of collectionCounts) {
      countMap.set(row.agentId, row._count.id);
    }
    const oldestMap = new Map<number, Date>();
    for (const row of oldestCollections) {
      if (row._min.collectionDate) {
        oldestMap.set(row.agentId, row._min.collectionDate);
      }
    }

    const holdings: AgentHolding[] = balances.map((b) => ({
      agent: {
        id: b.agent.id,
        firstName: b.agent.firstName,
        lastName: b.agent.lastName,
        email: b.agent.email
      },
      totalCollected: this.toNumber(b.currentBalance),
      orderCount: countMap.get(b.agentId) || 0,
      OldestCollectionDate: oldestMap.get(b.agentId) || b.updatedAt
    }));

    // Sort by total collected (descending)
    return holdings.sort((a, b) => b.totalCollected - a.totalCollected).slice(0, 20);
  }

  /**
   * Get Cash Flow Report
   */
  async getCashFlowReport(requester?: Requester) {
    // 1. Get current cash position KPIs from GL
    const [cashInHand, , arAgents] = await Promise.all([
      prisma.account.findUnique({ where: { code: GL_ACCOUNTS.CASH_IN_HAND } }),
      prisma.account.findUnique({ where: { code: GL_ACCOUNTS.CASH_IN_TRANSIT } }),
      prisma.account.findUnique({ where: { code: GL_ACCOUNTS.AR_AGENTS } }),
    ]);

    // 2. Calculate operational figures from actual order status
    const [cashInTransitData, cashExpectedData] = await Promise.all([
      prisma.order.aggregate({
        where: {
          status: 'delivered',
          paymentStatus: { notIn: ['reconciled', 'deposited'] },
          deletedAt: null,
            },
        _sum: { totalAmount: true }
      }),
      prisma.order.aggregate({
        where: {
          status: 'out_for_delivery',
          deletedAt: null,
          codAmount: { not: null },
            },
        _sum: { totalAmount: true }
      })
    ]);

    const kpis = {
      cashInHand: this.toNumber(cashInHand?.currentBalance),
      cashInTransit: this.toNumber(cashInTransitData._sum.totalAmount),
      outstandingReceivables: this.toNumber(arAgents?.currentBalance),
      cashExpected: this.toNumber(cashExpectedData._sum.totalAmount),
    };

    const cashAvailableNow = kpis.cashInHand + kpis.outstandingReceivables;
    const totalCashPosition = kpis.cashInHand + kpis.cashInTransit + kpis.outstandingReceivables + kpis.cashExpected;
    const totalCashPipeline = cashAvailableNow + kpis.cashInTransit + kpis.cashExpected;

    // 3. 30-day Forecast
    const forecast = await this.generateCashFlowForecast();

    // 4. Agent Breakdown (Pending collections)
    const agentBreakdown = await this.getAgentCashHoldings(requester);

    return {
      kpis: { ...kpis, cashAvailableNow, totalCashPosition, totalCashPipeline },
      forecast,
      agentBreakdown
    };
  }

  /**
   * Generate 30-day Cash Flow Forecast
   * Uses historical data (last 30 days) to project future flows
   */
  async generateCashFlowForecast() {
    const tenantId = getTenantId();
    const cacheKey = tenantId ?? '__system__';
    const cached = this.forecastCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.FORECAST_CACHE_DURATION_MS) {
      return cached.data;
    }

    // Calculate historical averages (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [historicalCollections, historicalExpenses] = await Promise.all([
      prisma.transaction.aggregate({
        where: {
          type: 'cod_collection',
          status: { in: ['collected', 'deposited', 'reconciled'] },
          createdAt: { gte: thirtyDaysAgo },
          order: {
            deletedAt: null
          },
            },
        _sum: { amount: true }
      }),
      prisma.expense.aggregate({
        where: {
          expenseDate: { gte: thirtyDaysAgo },
            },
        _sum: { amount: true }
      })
    ]);

    const avgDailyCollection = this.toNumber(historicalCollections._sum.amount) / 30;
    const avgDailyExpense = this.toNumber(historicalExpenses._sum.amount) / 30;

    // Start with current liquidity (Cash in Hand + Bank if existed)
    // For this implementation, we'll use Total Cash Position as starting balance
    const [cashInHand, cashInTransit] = await Promise.all([
      prisma.account.findUnique({ where: { code: GL_ACCOUNTS.CASH_IN_HAND } }),
      prisma.account.findUnique({ where: { code: GL_ACCOUNTS.CASH_IN_TRANSIT } }),
    ]);

    let runningBalance = this.toNumber(cashInHand?.currentBalance) + this.toNumber(cashInTransit?.currentBalance);

    const forecast: CashFlowForecast[] = [];
    const today = new Date();

    for (let i = 1; i <= 30; i++) {
      const forecastDate = new Date(today);
      forecastDate.setDate(today.getDate() + i);

      runningBalance += (avgDailyCollection - avgDailyExpense);

      forecast.push({
        date: forecastDate.toISOString().split('T')[0],
        expectedCollection: avgDailyCollection,
        expectedExpense: avgDailyExpense,
        projectedBalance: Math.max(0, runningBalance)
      });
    }

    this.forecastCache.set(cacheKey, { data: forecast, timestamp: Date.now() });
    return forecast;
  }

  /**
   * Export Cash Flow Report as CSV
   */
  async exportCashFlowCSV(requester?: Requester) {
    const report = await this.getCashFlowReport(requester);

    // Prepare data for CSV
    const csvData = [
      { Section: 'KPIs', Label: 'Cash in Hand', Value: report.kpis.cashInHand },
      { Section: 'KPIs', Label: 'Cash in Transit', Value: report.kpis.cashInTransit },
      { Section: 'KPIs', Label: 'Outstanding Receivables', Value: report.kpis.outstandingReceivables },
      { Section: 'KPIs', Label: 'Cash Expected', Value: report.kpis.cashExpected },
      { Section: 'KPIs', Label: 'Total Cash Position', Value: report.kpis.totalCashPosition },
      { Section: '---', Label: '---', Value: '---' },
      { Section: 'Forecast (Next 30 Days)', Label: 'Date', Value: 'Projected Balance' },
      ...report.forecast.map(f => ({
        Section: 'Forecast',
        Label: f.date,
        Value: f.projectedBalance
      }))
    ];

    const parser = new Parser();
    return parser.parse(csvData);
  }

  /**
   * Get Balance Sheet as of a specific date
   */
  async getBalanceSheet(asOfDateValue?: string | Date) {
    const asOfDate = asOfDateValue ? new Date(asOfDateValue) : new Date();
    // Ensure asOfDate includes the entire day
    asOfDate.setHours(23, 59, 59, 999);

    // Query all active accounts
    const accounts = await prisma.account.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        accountType: true,
        normalBalance: true
      }
    });

    // Use Prisma groupBy to aggregate transactions for all accounts at once
    const aggregations = await prisma.accountTransaction.groupBy({
      by: ['accountId'],
      where: {
        journalEntry: { isVoided: false, entryDate: { lte: asOfDate } },
        },
      _sum: {
        debitAmount: true,
        creditAmount: true
      }
    });

    // Create a map for quick lookup
    const aggregationMap = new Map();
    aggregations.forEach(agg => {
      aggregationMap.set(agg.accountId, {
        debit: this.toNumber(agg._sum.debitAmount),
        credit: this.toNumber(agg._sum.creditAmount)
      });
    });

    const categories: Record<string, { accounts: FinancialStatementAccount[]; total: number }> = {
      asset: { accounts: [], total: 0 },
      liability: { accounts: [], total: 0 },
      equity: { accounts: [], total: 0 },
      revenue: { accounts: [], total: 0 },
      expense: { accounts: [], total: 0 }
    };

    // Process accounts using pre-calculated aggregations
    accounts.forEach(account => {
      const agg = aggregationMap.get(account.id) || { debit: 0, credit: 0 };

      let balance = 0;
      if (account.normalBalance === 'debit') {
        balance = agg.debit - agg.credit;
      } else {
        balance = agg.credit - agg.debit;
      }

      const financialAccount = {
        id: account.id,
        code: account.code,
        name: account.name,
        balance
      };

      if (categories[account.accountType]) {
        categories[account.accountType].accounts.push(financialAccount);
        categories[account.accountType].total += balance;
      }
    });

    // Calculate Retained Earnings: Total Revenue - Total Expense (all time up to asOfDate)
    const retainedEarnings = categories.revenue.total - categories.expense.total;

    // Equity: System Equity Accounts + Retained Earnings
    const totalEquity = categories.equity.total + retainedEarnings;
    const totalLiabilitiesAndEquity = categories.liability.total + totalEquity;
    const totalAssets = categories.asset.total;

    return {
      asOfDate,
      assets: categories.asset,
      liabilities: categories.liability,
      equity: {
        accounts: categories.equity.accounts,
        retainedEarnings,
        total: totalEquity
      },
      totalLiabilitiesAndEquity,
      isBalanced: Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01
    } as BalanceSheetData;
  }

  /**
   * Get Profit and Loss Statement for a specific period
   */
  async getProfitLoss(startDateValue: string | Date, endDateValue: string | Date) {
    const startDate = new Date(startDateValue);
    const endDate = new Date(endDateValue);
    // Ensure endDate includes the entire day
    endDate.setHours(23, 59, 59, 999);

    // Query all revenue and expense accounts
    const accounts = await prisma.account.findMany({
      where: {
        isActive: true,
        accountType: { in: ['revenue', 'expense'] }
      },
      select: {
        id: true,
        code: true,
        name: true,
        accountType: true,
        normalBalance: true
      }
    });

    const aggregations = await prisma.accountTransaction.groupBy({
      by: ['accountId'],
      where: {
        journalEntry: { isVoided: false, entryDate: { gte: startDate, lte: endDate } },
        },
      _sum: {
        debitAmount: true,
        creditAmount: true
      }
    });

    const aggregationMap = new Map();
    aggregations.forEach(agg => {
      aggregationMap.set(agg.accountId, {
        debit: this.toNumber(agg._sum.debitAmount),
        credit: this.toNumber(agg._sum.creditAmount)
      });
    });

    const result: ProfitLossData = {
      startDate,
      endDate,
      revenue: { accounts: [], total: 0 },
      cogs: { accounts: [], total: 0 },
      expenses: { accounts: [], total: 0 },
      grossProfit: 0,
      grossMarginPercentage: 0,
      netIncome: 0,
      netMarginPercentage: 0
    };

    accounts.forEach(account => {
      const agg = aggregationMap.get(account.id) || { debit: 0, credit: 0 };

      let balance = 0;
      if (account.normalBalance === 'debit') {
        balance = agg.debit - agg.credit;
      } else {
        balance = agg.credit - agg.debit;
      }

      const financialAccount = {
        id: account.id,
        code: account.code,
        name: account.name,
        balance
      };

      if (account.accountType === 'revenue') {
        result.revenue.accounts.push(financialAccount);
        result.revenue.total += balance;
      } else if (account.accountType === 'expense') {
        if (account.code === GL_ACCOUNTS.COGS) {
          result.cogs.accounts.push(financialAccount);
          result.cogs.total += balance;
        } else {
          result.expenses.accounts.push(financialAccount);
          result.expenses.total += balance;
        }
      }
    });

    result.grossProfit = result.revenue.total - result.cogs.total;
    result.grossMarginPercentage = result.revenue.total > 0 ? (result.grossProfit / result.revenue.total) * 100 : 0;
    result.netIncome = result.grossProfit - result.expenses.total;
    result.netMarginPercentage = result.revenue.total > 0 ? (result.netIncome / result.revenue.total) * 100 : 0;

    return result;
  }

  /**
   * Get agent aging analysis
   */
  async getAgentAgingAnalysis() {
    const agents = await prisma.user.findMany({
      where: {
        role: 'delivery_agent',
        isActive: true,
      },
      include: {
        agingBucket: true,
        balance: true,
      }
    });

    return agents.map(agent => ({
      agentId: agent.id,
      name: `${agent.firstName} ${agent.lastName}`,
      email: agent.email,
      balance: this.toNumber(agent.balance?.currentBalance),
      buckets: {
        '0-1 days': this.toNumber(agent.agingBucket?.bucket_0_1),
        '2-3 days': this.toNumber(agent.agingBucket?.bucket_2_3),
        '4-7 days': this.toNumber(agent.agingBucket?.bucket_4_7),
        '8+ days': this.toNumber(agent.agingBucket?.bucket_8_plus),
      },
      totalBalance: this.toNumber(agent.agingBucket?.totalBalance),
      oldestCollectionDate: agent.agingBucket?.oldestCollectionDate,
      isBlocked: agent.balance?.isBlocked || false,
    }));
  }
}

export default new FinancialService();
