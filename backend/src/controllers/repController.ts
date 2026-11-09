import { Response } from 'express';
import { AuthRequest } from '../types';
import { actorOf, handler } from './helpers';
import { AppError } from '../middleware/errorHandler';
import * as repService from '../services/repService';

/**
 * Rep controller for M7-T11 (COD-65): rep API part 2.
 * Thin controller pattern: parses query, delegates to repService.
 */

function parsePositiveInt(val: unknown, name: string): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const s = String(val).trim();
  if (!/^\d+$/.test(s)) {
    throw new AppError(`${name} must be a positive whole number`, 400);
  }
  const num = Number(s);
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw new AppError(`${name} must be a positive whole number`, 400);
  }
  return num;
}

export const getRepOrders = handler(async (req: AuthRequest, res: Response) => {
  const actor = actorOf(req);
  const repId = parsePositiveInt(req.query.repId, 'repId');
  const page = parsePositiveInt(req.query.page, 'page');
  const limit = parsePositiveInt(req.query.limit, 'limit');
  const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';

  const result = await repService.getOrders(actor, {
    repId,
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    page,
    limit,
    sortOrder,
  });
  res.json(result);
});

export const getRepNumbers = handler(async (req: AuthRequest, res: Response) => {
  const actor = actorOf(req);
  const repId = parsePositiveInt(req.query.repId, 'repId');

  const result = await repService.getNumbers(actor, {
    repId,
    period: typeof req.query.period === 'string' ? req.query.period : undefined,
  });
  res.json(result);
});

export const getRepEarnings = handler(async (req: AuthRequest, res: Response) => {
  const actor = actorOf(req);
  const repId = parsePositiveInt(req.query.repId, 'repId');

  const result = await repService.getEarnings(actor, {
    repId,
    month: typeof req.query.month === 'string' ? req.query.month : undefined,
  });
  res.json(result);
});

export const getRepRewardProgress = handler(async (req: AuthRequest, res: Response) => {
  const actor = actorOf(req);
  const repId = parsePositiveInt(req.query.repId, 'repId');

  const result = await repService.getRewardProgress(actor, {
    repId,
    period: typeof req.query.period === 'string' ? req.query.period : undefined,
  });
  res.json(result);
});

export const getRepPayouts = handler(async (req: AuthRequest, res: Response) => {
  const actor = actorOf(req);
  const repId = parsePositiveInt(req.query.repId, 'repId');
  const page = parsePositiveInt(req.query.page, 'page');
  const limit = parsePositiveInt(req.query.limit, 'limit');

  const result = await repService.getPayouts(actor, {
    repId,
    page,
    limit,
  });
  res.json(result);
});
