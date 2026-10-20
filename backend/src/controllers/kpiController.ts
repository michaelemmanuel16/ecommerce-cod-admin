import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { resolveTenantId } from '../utils/tenantContext';
import { deliveredRevenue, revenueScope } from '../services/kpi/revenue';
import { rates } from '../services/kpi/rates';
import { leadership } from '../services/kpi/leadership';
import { readRange, kpiScope, invalidRange, toInvalidRange } from '../utils/kpiRequest';

/** GET /api/kpi/revenue?from&to */
export const getRevenue = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = resolveTenantId();
    const { from, to } = readRange(req, tenantId);
    res.json(await deliveredRevenue(tenantId, from, to, revenueScope(kpiScope(req))));
  } catch (error) {
    next(error);
  }
};

/** GET /api/kpi/rates?from&to&basis=cohort|delivery&partnerId&repId */
export const getRates = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = resolveTenantId();
    const { from, to } = readRange(req, tenantId);
    const basis = req.query.basis ?? 'cohort';
    if (basis !== 'cohort' && basis !== 'delivery') throw invalidRange('basis must be cohort or delivery');
    res.json(await rates(tenantId, from, to, {
      basis,
      ...kpiScope(req),
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/kpi/leadership?asOf=YYYY-MM-DD
 * asOf is a store-zone day (default today). A rep or an agent gets numbers from their own orders only; the
 * period targets are the store's.
 */
export const getLeadership = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = resolveTenantId();
    const asOf = req.query.asOf;
    if (asOf !== undefined && typeof asOf !== 'string') throw invalidRange('asOf must be a date as YYYY-MM-DD');
    try {
      res.json(await leadership(tenantId, asOf, { scope: kpiScope(req) }));
    } catch (error) {
      // leadership throws RangeError for a day that is not a date (2026-02-30, 17-10-2026)
      throw toInvalidRange(error);
    }
  } catch (error) {
    next(error);
  }
};
