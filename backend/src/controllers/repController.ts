import { Response } from 'express';
import { AuthRequest } from '../types';
import { actorOf, handler } from './helpers';
import * as repService from '../services/repService';

/**
 * Rep controller for M7-T11 (COD-65): rep API part 2.
 * Thin controller pattern: parses query, delegates to repService.
 */

export const getRepOrders = handler(async (req: AuthRequest, res: Response) => {
  const actor = actorOf(req);
  const repId = req.query.repId ? Number(req.query.repId) : undefined;
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';

  const result = await repService.getOrders(actor, {
    repId,
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    page,
    limit,
    sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined,
    sortOrder,
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
  });
  res.json(result);
});

export const getRepNumbers = handler(async (req: AuthRequest, res: Response) => {
  const actor = actorOf(req);
  const repId = req.query.repId ? Number(req.query.repId) : undefined;

  const result = await repService.getNumbers(actor, {
    repId,
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    period: typeof req.query.period === 'string' ? req.query.period : undefined,
  });
  res.json(result);
});

export const getRepEarnings = handler(async (req: AuthRequest, res: Response) => {
  const actor = actorOf(req);
  const repId = req.query.repId ? Number(req.query.repId) : undefined;

  const result = await repService.getEarnings(actor, {
    repId,
    month: typeof req.query.month === 'string' ? req.query.month : undefined,
  });
  res.json(result);
});

export const getRepRewardProgress = handler(async (req: AuthRequest, res: Response) => {
  const actor = actorOf(req);
  const repId = req.query.repId ? Number(req.query.repId) : undefined;

  const result = await repService.getRewardProgress(actor, {
    repId,
    period: typeof req.query.period === 'string' ? req.query.period : undefined,
  });
  res.json(result);
});

export const getRepPayouts = handler(async (req: AuthRequest, res: Response) => {
  const actor = actorOf(req);
  const repId = req.query.repId ? Number(req.query.repId) : undefined;
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const result = await repService.getPayouts(actor, {
    repId,
    page,
    limit,
  });
  res.json(result);
});
