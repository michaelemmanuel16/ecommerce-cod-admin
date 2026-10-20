import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { getStoreTimeZone, parseBound } from '../services/kpi/dates';

const invalidRange = (message: string) => new AppError(message, 400, 'INVALID_RANGE');

/** dates.ts and the KPI services throw RangeError for a value that is not a date: that is a 400. Anything else passes through. */
export function toInvalidRange(err: unknown): unknown {
  return err instanceof RangeError ? invalidRange(err.message) : err;
}

/** Range from `from` and `to` query values. Date-only values are store-zone days, `to` inclusive (see parseBound). */
export function readRange(req: AuthRequest, tenantId: string): { from: Date; to: Date } {
  const zone = getStoreTimeZone(tenantId);
  const { from, to } = req.query;
  if (typeof from !== 'string' || typeof to !== 'string') throw invalidRange('from and to are required');
  let range: { from: Date; to: Date };
  try {
    range = { from: parseBound(from, 'from', zone), to: parseBound(to, 'to', zone) };
  } catch (error) {
    throw toInvalidRange(error);
  }
  if (range.to <= range.from) throw invalidRange('to must be after from');
  return range;
}

export function readId(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw invalidRange(`${label} must be a positive integer`);
  return n;
}

/**
 * The scope a KPI request runs with, the same rule as analyticsService: a sales rep sees only orders assigned
 * to them, a delivery agent only their own deliveries (the query's repId and partnerId are ignored). Any other
 * role may narrow by repId and partnerId from the query.
 */
export function kpiScope(req: AuthRequest): { repId?: number; partnerId?: number } {
  if (req.user?.role === 'sales_rep') return { repId: req.user.id };
  if (req.user?.role === 'delivery_agent') return { partnerId: req.user.id };
  return { repId: readId(req.query.repId, 'repId'), partnerId: readId(req.query.partnerId, 'partnerId') };
}
