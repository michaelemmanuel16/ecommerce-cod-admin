import { NextFunction, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import payoutService from '../services/payoutService';
import { AppError } from '../middleware/errorHandler';

// Money in a request: "2034", "2034.50" or a number. The service parses it with the money helper.
const moneyInput = z.union([z.string().regex(/^\d+(\.\d{1,4})?$/, 'Amount must be a plain number'), z.number().finite()]);

// Strict on purpose: a payout never carries a delivery fee line (decision F4), so any unknown field is refused.
const recordSchema = z.object({
  payeeId: z.number().int().positive(),
  amount: moneyInput.optional(),
  method: z.string().trim().min(1, 'Method is required').max(40),
  reference: z.string().trim().max(120).nullish(),
  payoutDate: z.coerce.date().optional(),
  notes: z.string().trim().max(500).nullish(),
  entryIds: z.array(z.number().int().positive()).max(1000).optional(),
}).strict();

const listSchema = z.object({
  payeeId: z.coerce.number().int().positive().optional(),
  kind: z.enum(['rep', 'agent']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const idParam = (raw: string): number => {
  const id = parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid person ID', 400);
  return id;
};

const owedQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be written YYYY-MM').optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});

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
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Invalid filter', 400, 'VALIDATION_ERROR');
    res.json(await payoutService.list(parsed.data));
  } catch (error) {
    next(error);
  }
};

/** POST /api/payouts: records one payout. */
export const recordPayout = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = recordSchema.safeParse(req.body);
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
