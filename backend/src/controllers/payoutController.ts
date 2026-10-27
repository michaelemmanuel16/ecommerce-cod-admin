import { NextFunction, Response } from 'express';
import { AuthRequest } from '../types';
import payoutService from '../services/payoutService';
import { AppError } from '../middleware/errorHandler';
import { listPayoutsSchema, owedQuerySchema, recordPayoutSchema } from '../validators/payoutSchema';

const idParam = (raw: string): number => {
  const id = parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid person ID', 400);
  return id;
};

/** GET /api/payouts/owed?month=YYYY-MM&includeInactive=true: every rep with earned, paid, paid in the month and owed (the Rep commissions tab). */
export const listOwed = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = owedQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Invalid filter', 400, 'VALIDATION_ERROR');
    res.json(await payoutService.listOwed({ month: parsed.data.month, includeInactive: parsed.data.includeInactive === 'true' }));
  } catch (error) {
    next(error);
  }
};

/** GET /api/payouts/owed/count: how many reps are owed something (the tab count), without the table. */
export const countOwedReps = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ repsOwed: await payoutService.countRepsOwed() });
  } catch (error) {
    next(error);
  }
};

/** GET /api/payouts/owed/:payeeId: the form's preview (earned, paid, owed, open entries). */
export const getOwed = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await payoutService.getOwed(idParam(req.params.payeeId)));
  } catch (error) {
    next(error);
  }
};

/** GET /api/payouts: the one history list for Finance and Staff. */
export const listPayouts = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listPayoutsSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Invalid filter', 400, 'VALIDATION_ERROR');
    res.json(await payoutService.list(parsed.data));
  } catch (error) {
    next(error);
  }
};

/** POST /api/payouts: records one payout. */
export const recordPayout = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = recordPayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue?.code === 'unrecognized_keys' ? `A payout has no ${issue.keys.join(', ')} field` : issue?.message || 'Invalid payout';
      throw new AppError(message, 400, 'VALIDATION_ERROR');
    }
    const payout = await payoutService.record(parsed.data, req.user!.id);
    res.status(201).json({ message: 'Payout recorded', payout });
  } catch (error) {
    next(error);
  }
};
