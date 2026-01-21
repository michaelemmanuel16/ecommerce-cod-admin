import { Response } from 'express';
import { AuthRequest } from '../types';
import { PaymentStatus } from '@prisma/client';
import financialService from '../services/financialService';

export const getFinancialSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const summary = await financialService.getFinancialSummary({
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    }, req.user);

    res.json({ summary });
  } catch (error) {
    throw error;
  }
};

export const getAllTransactions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { type, status, page = 1, limit = 20 } = req.query;

    const result = await financialService.getAllTransactions({
      type: type as string | undefined,
      status: status as PaymentStatus | undefined,
      page: Number(page),
      limit: Number(limit)
    });

    res.json(result);
  } catch (error) {
    throw error;
  }
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
  } catch (error) {
    throw error;
  }
};

export const getCODCollections = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { agentId, status, page = 1, limit = 20 } = req.query;

    const result = await financialService.getCODCollections({
      agentId: agentId as string | undefined,
      status: status as PaymentStatus | undefined,
      page: Number(page),
      limit: Number(limit)
    });

    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const getFinancialReports = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { period = 'daily', startDate, endDate } = req.query;

    const reports = await financialService.getFinancialReports({
      period: period as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    });

    res.json({ reports });
  } catch (error) {
    throw error;
  }
};

export const getProfitMargins = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const profitMargins = await financialService.calculateProfitMargins({
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    });

    res.json(profitMargins);
  } catch (error) {
    throw error;
  }
};

export const getPipelineRevenue = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const pipelineRevenue = await financialService.getPipelineRevenue({
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    });

    res.json(pipelineRevenue);
  } catch (error) {
    throw error;
  }
};

export const getAllExpenses = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { category, startDate, endDate, page = 1, limit = 20 } = req.query;

    const result = await financialService.getAllExpenses({
      category: category as string | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      page: Number(page),
      limit: Number(limit)
    });

    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const getExpenseBreakdown = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const breakdown = await financialService.getExpenseBreakdown({
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    });

    res.json({ breakdown });
  } catch (error) {
    throw error;
  }
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
  } catch (error) {
    throw error;
  }
};

export const deleteExpense = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await financialService.deleteExpense(id, req.user);

    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    throw error;
  }
};

export const getAgentCashHoldings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const holdings = await financialService.getAgentCashHoldings(req.user);

    res.json({ holdings });
  } catch (error) {
    throw error;
  }
};

export const getAgentSettlement = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { agentId } = req.params;
    const { startDate, endDate } = req.query;

    const settlement = await financialService.getAgentSettlement(agentId, {
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    });

    res.json(settlement);
  } catch (error) {
    throw error;
  }
};

export const markCollectionsAsDeposited = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { transactionIds, depositReference } = req.body;

    await financialService.markCODAsDeposited(transactionIds, depositReference, req.user);

    res.json({ message: 'Collections marked as deposited successfully' });
  } catch (error) {
    throw error;
  }
};

export const reconcileTransaction = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, reference, notes } = req.body;

    const transaction = await financialService.reconcileTransaction({
      transactionId: id,
      status: status as PaymentStatus,
      reference,
      notes
    }, req.user);

    res.json({ transaction });
  } catch (error) {
    throw error;
  }
};

export const getCashFlowReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const report = await financialService.getCashFlowReport(req.user);
    res.json(report);
  } catch (error) {
    throw error;
  }
};

export const exportCashFlowCSV = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const csv = await financialService.exportCashFlowCSV(req.user);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=cash_flow_report_${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    throw error;
  }
};
