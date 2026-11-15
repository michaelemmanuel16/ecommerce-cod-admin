import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { formatIssues } from '../tools/shared';
import { conversationListSchema, conversationPatchSchema, conversationReplySchema } from '../validators/conversationSchema';
import * as conversations from '../services/messaging/conversationService';

const actorOf = (req: AuthRequest): conversations.Actor => {
  if (!req.user?.tenantId) throw new AppError('This account has no conversations', 403);
  return { id: req.user.id, role: req.user.role as conversations.Actor['role'], tenantId: req.user.tenantId };
};
const idOf = (req: AuthRequest): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
  return id;
};

/** GET /api/conversations */
export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = conversationListSchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json(await conversations.listConversations(actorOf(req), parsed.data));
};

/** GET /api/conversations/:id/messages */
export const messages = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await conversations.getThread(idOf(req), actorOf(req)));
};

/** POST /api/conversations/:id/reply */
export const reply = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = conversationReplySchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.status(201).json(await conversations.replyToConversation(idOf(req), actorOf(req), parsed.data));
};

/** PATCH /api/conversations/:id */
export const patch = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = conversationPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json(await conversations.updateConversation(idOf(req), actorOf(req), parsed.data));
};
