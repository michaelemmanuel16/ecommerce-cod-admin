import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { PaymentStatus } from '@prisma/client';
import financialService, { closedBefore, CLOSED_MONTH_NOTICE } from '../services/financialService';
import { UPLOAD_MAX_BYTES, UPLOAD_MIME_TYPES } from '../config/multer';
import agingService from '../services/agingService';
import { buildReport, exportFileName } from '../services/financeExportService';
import { streamExport } from '../services/exportStream';
import logger from '../utils/logger';
import { GLAccountService } from '../services/glAccountService';
import { GL_ACCOUNTS } from '../config/glAccounts';
import prisma from '../utils/prisma';
import { Decimal } from '@prisma/client/runtime/library';
import { getTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { readDateBound } from '../utils/kpiRequest';
import { parseScenario } from '../services/finance/cashFlowService';
import { AppError } from '../middleware/errorHandler';
import { recordPaystackPayout } from '../services/paystackPayoutService';
import { EXPENSE_CATEGORIES, EXPENSE_PAID_FROM } from '../config/expenseCategories';

export const getFinancialSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  const { startDate, endDate } = req.query;

  const summary = await financialService.getFinancialSummary({
    startDate: readDateBound(startDate, 'from'),
    endDate: readDateBound(endDate, 'to', { snapToDay: true })
  }, req.user);

  res.json({ summary });
};

export const recordExpense = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { category, amount, description, expenseDate, paidFrom, receiptUrl } = req.body;

    const { notice, ...expense } = await financialService.recordExpense({
      category,
      amount,
      description,
      expenseDate: new Date(expenseDate),
      recordedBy: req.user!.id.toString(),
      paidFrom,
      receiptUrl
    }, req.user);

    res.status(201).json({ expense, notice });
  } catch (error: any) {
    const status = error.statusCode || error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to record expense', code: error.errorCode });
  }
};

/** GET /api/financial/expense-categories: what the Add expense form needs (list, paid-from choices, closed-month rule, receipt limits). */
export const getExpenseCategories = async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    categories: EXPENSE_CATEGORIES,
    paidFrom: EXPENSE_PAID_FROM,
    closedBefore: closedBefore(),
    closedNotice: CLOSED_MONTH_NOTICE,
    receipt: { maxBytes: UPLOAD_MAX_BYTES, mimeTypes: UPLOAD_MIME_TYPES },
  });
};

export const getFinancialReports = async (req: AuthRequest, res: Response): Promise<void> => {
  const { period = 'daily', startDate, endDate } = req.query;

  const trend = await financialService.getFinancialReports({
    period: period as string,
    startDate: readDateBound(startDate, 'from'),
    endDate: readDateBound(endDate, 'to', { snapToDay: true })
  });

  res.json({ reports: trend.rows, grouping: trend.grouping });
};

export const getAllExpenses = async (req: AuthRequest, res: Response): Promise<void> => {
  const { category, search, startDate, endDate, page = 1, limit = 20 } = req.query;

  const result = await financialService.getAllExpenses({
    category: category as string | undefined,
    search: search as string | undefined,
    startDate: readDateBound(startDate, 'from'),
    endDate: readDateBound(endDate, 'to'),
    page: Number(page),
    limit: Number(limit)
  }, req.user);

  res.json(result);
};

export const getExpenseBreakdown = async (req: AuthRequest, res: Response): Promise<void> => {
  const { startDate, endDate } = req.query;

  const breakdown = await financialService.getExpenseBreakdown({
    startDate: readDateBound(startDate, 'from'),
    endDate: readDateBound(endDate, 'to')
  }, req.user);

  res.json({ breakdown });
};

export const updateExpense = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { category, amount, description, expenseDate, paidFrom, receiptUrl } = req.body;

    const { notice, ...expense } = await financialService.updateExpense(id, {
      category,
      amount,
      description,
      expenseDate: expenseDate ? new Date(expenseDate) : undefined,
      paidFrom,
      receiptUrl
    }, req.user);

    res.json({ expense, notice });
  } catch (error: any) {
    const status = error.statusCode || error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to update expense', code: error.errorCode });
  }
};

export const deleteExpense = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const { message, notice } = await financialService.deleteExpense(id, req.user);

    res.json({ message, notice });
  } catch (error: any) {
    const status = error.statusCode || error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to delete expense', code: error.errorCode });
  }
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

/** GET /api/financial/cash-flow?scenario=pace|target (M5-T41, F-928) */
export const getCashFlowReport = async (req: AuthRequest, res: Response): Promise<void> => {
  const report = await financialService.getCashFlowReport(req.user, parseScenario(req.query.scenario));
  res.json(report);
};

export const getAgentAgingReport = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const report = await agingService.getAgingReport();
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch agent aging report' });
  }
};

export const getUnpaidByAge = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json(await agingService.getUnpaidByAge());
  } catch (error) {
    logger.error('Failed to fetch unpaid orders by age', { error });
    res.status(500).json({ error: 'Failed to fetch unpaid orders by age' });
  }
};

/** The aging CSV: the same report as GET /export/agent-aging (F-930), kept on its old path. */
export const exportAgentAgingCSV = async (req: AuthRequest, res: Response): Promise<void> => {
  const { columns, batches } = await buildReport('agent-aging', {}, req.user);
  await streamExport(res, { format: 'csv', filename: exportFileName('agent-aging', {}), columns, batches });
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

/** POST /api/financial/agent-aging/:agentId/remind: a WhatsApp reminder to one partner about its unpaid cash (F-911). */
export const remindPartner = async (req: AuthRequest, res: Response): Promise<void> => {
  const agentId = Number(req.params.agentId);
  if (!Number.isInteger(agentId) || agentId <= 0) throw new AppError('Partner ID must be a positive whole number', 400);
  res.json(await agingService.remindPartner(agentId));
};

/**
 * POST /api/financial/sync-cash-findings
 * Admin-only: opens or closes the "negative cash held" Findings now, without waiting for the daily job.
 */
export const syncCashFindings = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    await agingService.syncNegativeCashFindings();
    res.json({ message: 'Cash held Findings synced' });
  } catch (error) {
    logger.error('Failed to sync cash held Findings', { error });
    res.status(500).json({ message: 'Failed to sync cash held Findings' });
  }
};

/**
 * POST /api/financial/backfill-collections
 * Admin-only endpoint to create missing agent_collection records
 * for delivered orders that have no collection tracking
 */
export const backfillMissingCollections = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    // SECURITY: raw SQL bypasses the Prisma tenant-isolation extension, so the
    // tenant filter MUST be explicit here — without it this reads delivered orders
    // from every tenant and stamps the caller's tenant onto foreign collections
    // and balances (cross-tenant leak + ledger corruption).
    const tenantId = getTenantId();
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant context required' });
      return;
    }

    // Find this tenant's delivered orders without agent_collections
    const orphanedOrders = await prisma.$queryRaw<any[]>`
      SELECT o.id, o.delivery_agent_id, o.total_amount, o.created_at
      FROM orders o
      WHERE o.status = 'delivered'
        AND o.deleted_at IS NULL
        AND o.delivery_agent_id IS NOT NULL
        AND o.tenant_id = ${tenantId}
        AND o.id NOT IN (SELECT order_id FROM agent_collections)
      ORDER BY o.created_at ASC
    `;

    if (orphanedOrders.length === 0) {
      res.json({ message: 'No orphaned orders found', created: 0 });
      return;
    }

    // Group by agent for balance updates
    const byAgent = new Map<number, { orders: any[], total: Money.Money }>();
    for (const order of orphanedOrders) {
      const agentId = order.delivery_agent_id;
      if (!byAgent.has(agentId)) {
        byAgent.set(agentId, { orders: [], total: Money.ZERO });
      }
      const group = byAgent.get(agentId)!;
      group.orders.push(order);
      group.total = Money.add(group.total, order.total_amount);
    }

    await prisma.$transaction(async (tx) => {
      const extTx = tx as any;

      for (const [agentId, { orders, total }] of byAgent) {
        // Create draft collections for each order
        for (const order of orders) {
          await extTx.agentCollection.create({
            data: {
              tenantId,
              orderId: order.id,
              agentId,
              amount: Money.parse(order.total_amount),
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

    // The backfilled collections change cash held: sync the below-zero Findings
    await agingService.syncNegativeCashFindings();

    const summary = Array.from(byAgent.entries()).map(([agentId, { orders, total }]) => ({
      agentId,
      ordersBackfilled: orders.length,
      totalAmount: Money.toApi(total),
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

/**
 * POST /api/financial/backfill-commissions
 * Admin-only endpoint to add missing rep commission lines to order_delivery journal entries.
 * Finds JEs that have revenue but no commission transactions, then adds the rep commission
 * debit and payable based on the current rep commissionAmount. Delivery partners keep a delivery fee
 * (posted per outcome to 5070, M5-T06), so no agent commission is added here.
 */
export const backfillCommissions = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const repCommAccountId = await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.SALES_REP_COMMISSION);
    const commPayableAccountId = await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.COMMISSIONS_PAYABLE);

    // account_transactions.tenant_id is NOT NULL — stamp every created row with
    // the request's tenant rather than relying on the extension (which covers
    // only the top-level create, and never nested children).
    const tenantId = getTenantId();
    if (!tenantId) {
      res.status(400).json({ message: 'Cannot backfill commissions without tenant context.' });
      return;
    }

    // Find all order_delivery JEs that have NO rep commission transactions
    const journalEntries = await prisma.journalEntry.findMany({
      where: {
        sourceType: 'order_delivery',
        isVoided: false,
        transactions: {
          none: {
            accountId: repCommAccountId,
          },
        },
      },
    });

    if (journalEntries.length === 0) {
      res.json({ message: 'No journal entries missing commissions', updated: 0 });
      return;
    }

    // Get orders with rep commission info
    const orderIds = journalEntries.map(je => je.sourceId).filter((id): id is number => id !== null);
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: {
        customerRep: { select: { id: true, commissionAmount: true } },
      },
    });
    const orderMap = new Map(orders.map(o => [o.id, o]));

    let updated = 0;
    let skipped = 0;

    for (const je of journalEntries) {
      const order = je.sourceId ? orderMap.get(je.sourceId) : null;
      if (!order) {
        skipped++;
        continue;
      }

      const repComm = Money.orZero(order.customerRep?.commissionAmount);

      if (repComm.equals(0)) {
        skipped++;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        // Add rep commission transaction
        if (repComm.greaterThan(0)) {
          await tx.accountTransaction.create({
            data: {
              journalEntryId: je.id,
              accountId: repCommAccountId,
              debitAmount: repComm,
              creditAmount: new Decimal(0),
              description: `Backfill: Sales rep commission - Order #${order.id}`,
              tenantId,
            },
          });
          await tx.accountTransaction.create({
            data: {
              journalEntryId: je.id,
              accountId: commPayableAccountId,
              debitAmount: new Decimal(0),
              creditAmount: repComm,
              description: `Backfill: Commissions payable - Order #${order.id}`,
              tenantId,
            },
          });
          await tx.account.update({
            where: { id: repCommAccountId },
            data: { currentBalance: { increment: repComm } },
          });
          await tx.account.update({
            where: { id: commPayableAccountId },
            data: { currentBalance: { increment: repComm } },
          });
        }
      });

      updated++;
    }

    logger.info(`Backfilled commissions for ${updated} journal entries (${skipped} skipped)`);
    res.json({
      message: `Backfilled commissions for ${updated} journal entries`,
      updated,
      skipped,
      totalChecked: journalEntries.length,
    });
  } catch (error) {
    logger.error('Failed to backfill commissions', { error });
    res.status(500).json({ message: 'Failed to backfill commissions' });
  }
};

const paystackPayoutSchema = z.object({
  amount: z.string().trim().regex(/^\d+(\.\d{1,4})?$/, 'Amount must be a positive number').refine((v) => Money.tryParse(v)?.gt(0) === true, 'Amount must be above 0'),
  payoutDate: z.coerce.date(),
  reference: z.string().trim().min(1, 'Reference is required').max(100),
  note: z.string().trim().max(500).optional(),
});

/** Record a Paystack payout to the bank: DR 1010, CR 1030 (F-934). */
export const postPaystackPayout = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = paystackPayoutSchema.safeParse(req.body);
    if (!parsed.success) return next(new AppError(parsed.error.issues[0]?.message || 'Invalid payout', 400, 'VALIDATION_ERROR'));
    res.status(201).json(await recordPaystackPayout(parsed.data, req.user!.id));
  } catch (error) {
    next(error);
  }
};
