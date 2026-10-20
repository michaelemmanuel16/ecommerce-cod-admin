import { Response, NextFunction } from 'express';
import type { FxRate } from '@prisma/client';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { currentRates, rateHistory, setManualRate, useTodaysRate } from '../services/fxService';
import { FX_PROVIDER_ATTRIBUTION } from '../services/fx/fxProvider';
import { ymdOfUtc } from '../services/kpi/dates';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

const rowOut = (r: FxRate) => ({
  id: r.id,
  from: r.fromCurrency,
  to: r.toCurrency,
  rate: String(r.rate),
  date: ymdOfUtc(r.date),
  source: r.source,
  createdById: r.createdById,
  createdAt: r.createdAt,
});

/** GET /api/fx/rates: today's rate for every extra currency, with its source and the provider to credit. */
export const getRates = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ ...(await currentRates(resolveTenantId())), provider: FX_PROVIDER_ATTRIBUTION });
  } catch (error) {
    next(error);
  }
};

/** POST /api/fx/rates { to, rate, from?, date? }: a manual rate. It stays until use-today. */
export const postRate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { to, from, rate, date } = req.body ?? {};
    if (rate === undefined || rate === null || rate === '') throw new AppError('rate is required', 400, 'INVALID_RATE');
    const row = await setManualRate(resolveTenantId(), req.user?.id ?? null, {
      to, from: str(from), rate, date: str(date),
    });
    res.status(201).json(rowOut(row));
  } catch (error) {
    next(error);
  }
};

/** POST /api/fx/use-today { to? }: end the manual rate and take today's automatic rate. */
export const postUseToday = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { rates, skipped } = await useTodaysRate(resolveTenantId(), req.user?.id ?? null, { to: str(req.body?.to) });
    res.json({ rates: rates.map(rowOut), skipped });
  } catch (error) {
    next(error);
  }
};

/** GET /api/fx/history?to=NGN&limit=100: stored rates, newest first. */
export const getHistory = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
    if (limit !== undefined && !Number.isFinite(limit)) throw new AppError('limit must be a number', 400);
    const rows = await rateHistory(resolveTenantId(), { to: str(req.query.to), limit });
    res.json({ history: rows.map(rowOut) });
  } catch (error) {
    next(error);
  }
};
