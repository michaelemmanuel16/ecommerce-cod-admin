import { Response } from 'express';
import { AuthRequest } from '../types';
import { CallOutcome } from '@prisma/client';
import callService from '../services/callService';
import { readDateBound } from '../utils/kpiRequest';

export const createCall = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      customerId,
      orderId,
      outcome,
      duration,
      notes,
      startedAt,
      source,
      declineReason,
      callbackAt,
      expectedUpdatedAt,
      orderChanges,
    } = req.body;

    const call = await callService.createCall({
      customerId,
      orderId,
      outcome: outcome as CallOutcome,
      duration,
      notes,
      startedAt: startedAt ? new Date(startedAt) : undefined,
      source,
      declineReason,
      callbackAt: callbackAt ? new Date(callbackAt) : undefined,
      salesRepId: req.user!.id,
      expectedUpdatedAt,
      orderChanges,
    });

    const nextOrderId = (call as any).nextOrderId ?? null;
    const upsell = (call as any).upsell ?? null;
    const warningFlag = (call as any).warningFlag ?? false;
    res.status(201).json({ call, nextOrderId, upsell, warningFlag });
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
      startDate: readDateBound(startDate, 'from'),
      endDate: readDateBound(endDate, 'to'),
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
      startDate: readDateBound(startDate, 'from'),
      endDate: readDateBound(endDate, 'to')
    });

    const outcomes: Record<string, number> = {
      confirmed: 0,
      not_reachable: 0,
      call_back_later: 0,
      declined: 0,
      wrong_number: 0,
      other: 0,
    };
    for (const rep of stats) {
      for (const [key, count] of Object.entries(rep.outcomeBreakdown)) {
        if (key in outcomes) {
          outcomes[key] += count;
        } else {
          outcomes.other += count;
        }
      }
    }

    res.json({ stats, outcomes });
  } catch (error) {
    throw error;
  }
};
