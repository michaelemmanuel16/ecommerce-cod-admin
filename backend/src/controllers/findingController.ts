import { Response } from 'express';
import { FindingStatus, FindingType } from '@prisma/client';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { listFindings, updateFinding } from '../services/findingService';

const positiveInt = (value: unknown, name: string): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(`${name} must be a positive whole number`, 400);
  return n;
};

/** GET /api/findings?type&status&assigneeId&page&limit: the Findings list (F-909). assigneeId=none lists the unassigned. */
export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  const { type, status, assigneeId, page, limit } = req.query;
  if (type !== undefined && !Object.values(FindingType).includes(type as FindingType)) throw new AppError('Unknown Finding type', 400);
  if (status !== undefined && !Object.values(FindingStatus).includes(status as FindingStatus)) throw new AppError('Unknown Finding status', 400);
  res.json(await listFindings({
    type: type as FindingType | undefined,
    status: status as FindingStatus | undefined,
    assigneeId: assigneeId === undefined ? undefined : assigneeId === 'none' ? 'none' : positiveInt(assigneeId, 'assigneeId'),
    page: page === undefined ? undefined : positiveInt(page, 'page'),
    limit: limit === undefined ? undefined : positiveInt(limit, 'limit'),
  }));
};

/** PATCH /api/findings/:id { assigneeId?, status?, explanation? }: assign, explain or write off. */
export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  const { assigneeId, status, explanation } = req.body ?? {};
  if (assigneeId !== undefined && assigneeId !== null && (!Number.isInteger(assigneeId) || assigneeId <= 0)) throw new AppError('assigneeId must be a user id or null', 400);
  if (explanation !== undefined && typeof explanation !== 'string') throw new AppError('explanation must be text', 400);
  res.json({ finding: await updateFinding(req.user!, positiveInt(req.params.id, 'Finding ID'), { assigneeId, status, explanation }) });
};
