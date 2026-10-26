import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { listFindings, updateFinding } from '../services/findingService';
import { findingListQuerySchema, findingPatchSchema } from '../validators/findingSchema';
import { formatIssues } from '../tools/shared';

const idOf = (value: string): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError('Finding ID must be a positive whole number', 400);
  return n;
};

/** GET /api/findings?type&status&assigneeId&page&limit: the Findings list (F-909). assigneeId=none lists the unassigned. */
export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = findingListQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json(await listFindings(parsed.data));
};

/** PATCH /api/findings/:id { assigneeId?, status?, explanation? }: assign, explain or write off. */
export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = findingPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json({ finding: await updateFinding(req.user!, idOf(req.params.id), parsed.data) });
};
