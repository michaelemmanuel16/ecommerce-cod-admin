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

export class FinancialService {
  /**
   * Get financial summary
   */
  async getFinancialSummary(filters: DateFilters, requester?: Requester) {
    const { startDate, endDate } = filters;

    const dateWhere: any = {};
    if (startDate || endDate) {
      dateWhere.createdAt = {};
      if (startDate) dateWhere.createdAt.gte = startDate;
      if (endDate) dateWhere.createdAt.lte = endDate;
    }

    const expenseDateWhere: any = {};
    if (startDate || endDate) {
      expenseDateWhere.expenseDate = {};
      if (startDate) expenseDateWhere.expenseDate.gte = startDate;
      if (endDate) expenseDateWhere.expenseDate.lte = endDate;
    }

    const orderDateWhere: any = {};
    if (startDate || endDate) {
      orderDateWhere.createdAt = {};
      if (startDate) orderDateWhere.createdAt.gte = startDate;
      if (endDate) orderDateWhere.createdAt.lte = endDate;
    }

    const orderWhere: Prisma.OrderWhereInput = {
      status: 'delivered',
      deletedAt: null
    };

    if (Object.keys(orderDateWhere).length > 0) {
      orderWhere.createdAt = orderDateWhere.createdAt;
    }

    // Role-based filtering for financial summary
    if (requester && requester.role === 'sales_rep') {
      orderWhere.customerRepId = requester.id;
    } else if (requester && requester.role === 'delivery_agent') {
      orderWhere.deliveryAgentId = requester.id;
    }

    const transactionWhere: Prisma.TransactionWhereInput = {
      type: 'cod_collection'
    };
    if (Object.keys(dateWhere).length > 0) {
      transactionWhere.createdAt = dateWhere.createdAt;
    }
    if (requester && requester.role === 'delivery_agent') {
      transactionWhere.order = { deliveryAgentId: requester.id };
    }


    // Role-based filtering for financial summary expenses
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      expenseDateWhere.recordedBy = requester.id;
    }

    const [revenue, expenses, codCollections, pendingCOD, deliveredOrders, outForDeliveryOrders] = await Promise.all([
      prisma.transaction.aggregate({
        where: {
          ...transactionWhere,
          status: 'collected'
        },
        _sum: { amount: true }
      }),
      prisma.expense.aggregate({
        where: expenseDateWhere,
        _sum: { amount: true }
      }),
      prisma.transaction.aggregate({
        where: {
          ...transactionWhere,
          status: { in: ['collected', 'deposited', 'reconciled'] }
        },
        _sum: { amount: true }
      }),
      prisma.transaction.aggregate({
        where: {
          ...transactionWhere,
          status: 'pending'
        },
        _sum: { amount: true }
      }),
      // Count delivered orders where payment hasn't been collected (COD orders with codAmount)
      prisma.order.aggregate({
        where: {
          ...orderWhere,
          codAmount: { not: null },
          paymentStatus: 'pending',
        },
        _sum: { totalAmount: true }
      }),
      // Count out-for-delivery orders (COD being collected)
      prisma.order.aggregate({
        where: {
          ...orderWhere,
          status: 'out_for_delivery',
          codAmount: { not: null },
        },
        _sum: { totalAmount: true }
      })
    ]);

    const totalRevenue = revenue._sum.amount || 0;
    const totalExpenses = expenses._sum.amount || 0;
    const totalCOD = codCollections._sum.amount || 0;
    const transactionPending = pendingCOD._sum.amount || 0;
    const deliveredPending = deliveredOrders._sum.totalAmount || 0;
    const outForDelivery = outForDeliveryOrders._sum.totalAmount || 0;

    // Outstanding COD = pending transactions + delivered orders awaiting collection + orders out for delivery
    const pendingCODAmount = transactionPending + deliveredPending + outForDelivery;

    const summary = {
      totalRevenue,
      totalExpenses,
      profit: totalRevenue - totalExpenses,
      codCollected: totalCOD,
      codPending: pendingCODAmount,
      profitMargin: totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue) * 100 : 0
    };

    return summary;
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
    const expense = await prisma.expense.create({
      data: {
        category: data.category,
        amount: data.amount,
        description: data.description,
        expenseDate: data.expenseDate,
        recordedBy: requester ? requester.id : parseInt(data.recordedBy, 10),
        receiptUrl: data.receiptUrl
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

    const [expenses, total] = await Promise.all([
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
      type: 'cod_collection'
    };

    if (status) where.status = status;

    if (agentId) {
      where.order = { deliveryAgentId: parseInt(agentId, 10) };
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
        deliveryAgentId: parseInt(agentId, 10)
      }
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

    const updated = await prisma.transaction.update({
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
      await prisma.order.update({
        where: { id: transaction.orderId },
        data: { paymentStatus: status }
      });
    }

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
        status: 'collected'
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

    const updated = await prisma.transaction.updateMany({
      where: {
        id: { in: transactions.map(t => t.id) }
      },
      data: {
        status: 'deposited',
        reference: depositReference
      }
    });

    // Update corresponding orders
    await prisma.order.updateMany({
      where: {
        id: { in: transactions.filter(t => t.orderId).map(t => t.orderId as number) }
      },
      data: {
        paymentStatus: 'deposited'
      }
    });

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
      deletedAt: null
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
      }
    };
    if (requester && requester.role === 'delivery_agent') {
      transactionWhere.order = { deliveryAgentId: requester.id };
    }

    const expenseWhere: Prisma.ExpenseWhereInput = {
      expenseDate: {
        gte: start,
        lte: end
      }
    };
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      expenseWhere.recordedBy = requester.id;
    }


    const [transactions, expenses] = await Promise.all([
      prisma.transaction.findMany({
        where: transactionWhere,
        include: {
          order: true
        }
      }),
      prisma.expense.findMany({
        where: expenseWhere
      })
    ]);

    // Group by period
    const groupedData: Record<string, { revenue: number; expenses: number; orders: number }> = {};

    transactions.forEach((t) => {
      const key =
        period === 'daily'
          ? t.createdAt.toISOString().split('T')[0]
          : `${t.createdAt.getFullYear()}-${String(t.createdAt.getMonth() + 1).padStart(2, '0')}`;

      if (!groupedData[key]) {
        groupedData[key] = { revenue: 0, expenses: 0, orders: 0 };
      }

      if (t.type === 'cod_collection' && ['collected', 'deposited', 'reconciled'].includes(t.status)) {
        groupedData[key].revenue += t.amount;
        groupedData[key].orders += 1;
      }
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
    }));

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

    const breakdown = await prisma.expense.groupBy({
      by: ['category'],
      where,
      _sum: {
        amount: true
      },
      _count: true,
      orderBy: {
        _sum: {
          amount: 'desc'
        }
      }
    });

    return breakdown.map((item) => ({
      category: item.category,
      totalAmount: item._sum.amount || 0,
      count: item._count
    }));
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
      status: 'delivered'
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
        totalCost += (Number(item.product.cogs) || 0) * item.quantity;
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
    const { startDate, endDate, productId } = filters;

    // Filters for delivered orders
    const orderWhere: Prisma.OrderWhereInput = {
      status: 'delivered',
      deletedAt: null,
    };

    if (startDate || endDate) {
      orderWhere.deliveryDate = {};
      if (startDate) orderWhere.deliveryDate.gte = startDate;
      if (endDate) orderWhere.deliveryDate.lte = endDate;
    }

    if (productId) {
      orderWhere.orderItems = {
        some: {
          productId: productId,
        },
      };
    }

    // Fetch orders with items and products (to get COGS)
    const orders = await prisma.order.findMany({
      where: orderWhere,
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
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
      grossProfit: number
    }> = {};

    const dailyProfitability: Record<string, {
      date: string,
      revenue: number,
      cogs: number,
      grossProfit: number
    }> = {};

    for (const order of orders) {
      totalRevenue += order.subtotal;
      totalShippingCost += order.shippingCost;
      totalDiscount += order.discount;

      const dateStr = order.deliveryDate ? order.deliveryDate.toISOString().split('T')[0] : 'unknown';
      if (!dailyProfitability[dateStr]) {
        dailyProfitability[dateStr] = {
          date: dateStr,
          revenue: 0,
          cogs: 0,
          grossProfit: 0
        };
      }
      dailyProfitability[dateStr].revenue += order.subtotal;

      for (const item of order.orderItems) {
        const itemCOGS = (Number(item.product.cogs) || 0) * item.quantity;
        totalCOGS += itemCOGS;
        dailyProfitability[dateStr].cogs += itemCOGS;

        if (!productProfitability[item.productId]) {
          productProfitability[item.productId] = {
            id: item.productId,
            name: item.product.name,
            sku: item.product.sku,
            revenue: 0,
            cogs: 0,
            quantity: 0,
            grossProfit: 0
          };
        }

        productProfitability[item.productId].revenue += item.unitPrice * item.quantity;
        productProfitability[item.productId].cogs += itemCOGS;
        productProfitability[item.productId].quantity += item.quantity;
      }
    }

    // Calculate marketing expenses
    const expenseWhere: Prisma.ExpenseWhereInput = {
      category: 'marketing',
    };
    if (startDate || endDate) {
      expenseWhere.expenseDate = {};
      if (startDate) expenseWhere.expenseDate.gte = startDate;
      if (endDate) expenseWhere.expenseDate.lte = endDate;
    }

    const marketingExpenses = await prisma.expense.findMany({
      where: expenseWhere,
    });

    const totalMarketingExpense = marketingExpenses.reduce((sum, e) => sum + e.amount, 0);

    const grossProfit = totalRevenue - totalCOGS;
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    const netProfit = grossProfit - totalMarketingExpense;
    const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    // Format product profitability
    const products = Object.values(productProfitability).map(p => ({
      ...p,
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
        totalRevenue,
        totalCOGS,
        totalShippingCost,
        totalDiscount,
        totalMarketingExpense,
        grossProfit,
        grossMargin,
        netProfit,
        netMargin,
        orderCount: orders.length
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

    const updated = await prisma.expense.update({
      where: { id: parseInt(expenseId, 10) },
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

    await prisma.expense.delete({
      where: { id: parseInt(expenseId, 10) }
    });

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
  async getPipelineRevenue(filters: DateFilters, requester?: Requester) {
    const where: Prisma.OrderWhereInput = {
      status: {
        in: ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery']
      },
      deletedAt: null
    };

    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

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
    // Get all transactions where COD is collected but not deposited
    const collections = await prisma.transaction.findMany({
      where: {
        type: 'cod_collection',
        status: 'collected'
      },
      include: {
        order: {
          include: {
            deliveryAgent: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true
              }
            }
          }
        }
      }
    });

    // Group by delivery agent
    const holdingsMap: Record<number, {
      agent: { id: number; firstName: string; lastName: string; email: string };
      totalCollected: number;
      orderCount: number;
      oldestCollectionDate: Date;
    }> = {};

    collections.forEach((collection) => {
      if (collection.order?.deliveryAgent) {
        const agentId = collection.order.deliveryAgent.id;

        if (!holdingsMap[agentId]) {
          holdingsMap[agentId] = {
            agent: collection.order.deliveryAgent,
            totalCollected: 0,
            orderCount: 0,
            oldestCollectionDate: collection.createdAt
          };
        }

        holdingsMap[agentId].totalCollected += collection.amount;
        holdingsMap[agentId].orderCount += 1;

        // Update oldest collection date
        if (collection.createdAt < holdingsMap[agentId].oldestCollectionDate) {
          holdingsMap[agentId].oldestCollectionDate = collection.createdAt;
        }
      }
    });

    // Convert to array and sort by total collected (descending)
    let holdings = Object.values(holdingsMap).sort((a, b) => b.totalCollected - a.totalCollected);

    // Filter by ownership if delivery_agent
    if (requester && requester.role === 'delivery_agent') {
      holdings = holdings.filter(h => h.agent.id === requester.id);
    }

    return holdings;
  }
}

export default new FinancialService();
