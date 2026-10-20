import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { deliveredRevenue } from '../services/kpi/revenue';
import { rates } from '../services/kpi/rates';
import { getStoreTimeZone, parseBound } from '../services/kpi/dates';

const invalidRange = (message: string) => new AppError(message, 400, 'INVALID_RANGE');

/** Range from `from` and `to` query values. Date-only values are store-zone days, `to` inclusive (see parseBound). */
function readRange(req: AuthRequest, tenantId: string): { from: Date; to: Date } {
  const zone = getStoreTimeZone(tenantId);
  const { from, to } = req.query;
  if (typeof from !== 'string' || typeof to !== 'string') throw invalidRange('from and to are required');
  let range: { from: Date; to: Date };
  try {
    range = { from: parseBound(from, 'from', zone), to: parseBound(to, 'to', zone) };
  } catch (error) {
    // dates.ts throws RangeError for a value that is not a date
    throw error instanceof RangeError ? invalidRange(error.message) : error;
  }
  if (range.to <= range.from) throw invalidRange('to must be after from');
  return range;
}

function readId(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw invalidRange(`${label} must be a positive integer`);
  return n;
}

/** GET /api/kpi/revenue?from&to */
export const getRevenue = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = resolveTenantId();
    const { from, to } = readRange(req, tenantId);
    res.json(await deliveredRevenue(tenantId, from, to));
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
      partnerId: readId(req.query.partnerId, 'partnerId'),
      repId: readId(req.query.repId, 'repId'),
    }));
  } catch (error) {
    next(error);
  }
};
