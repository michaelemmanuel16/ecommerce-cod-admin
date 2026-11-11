import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { parseYmd } from '../services/kpi/dates';
import * as Money from '../utils/money';
import * as mapping from '../services/marketing/campaignMappingService';

/** `from` and `to` are required YYYY-MM-DD days; from must not be after to. */
export function dateRange(req: AuthRequest): { from: string; to: string } {
  const { from, to } = req.query;
  if (typeof from !== 'string' || typeof to !== 'string') throw new AppError('from and to are required (YYYY-MM-DD)', 400, 'INVALID_RANGE');
  try {
    parseYmd(from);
    parseYmd(to);
  } catch {
    throw new AppError('from and to must be dates (YYYY-MM-DD)', 400, 'INVALID_RANGE');
  }
  if (from > to) throw new AppError('from must not be after to', 400, 'INVALID_RANGE');
  return { from, to };
}

export const getMappings = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await mapping.listMappings());
  } catch (error) {
    next(error);
  }
};

export const postRule = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.status(201).json(await mapping.createRule(req.user?.id ?? null, req.body));
  } catch (error) {
    next(error);
  }
};

export const removeRule = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await mapping.deleteRule(Number(req.params.id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

export const putCampaignPick = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const pick = await mapping.setPick(req.user?.id ?? null, req.body);
    res.json({ pick });
  } catch (error) {
    next(error);
  }
};

export const getCampaigns = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ campaigns: await mapping.listCampaigns(dateRange(req)) });
  } catch (error) {
    next(error);
  }
};

export const getUnmapped = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const campaigns = await mapping.listUnmapped(dateRange(req));
    res.json({ campaigns, spendByCurrency: totalsByCurrency(campaigns) });
  } catch (error) {
    next(error);
  }
};

/** Unmapped spend per currency (ad accounts can differ in currency, so no single sum). */
function totalsByCurrency(rows: mapping.CampaignRow[]): Record<string, string> {
  const totals: Record<string, string> = {};
  for (const r of rows) totals[r.currency] = Money.add(totals[r.currency] ?? 0, r.spend).toFixed(4);
  return totals;
}
