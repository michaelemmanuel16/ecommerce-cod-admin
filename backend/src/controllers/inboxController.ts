import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { formatIssues } from '../tools/shared';
import { inboxFeedQuerySchema, inboxMarkAllSchema, inboxPatchSchema } from '../validators/inboxSchema';
import * as feed from '../services/inbox/inboxFeedService';
import { pushInboxCounts } from '../services/inbox/inboxRealtime';

const me = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role as string });
const tenantOf = (req: AuthRequest): string => {
  if (!req.user?.tenantId) throw new AppError('This account has no inbox', 403);
  return req.user.tenantId;
};

/** GET /api/inbox?view&status&scope&cursor&limit: newest first. scope=all is for the owner. */
export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = inboxFeedQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json(await feed.listFeed(me(req), parsed.data));
};

/** GET /api/inbox/counts: unread per view, from the database (works with the socket down). */
export const counts = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ counts: await feed.getCounts(req.user!.id) });
};

/** PATCH /api/inbox/:id { read?, done?, snoozedUntil? } */
export const patch = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Notification ID must be a positive whole number', 400);
  const parsed = inboxPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  const { snoozedUntil, ...rest } = parsed.data;
  const item = await feed.patchRow(req.user!.id, id, {
    ...rest,
    ...(snoozedUntil !== undefined ? { snoozedUntil: snoozedUntil === null ? null : new Date(snoozedUntil) } : {}),
  });
  await pushInboxCounts(req.user!.id, tenantOf(req));
  res.json({ item, counts: await feed.getCounts(req.user!.id) });
};

/** POST /api/inbox/mark-all { view? } */
export const markAll = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = inboxMarkAllSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  const updated = await feed.markAll(req.user!.id, parsed.data.view);
  await pushInboxCounts(req.user!.id, tenantOf(req));
  res.json({ updated, counts: await feed.getCounts(req.user!.id) });
};
