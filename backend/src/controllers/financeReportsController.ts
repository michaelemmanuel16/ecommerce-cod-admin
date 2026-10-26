import { Response } from 'express';
import { AuthRequest } from '../types';
import { readRange, invalidRange } from '../utils/kpiRequest';
import { resolveTenantId } from '../utils/tenantContext';
import { YMD } from '../services/kpi/dates';
import { monthlyPl } from '../services/finance/statementsService';

/** GET /api/financial/monthly-pl?months=2&compare=to-date|none&asOf=YYYY-MM-DD (M5-T25, F-923) */
export const getMonthlyPl = async (req: AuthRequest, res: Response): Promise<void> => {
  const { months, compare, asOf } = req.query;
  const count = months === undefined ? undefined : Number(months);
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 24)) throw invalidRange('months must be a whole number from 1 to 24');
  if (compare !== undefined && compare !== 'to-date' && compare !== 'none') throw invalidRange('compare must be to-date or none');
  if (asOf !== undefined && !(typeof asOf === 'string' && YMD.test(asOf))) throw invalidRange('asOf must be a date written YYYY-MM-DD');
  res.json(await monthlyPl({ months: count, compare: compare as 'to-date' | 'none' | undefined, asOf: asOf as string | undefined }));
};
