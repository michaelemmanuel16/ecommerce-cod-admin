import { Response } from 'express';
import { AuthRequest } from '../types';
import { PaymentStatus } from '@prisma/client';
import financialService from '../services/financialService';
import agingService from '../services/agingService';
import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';
import logger from '../utils/logger';
import { GLAccountService } from '../services/glAccountService';
import prisma from '../utils/prisma';

export const getFinancialSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  const { startDate, endDate } = req.query;

  const summary = await financialService.getFinancialSummary({
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined
  }, req.user);

  res.json({ summary });
};

export const getAllTransactions = async (req: AuthRequest, res: Response): Promise<void> => {
  const { type, status, page = 1, limit = 20 } = req.query;

  const result = await financialService.getAllTransactions({
    type: type as string | undefined,
    status: status as PaymentStatus | undefined,
    page: Number(page),
    limit: Number(limit)
  });

  res.json(result);
};

export const recordExpense = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { category, amount, description, expenseDate } = req.body;

    const expense = await financialService.recordExpense({
      category,
      amount,
      description,
      expenseDate: new Date(expenseDate),
      recordedBy: req.user!.id.toString()
    }, req.user);

    res.status(201).json({ expense });
  } catch (error: any) {
    const status = error.statusCode || error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to record expense' });
  }
};

export const getCODCollections = async (req: AuthRequest, res: Response): Promise<void> => {
  const { agentId, status, page = 1, limit = 20 } = req.query;

  const result = await financialService.getCODCollections({
    agentId: agentId as string | undefined,
    status: status as PaymentStatus | undefined,
    page: Number(page),
    limit: Number(limit)
  });

  res.json(result);
};

export const getFinancialReports = async (req: AuthRequest, res: Response): Promise<void> => {
  const { period = 'daily', startDate, endDate } = req.query;

  const reports = await financialService.getFinancialReports({
    period: period as string,
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined
  });

  res.json({ reports });
};

export const getProfitMargins = async (req: AuthRequest, res: Response): Promise<void> => {
  const { startDate, endDate } = req.query;

  const profitMargins = await financialService.calculateProfitMargins({
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined
  });

  res.json(profitMargins);
};

export const getPipelineRevenue = async (req: AuthRequest, res: Response): Promise<void> => {
  const pipelineRevenue = await financialService.getPipelineRevenue(req.user);
  res.json(pipelineRevenue);
};

export const getProfitabilityAnalysis = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, productId } = req.query;

    const analysis = await financialService.getProfitabilityAnalysis({
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      productId: productId ? parseInt(productId as string, 10) : undefined
    });

    res.json(analysis);
  } catch (error) {
    logger.error('Failed to fetch profitability analysis', { error });
    res.status(500).json({ message: 'Failed to fetch profitability analysis' });
  }
};

export const exportProfitabilityAnalysis = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, productId, format = 'csv' } = req.query;

    const analysis = await financialService.getProfitabilityAnalysis({
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      productId: productId ? parseInt(productId as string, 10) : undefined
    });

    const exportData = analysis.products.map(p => ({
      'Product Name': p.name,
      'SKU': p.sku,
      'Quantity Sold': p.quantity,
      'Total Revenue': p.revenue,
      'Total COGS': p.cogs,
      'Gross Profit': p.grossProfit,
      'Gross Margin %': p.grossMargin.toFixed(2)
    }));

    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Profitability');

      worksheet.columns = [
        { header: 'Product Name', key: 'Product Name', width: 30 },
        { header: 'SKU', key: 'SKU', width: 15 },
        { header: 'Quantity Sold', key: 'Quantity Sold', width: 15 },
        { header: 'Total Revenue', key: 'Total Revenue', width: 15 },
        { header: 'Total COGS', key: 'Total COGS', width: 15 },
        { header: 'Gross Profit', key: 'Gross Profit', width: 15 },
        { header: 'Gross Margin %', key: 'Gross Margin %', width: 15 }
      ];

      worksheet.addRows(exportData);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=profitability_report_${Date.now()}.xlsx`);

      const buffer = await workbook.xlsx.writeBuffer();
      res.send(buffer);
    } else {
      const json2csvParser = new Parser();
      const csv = json2csvParser.parse(exportData);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=profitability_report_${Date.now()}.csv`);
      res.send(csv);
    }
  } catch (error) {
    logger.error('Export profitability analysis failed', { error });
    res.status(500).json({ message: 'Export failed' });
  }
};

export const getAllExpenses = async (req: AuthRequest, res: Response): Promise<void> => {
  const { category, startDate, endDate, page = 1, limit = 20 } = req.query;

  const result = await financialService.getAllExpenses({
    category: category as string | undefined,
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined,
    page: Number(page),
    limit: Number(limit)
  });

  res.json(result);
};

export const getExpenseBreakdown = async (req: AuthRequest, res: Response): Promise<void> => {
  const { startDate, endDate } = req.query;

  const breakdown = await financialService.getExpenseBreakdown({
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined
  });

  res.json({ breakdown });
};

export const updateExpense = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { category, amount, description, expenseDate } = req.body;

    const expense = await financialService.updateExpense(id, {
      category,
      amount,
      description,
      expenseDate: expenseDate ? new Date(expenseDate) : undefined
    }, req.user);

    res.json({ expense });
  } catch (error: any) {
    const status = error.statusCode || error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to update expense' });
  }
};

export const deleteExpense = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await financialService.deleteExpense(id, req.user);

    res.json({ message: 'Expense deleted successfully' });
  } catch (error: any) {
    const status = error.statusCode || error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to delete expense' });
  }
};

export const getAgentCashHoldings = async (req: AuthRequest, res: Response): Promise<void> => {
  const holdings = await financialService.getAgentCashHoldings(req.user);

  res.json({ holdings });
};

export const getAgentSettlement = async (req: AuthRequest, res: Response): Promise<void> => {
  const { agentId } = req.params;
  const { startDate, endDate } = req.query;

  const settlement = await financialService.getAgentSettlement(agentId, {
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined
  });

  res.json(settlement);
};

export const markCollectionsAsDeposited = async (req: AuthRequest, res: Response): Promise<void> => {
  const { transactionIds, depositReference } = req.body;

  await financialService.markCODAsDeposited(transactionIds, depositReference, req.user);

  res.json({ message: 'Collections marked as deposited successfully' });
};

export const reconcileTransaction = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { status, reference, notes } = req.body;

  const transaction = await financialService.reconcileTransaction({
    transactionId: id,
    status: status as PaymentStatus,
    reference,
    notes
  }, req.user);

  res.json({ transaction });
};

export const getCashFlowReport = async (req: AuthRequest, res: Response): Promise<void> => {
  const report = await financialService.getCashFlowReport(req.user);
  res.json(report);
};

export const exportCashFlowCSV = async (req: AuthRequest, res: Response): Promise<void> => {
  const csv = await financialService.exportCashFlowCSV(req.user);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=cash_flow_report_${Date.now()}.csv`);
  res.send(csv);
};

export const getAgentAgingReport = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const report = await agingService.getAgingReport();
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch agent aging report' });
  }
};

export const exportAgentAgingCSV = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const csv = await agingService.generateAgingCSV();

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=agent-aging-report-${new Date().toISOString().split('T')[0]}.csv`);
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ error: 'Failed to export agent aging report' });
  }
};

export const getBalanceSheet = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { asOfDate } = req.query;
    const balanceSheet = await financialService.getBalanceSheet(asOfDate as string);
    res.json(balanceSheet);
  } catch (error) {
    logger.error('Failed to fetch balance sheet', { error });
    res.status(500).json({ message: 'Failed to fetch balance sheet' });
  }
};

export const getProfitLoss = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      res.status(400).json({ message: 'Start date and end date are required' });
      return;
    }
    const profitLoss = await financialService.getProfitLoss(startDate as string, endDate as string);
    res.json(profitLoss);
  } catch (error) {
    logger.error('Failed to fetch profit & loss statement', { error });
    res.status(500).json({ message: 'Failed to fetch profit & loss statement' });
  }
};

export const getFinancialHealth = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [balanceReport, journalCount] = await Promise.all([
      GLAccountService.verifyAllAccountBalances(),
      prisma.journalEntry.count({
        where: { createdAt: { gte: twentyFourHoursAgo } }
      })
    ]);

    res.json({
      balanceIntegrity: {
        totalAccounts: balanceReport.totalAccounts,
        unbalancedCount: balanceReport.unbalanced.length,
        maxDifference: balanceReport.maxDifference.toFixed(4),
        isHealthy: balanceReport.unbalanced.length === 0,
        unbalanced: balanceReport.unbalanced.map(u => ({
          accountId: u.accountId,
          code: u.code,
          difference: u.difference.toFixed(4)
        }))
      },
      journalActivity: {
        last24Hours: journalCount
      }
    });
  } catch (error) {
    logger.error('Failed to fetch financial health', { error });
    res.status(500).json({ message: 'Failed to fetch financial health' });
  }
};

/**
 * POST /api/financial/refresh-aging
 * Admin-only endpoint to manually trigger aging bucket refresh
 * Use when aging data is stale or after bulk reconciliation
 */
export const refreshAgingBuckets = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    await agingService.refreshAll();
    res.json({ message: 'Aging buckets refreshed successfully' });
  } catch (error) {
    logger.error('Failed to refresh aging buckets', { error });
    res.status(500).json({ message: 'Failed to refresh aging buckets' });
  }
};

/**
 * POST /api/financial/backfill-collections
 * Admin-only endpoint to create missing agent_collection records
 * for delivered orders that have no collection tracking
 */
export const backfillMissingCollections = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Find all delivered orders without agent_collections
    const orphanedOrders = await prisma.$queryRaw<any[]>`
      SELECT o.id, o.delivery_agent_id, o.total_amount, o.created_at
      FROM orders o
      WHERE o.status = 'delivered'
        AND o.deleted_at IS NULL
        AND o.delivery_agent_id IS NOT NULL
        AND o.id NOT IN (SELECT order_id FROM agent_collections)
      ORDER BY o.created_at ASC
    `;

    if (orphanedOrders.length === 0) {
      res.json({ message: 'No orphaned orders found', created: 0 });
      return;
    }

    // Group by agent for balance updates
    const byAgent = new Map<number, { orders: any[], total: number }>();
    for (const order of orphanedOrders) {
      const agentId = order.delivery_agent_id;
      if (!byAgent.has(agentId)) {
        byAgent.set(agentId, { orders: [], total: 0 });
      }
      const group = byAgent.get(agentId)!;
      group.orders.push(order);
      group.total += parseFloat(order.total_amount);
    }

    await prisma.$transaction(async (tx) => {
      const extTx = tx as any;

      for (const [agentId, { orders, total }] of byAgent) {
        // Create draft collections for each order
        for (const order of orders) {
          await extTx.agentCollection.create({
            data: {
              orderId: order.id,
              agentId,
              amount: parseFloat(order.total_amount),
              status: 'draft',
              collectionDate: order.created_at,
            },
          });
        }

        // Update agent balance
        await extTx.agentBalance.upsert({
          where: { agentId },
          create: {
            agentId,
            totalCollected: total,
            totalDeposited: 0,
            currentBalance: total,
          },
          update: {
            totalCollected: { increment: total },
            currentBalance: { increment: total },
          },
        });
      }
    });

    // Refresh aging buckets after backfill
    await agingService.refreshAll();

    const summary = Array.from(byAgent.entries()).map(([agentId, { orders, total }]) => ({
      agentId,
      ordersBackfilled: orders.length,
      totalAmount: total,
    }));

    logger.info('Backfilled missing agent collections', { summary });
    res.json({
      message: `Backfilled ${orphanedOrders.length} missing collections`,
      created: orphanedOrders.length,
      summary,
    });
  } catch (error) {
    logger.error('Failed to backfill missing collections', { error });
    res.status(500).json({ message: 'Failed to backfill missing collections' });
  }
};

/**
 * POST /api/financial/backfill-delivery-dates
 * Admin-only endpoint to set deliveryDate on delivered orders that are missing it.
 * Uses orderHistory (status = 'delivered') createdAt, falling back to order.updatedAt.
 */
export const backfillDeliveryDates = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const orders = await prisma.order.findMany({
      where: {
        status: 'delivered',
        deliveryDate: null,
        deletedAt: null,
      },
      select: {
        id: true,
        updatedAt: true,
        orderHistory: {
          where: { status: 'delivered' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    if (orders.length === 0) {
      res.json({ message: 'No orders with missing deliveryDate found', updated: 0 });
      return;
    }

    let updated = 0;
    for (const order of orders) {
      const deliveryDate = order.orderHistory[0]?.createdAt || order.updatedAt;
      await prisma.order.update({
        where: { id: order.id },
        data: { deliveryDate },
      });
      updated++;
    }

    logger.info(`Backfilled deliveryDate for ${updated} orders`);
    res.json({
      message: `Backfilled deliveryDate for ${updated} orders`,
      updated,
    });
  } catch (error) {
    logger.error('Failed to backfill delivery dates', { error });
    res.status(500).json({ message: 'Failed to backfill delivery dates' });
  }
};
