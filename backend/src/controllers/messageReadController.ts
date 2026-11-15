import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { formatIssues } from '../tools/shared';
import { messageLogSchema, messageOverviewSchema } from '../validators/messageReadSchema';
import { Actor } from '../services/messaging/conversationService';
import { overview } from '../services/messaging/messageStats';
import { listLog } from '../services/messaging/messageLogQuery';

const actorOf = (req: AuthRequest): Actor => {
  if (!req.user?.tenantId) throw new AppError('This account has no messages', 403);
  return { id: req.user.id, role: req.user.role as Actor['role'], tenantId: req.user.tenantId };
};

/** GET /api/messages/overview */
export const getOverview = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = messageOverviewSchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json(await overview(actorOf(req), parsed.data));
};

/** GET /api/messages/log */
export const getLog = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = messageLogSchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json(await listLog(actorOf(req), parsed.data));
};
