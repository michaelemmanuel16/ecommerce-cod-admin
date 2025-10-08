import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';

export const getFinancialSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const [revenue, expenses, codCollections] = await Promise.all([
      prisma.transaction.aggregate({
        where: {
          ...where,
          type: 'cod_collection',
          status: 'collected'
        },
        _sum: { amount: true }
      }),
      prisma.expense.aggregate({
        where: {
          expenseDate: where.createdAt
        },
        _sum: { amount: true }
      }),
      prisma.transaction.aggregate({
        where: {
          ...where,
          type: 'cod_collection',
          status: 'collected'
        },
        _sum: { amount: true }
      })
    ]);

    const totalRevenue = revenue._sum.amount || 0;
    const totalExpenses = expenses._sum.amount || 0;
    const totalCOD = codCollections._sum.amount || 0;

    const summary = {
      totalRevenue,
      totalExpenses,
      profit: totalRevenue - totalExpenses,
      codCollected: totalCOD,
      profitMargin: totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue) * 100 : 0
    };

    res.json({ summary });
  } catch (error) {
    throw error;
  }
};

export const getAllTransactions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { type, status, page = 1, limit = 20 } = req.query;

    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;

    const skip = (Number(page) - 1) * Number(limit);

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          order: {
            select: {
              orderNumber: true,
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

    res.json({
      transactions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    throw error;
  }
};

export const recordExpense = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { category, amount, description, expenseDate } = req.body;

    const expense = await prisma.expense.create({
      data: {
        category,
        amount,
        description,
        expenseDate: new Date(expenseDate),
        recordedBy: req.user!.id
      }
    });

    res.status(201).json({ expense });
  } catch (error) {
    throw error;
  }
};

export const getCODCollections = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { agentId, status, page = 1, limit = 20 } = req.query;

    const where: any = {
      type: 'cod_collection'
    };

    if (status) where.status = status;

    const skip = (Number(page) - 1) * Number(limit);

    const [collections, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          order: {
            select: {
              orderNumber: true,
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
      filteredCollections = collections.filter(
        c => c.order?.deliveryAgent?.id === agentId
      );
    }

    res.json({
      collections: filteredCollections,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: agentId ? filteredCollections.length : total,
        pages: Math.ceil((agentId ? filteredCollections.length : total) / Number(limit))
      }
    });
  } catch (error) {
    throw error;
  }
};

export const getFinancialReports = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { period = 'daily', startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : new Date();
    const end = endDate ? new Date(endDate as string) : new Date();

    const transactions = await prisma.transaction.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end
        }
      },
      include: {
        order: true
      }
    });

    const expenses = await prisma.expense.findMany({
      where: {
        expenseDate: {
          gte: start,
          lte: end
        }
      }
    });

    // Group by period
    const groupedData: any = {};

    transactions.forEach(t => {
      const key = period === 'daily'
        ? t.createdAt.toISOString().split('T')[0]
        : `${t.createdAt.getFullYear()}-${String(t.createdAt.getMonth() + 1).padStart(2, '0')}`;

      if (!groupedData[key]) {
        groupedData[key] = { revenue: 0, expenses: 0, orders: 0 };
      }

      if (t.type === 'cod_collection') {
        groupedData[key].revenue += t.amount;
        groupedData[key].orders += 1;
      }
    });

    expenses.forEach(e => {
      const key = period === 'daily'
        ? e.expenseDate.toISOString().split('T')[0]
        : `${e.expenseDate.getFullYear()}-${String(e.expenseDate.getMonth() + 1).padStart(2, '0')}`;

      if (!groupedData[key]) {
        groupedData[key] = { revenue: 0, expenses: 0, orders: 0 };
      }

      groupedData[key].expenses += e.amount;
    });

    const reports = Object.entries(groupedData).map(([date, data]: [string, any]) => ({
      date,
      revenue: data.revenue,
      expenses: data.expenses,
      profit: data.revenue - data.expenses,
      orders: data.orders
    }));

    res.json({ reports });
  } catch (error) {
    throw error;
  }
};
