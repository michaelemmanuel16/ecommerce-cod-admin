import { Response } from 'express';
import { AuthRequest } from '../types';
import { CallOutcome } from '@prisma/client';
import callService from '../services/callService';

export const createCall = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { customerId, orderId, outcome, duration, notes } = req.body;

    const call = await callService.createCall({
      customerId,
      orderId,
      outcome: outcome as CallOutcome,
      duration,
      notes,
      salesRepId: req.user!.id
    });

    res.status(201).json({ call });
  } catch (error) {
    throw error;
  }
};

export const getCalls = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      salesRepId,
      customerId,
      orderId,
      outcome,
      startDate,
      endDate,
      page = 1,
      limit = 50
    } = req.query;

    // ROLE-BASED FILTERING: Sales reps only see their own calls
    let effectiveSalesRepId = salesRepId ? Number(salesRepId) : undefined;
    if (req.user?.role === 'sales_rep') {
      effectiveSalesRepId = req.user.id;
    }

    const result = await callService.getCalls({
      salesRepId: effectiveSalesRepId,
      customerId: customerId ? Number(customerId) : undefined,
      orderId: orderId ? Number(orderId) : undefined,
      outcome: outcome as CallOutcome | undefined,
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

export const getCallsByOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;
    const calls = await callService.getCallsByOrder(Number(orderId));
    res.json({ calls });
  } catch (error) {
    throw error;
  }
};

export const getCallsByCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { customerId } = req.params;
    const calls = await callService.getCallsByCustomer(Number(customerId));
    res.json({ calls });
  } catch (error) {
    throw error;
  }
};

export const getCallStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, salesRepId } = req.query;

    // ROLE-BASED FILTERING: Sales reps only see their own stats
    let effectiveSalesRepId = salesRepId ? Number(salesRepId) : undefined;
    if (req.user?.role === 'sales_rep') {
      effectiveSalesRepId = req.user.id;
    }

    const stats = await callService.getCallStats({
      salesRepId: effectiveSalesRepId,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    });

    res.json({ stats });
  } catch (error) {
    throw error;
  }
};
