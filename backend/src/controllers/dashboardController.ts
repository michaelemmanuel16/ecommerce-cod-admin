import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { resolveTenantId } from '../utils/tenantContext';
import { hasPermission } from '../middleware/auth';
import { invalidRange, toInvalidRange } from '../utils/kpiRequest';
import { DASHBOARD_RANGES, DashboardRange, ownerDashboard } from '../services/dashboardService';

/**
 * GET /api/dashboard/owner?range=month&asOf=YYYY-MM-DD
 * range: today, week, month (default), last_7_days, last_30_days, quarter, year. asOf is a store-zone day (default today).
 * The controller only reads the query and the viewer's permissions; every number comes from services/dashboardService.
 */
export const getOwnerDashboard = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = resolveTenantId();
    const { range, asOf } = req.query;
    if (range !== undefined && !DASHBOARD_RANGES.includes(range as DashboardRange)) {
      throw invalidRange(`range must be one of ${DASHBOARD_RANGES.join(', ')}`);
    }
    if (asOf !== undefined && typeof asOf !== 'string') throw invalidRange('asOf must be a date as YYYY-MM-DD');
    const user = req.user!;
    const [cash, orders] = await Promise.all([hasPermission(user, 'financial', 'view'), hasPermission(user, 'orders', 'view')]);
    try {
      res.json(await ownerDashboard(tenantId, { range: range as DashboardRange | undefined, asOf, access: { cash, orders } }));
    } catch (error) {
      // asOf that is not a real day (2026-02-30, 17-10-2026) is a 400
      throw toInvalidRange(error);
    }
  } catch (error) {
    next(error);
  }
};
