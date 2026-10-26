import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { getStoreTimeZone, parseBound, parseInclusiveBound } from '../services/kpi/dates';
import { getTenantId } from './tenantContext';

export const invalidRange = (message: string) => new AppError(message, 400, 'INVALID_RANGE');

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

/**
 * One optional startDate/endDate query value as a store-zone instant for an inclusive `gte`/`lte` filter.
 * A 'YYYY-MM-DD' value is a store day (`to` = its last millisecond); an ISO instant is used as given.
 * A value that is not a date is a 400.
 */
export function readDateBound(value: unknown, edge: 'from' | 'to', opts?: { snapToDay?: boolean }): Date | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  try {
    return parseInclusiveBound(value, edge, getStoreTimeZone(getTenantId()), opts);
  } catch (error) {
    throw toInvalidRange(error);
  }
}

export function readId(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw invalidRange(`${label} must be a positive integer`);
  return n;
}

/**
 * The scope a role has on KPI data: a sales rep sees only orders assigned to them, a delivery agent only their
 * own deliveries. Any other role is unscoped. One rule for the HTTP KPI routes and the analytics service (D19).
 */
export function roleScope(user?: { id?: number; role?: string } | null): { repId?: number; partnerId?: number } {
  if (user?.id !== undefined && user.role === 'sales_rep') return { repId: user.id };
  if (user?.id !== undefined && user.role === 'delivery_agent') return { partnerId: user.id };
  return {};
}

/**
 * The scope a KPI request runs with, the same rule as analyticsService: a sales rep sees only orders assigned
 * to them, a delivery agent only their own deliveries (the query's repId and partnerId are ignored). Any other
 * role may narrow by repId and partnerId from the query.
 */
export function kpiScope(req: AuthRequest): { repId?: number; partnerId?: number } {
  if (req.user?.role === 'sales_rep' || req.user?.role === 'delivery_agent') return roleScope(req.user);
  return { repId: readId(req.query.repId, 'repId'), partnerId: readId(req.query.partnerId, 'partnerId') };
}
