import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { resolveTenantId } from '../utils/tenantContext';
import { timeToFirstCall } from '../services/kpi/timeToFirstCall';
import { readRange, kpiScope } from '../utils/kpiRequest';

/** GET /api/rep/stats/time-to-first-call?from&to&repId. A sales rep sees only their own orders; a delivery agent only theirs. */
export const getTimeToFirstCall = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = resolveTenantId();
    const { from, to } = readRange(req, tenantId);
    res.json(await timeToFirstCall(tenantId, from, to, kpiScope(req)));
  } catch (error) {
    next(error);
  }
};
