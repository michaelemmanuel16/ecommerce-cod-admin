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
    });

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
    });

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
