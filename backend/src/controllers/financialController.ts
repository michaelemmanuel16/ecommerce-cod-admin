import { Response } from 'express';
import { AuthRequest } from '../types';
import { PaymentStatus } from '@prisma/client';
import financialService from '../services/financialService';
import agingService from '../services/agingService';
import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';
import logger from '../utils/logger';

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
    throw error;
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
