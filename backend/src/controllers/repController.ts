import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { resolveTenantId } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import * as repService from '../services/repService';

function getTargetRepId(req: AuthRequest): number {
  if (!req.user) {
    throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  }

  const allowedRoles = ['sales_rep', 'manager', 'admin', 'super_admin'];
  if (!allowedRoles.includes(req.user.role)) {
    throw new AppError('Access denied', 403, 'FORBIDDEN');
  }

  if (req.user.role === 'sales_rep') {
    if (req.query.repId && Number(req.query.repId) !== req.user.id) {
      throw new AppError('Sales reps can only view their own rows', 403, 'FORBIDDEN');
    }
    return req.user.id;
  }

  if (req.query.repId) {
    const id = Number(req.query.repId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError('repId must be a positive integer', 400, 'INVALID_REP_ID');
    }
    return id;
  }

  return req.user.id;
}

export const getSummary = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = resolveTenantId();
    const repId = getTargetRepId(req);
    const summary = await repService.getShellSummary(tenantId, repId);
    res.json(summary);
  } catch (error) {
    next(error);
  }
};

export const getToday = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = resolveTenantId();
    const repId = getTargetRepId(req);
    const today = await repService.getToday(tenantId, repId);
    res.json(today);
  } catch (error) {
    next(error);
  }
};

export const getQueue = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = resolveTenantId();
    const repId = getTargetRepId(req);
    const tab = typeof req.query.tab === 'string' ? req.query.tab : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const queue = await repService.getQueue(tenantId, repId, { tab, q });
    res.json(queue);
  } catch (error) {
    next(error);
  }
};

export const getCallCard = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = resolveTenantId();
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      throw new AppError('Invalid order ID', 400, 'INVALID_ORDER_ID');
    }
    const card = await repService.getCallCard(tenantId, orderId, {
      id: req.user!.id,
      role: req.user!.role,
    });
    res.json(card);
  } catch (error) {
    next(error);
  }
};
