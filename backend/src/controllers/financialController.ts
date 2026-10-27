import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { PaymentStatus } from '@prisma/client';
import financialService, { closedBefore, CLOSED_MONTH_NOTICE } from '../services/financialService';
import { UPLOAD_MAX_BYTES, UPLOAD_MIME_TYPES } from '../config/multer';
import agingService from '../services/agingService';
import logger from '../utils/logger';
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
