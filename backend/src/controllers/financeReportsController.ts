import { Response } from 'express';
import { AuthRequest } from '../types';
import { readRange, invalidRange, toInvalidRange } from '../utils/kpiRequest';
import { resolveTenantId } from '../utils/tenantContext';
import { YMD, getStoreTimeZone, localDate, parseBound, parseYmd } from '../services/kpi/dates';
import { monthlyPl } from '../services/finance/statementsService';
import { financeOverview } from '../services/finance/overviewService';
import { cohortProfit, failedDeliveryCost, profitByProduct } from '../services/finance/profitService';

/** GET /api/financial/monthly-pl?months=2&compare=to-date|none&asOf=YYYY-MM-DD (M5-T25, F-923) */
export const getMonthlyPl = async (req: AuthRequest, res: Response): Promise<void> => {
  const { months, compare, asOf } = req.query;
  const count = months === undefined ? undefined : Number(months);
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 24)) throw invalidRange('months must be a whole number from 1 to 24');
  if (compare !== undefined && compare !== 'to-date' && compare !== 'none') throw invalidRange('compare must be to-date or none');
  if (asOf !== undefined && !(typeof asOf === 'string' && YMD.test(asOf))) throw invalidRange('asOf must be a date written YYYY-MM-DD');
  res.json(await monthlyPl({ months: count, compare: compare as 'to-date' | 'none' | undefined, asOf: asOf as string | undefined }));
};

/** GET /api/financial/profit-by-product?from&to (M5-T26, F-924) */
export const getProfitByProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  const { from, to } = readRange(req, resolveTenantId());
  res.json(await profitByProduct(from, to));
};

/** GET /api/financial/cohort-profit?from&to (M5-T26, F-925) */
export const getCohortProfit = async (req: AuthRequest, res: Response): Promise<void> => {
  const { from, to } = readRange(req, resolveTenantId());
  res.json(await cohortProfit(from, to));
};

/** GET /api/financial/failed-delivery-cost?from&to (M5-T26, F-926) */
export const getFailedDeliveryCost = async (req: AuthRequest, res: Response): Promise<void> => {
  const { from, to } = readRange(req, resolveTenantId());
  res.json(await failedDeliveryCost(from, to));
};

/**
 * GET /api/financial/overview?from&to&asOf (M5-T24, F-902, F-907, F-910, F-927). Six tiles, payout reconciliation, unpaid by age and
 * cash runway in one call. No dates means the current month to date. `to` is a store day and includes that whole day.
 */
export const getOverview = async (req: AuthRequest, res: Response): Promise<void> => {
  const { from, to, asOf } = req.query;
  for (const [name, v] of [['from', from], ['to', to], ['asOf', asOf]] as const) {
    if (v !== undefined && !(typeof v === 'string' && YMD.test(v))) throw invalidRange(`${name} must be a date written YYYY-MM-DD`);
  }
  const zone = getStoreTimeZone(resolveTenantId());
  const today = (asOf as string | undefined) ?? localDate(new Date(), zone);
  try {
    const { year, month } = parseYmd(today);
    const start = (from as string | undefined) ?? `${year}-${String(month).padStart(2, '0')}-01`;
    const end = (to as string | undefined) ?? today;
    const range = { from: parseBound(start, 'from', zone), to: parseBound(end, 'to', zone) };
    if (range.to <= range.from) throw invalidRange('to must not be before from');
    res.json(await financeOverview({ ...range, asOf: asOf as string | undefined }));
  } catch (error) {
    throw toInvalidRange(error);
  }
};
