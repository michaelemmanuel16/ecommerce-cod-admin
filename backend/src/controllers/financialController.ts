import { Response } from 'express';
import { AuthRequest } from '../types';
import { PaymentStatus } from '@prisma/client';
import financialService from '../services/financialService';
import agingService from '../services/agingService';

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
  const { category, amount, description, expenseDate } = req.body;

  const expense = await financialService.recordExpense({
    category,
    amount,
    description,
    expenseDate: new Date(expenseDate),
    recordedBy: req.user!.id.toString()
  }, req.user);

  res.status(201).json({ expense });
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
  const { startDate, endDate } = req.query;

  const pipelineRevenue = await financialService.getPipelineRevenue({
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined
  });

  res.json(pipelineRevenue);
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
  const { id } = req.params;
  const { category, amount, description, expenseDate } = req.body;

  const expense = await financialService.updateExpense(id, {
    category,
    amount,
    description,
    expenseDate: expenseDate ? new Date(expenseDate) : undefined
  }, req.user);

  res.json({ expense });
};

export const deleteExpense = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  await financialService.deleteExpense(id, req.user);

  res.json({ message: 'Expense deleted successfully' });
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
  const report = await agingService.getAgingReport();
  res.json(report);
};

export const exportAgentAgingCSV = async (_req: AuthRequest, res: Response): Promise<void> => {
  const { buckets } = await agingService.getAgingReport();

  // CSV Header
  let csv = 'Agent,Total Balance,0-1 Day,2-3 Days,4-7 Days,8+ Days,Oldest Collection\n';

  for (const entry of buckets) {
    const agentName = `${entry.agent.firstName} ${entry.agent.lastName}`;
    const oldestDate = entry.oldestCollectionDate ? new Date(entry.oldestCollectionDate).toLocaleDateString() : 'N/A';

    csv += `"${agentName}",${entry.totalBalance},${entry.bucket_0_1},${entry.bucket_2_3},${entry.bucket_4_7},${entry.bucket_8_plus},"${oldestDate}"\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=agent-aging-report-${new Date().toISOString().split('T')[0]}.csv`);
  res.status(200).send(csv);
};
