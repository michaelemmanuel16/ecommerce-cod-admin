import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { resolveTenantId } from '../utils/tenantContext';
import { readRange } from '../utils/kpiRequest';
import { teamReport } from '../services/teamReportService';

/** GET /api/reports/team?from&to  (dates as in /api/kpi: a date-only `to` is inclusive) */
export const getTeamReport = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = resolveTenantId();
    const { from, to } = readRange(req, tenantId);
    res.json(await teamReport(tenantId, from, to));
  } catch (error) {
    next(error);
  }
};
