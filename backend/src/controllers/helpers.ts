import { NextFunction, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { formatIssues } from '../tools/shared';

/** Small helpers the thin controllers share (M6-T05). */

/** An async handler whose errors go to the error middleware. */
export const handler = (fn: (req: AuthRequest, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next: NextFunction) => { fn(req as AuthRequest, res).catch(next); };

/** A positive integer path parameter, or 400 "Invalid <what> ID". */
export const idParam = (raw: string, what = 'role'): number => {
  const id = parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(`Invalid ${what} ID`, 400);
  return id;
};

/** The parsed data, or 400 with one message for all issues. */
export const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown, where: 'body' | 'query' = 'body'): z.infer<T> => {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error, where), 400, 'VALIDATION_ERROR');
  return parsed.data;
};

export const actorOf = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role });
